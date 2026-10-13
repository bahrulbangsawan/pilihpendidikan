// POST /api/v1/applications/{app_id}/emails — create an email-application
// draft (09 §1, §5, §6; 05 §13). `jobs:write`: the web, the CLI and MCP
// clients may draft; nobody but the user approves (approve.ts).
//
// The request is the contract's `CreateEmailRequest`, with additive
// conveniences for clients that do not compose the text themselves (the CLI's
// `email draft <app_id> [--to] [--locale] [--attach]`, 09 §10):
//   to                  optional when the posting's apply link is `mailto:`
//   subject, body_text  optional: rendered from the contracts template
//                       (09 §5.1) in `locale` (default: the posting's detected
//                       language, else the user's locale) with the user's
//                       facts; a `mailto:` subject wins over the template's
//   attachment_file_ids optional: default = the attached CV variant's PDF
//                       (09 §5.3); [] = no attachment
//   draft_paragraph     ask the AI for the optional paragraph (09 §5.2;
//                       templated body only); `recipient_name` fills the
//                       greeting
//
// One batch writes the draft, its pending `submit` approval (payload
// `email_submit` with `recipient_confirmed` and `ai_drafted`, 09 §4) and the
// `approval_requested` event; pending approvals of the application's earlier
// drafts are expired (a newer draft supersedes them). AI spend, when the
// paragraph was asked for, is recorded in the same batch.

import type { CVData, CvBullet } from "@pilihpendidikan/cv-engine";
import { CVDataSchema, flattenCvBullets } from "@pilihpendidikan/cv-engine";
import { CreateEmailRequestSchema } from "@pilihpendidikan/jobs-contracts/api";
import { renderEmailTemplate } from "@pilihpendidikan/jobs-contracts/email";
import type {
  ChangeSource,
  EmailDelivery,
  Locale,
} from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApprovalRecord,
  EmailApplicationRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { z } from "zod";
import type { Env } from "../../../env";
import type { AiProvider } from "../../ai/provider";
import { AI_MODELS, costMicroUsd, estimateTokens } from "../../ai/primitives";
import type { FeatureFlags } from "../../core/flags";
import { apiError, invalidRequest, notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import {
  getAiBudgetStatus,
  recordAiUsageStatements,
} from "../../repo/core/ai-usage";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { getUserSettings } from "../../repo/core/settings";
import type { EmailPostingRow } from "../../repo/email";
import {
  expireApprovalStatements,
  insertApprovalStatements,
  insertEmailStatements,
  listSupersededApprovals,
  loadApplicationPosting,
  loadCvVariant,
  loadFacts,
  loadFiles,
} from "../../repo/email";
import { loadOwnedCv } from "../cv/index";
import type { EmailContent } from "./content";
import {
  assertBody,
  assertSubject,
  ccFor,
  checkAttachments,
  emailPayloadHash,
} from "./content";
import type {
  ParagraphFact,
  ParagraphOutcome,
  ParagraphSources,
} from "./paragraph";
import { draftParagraph, PARAGRAPH_MAX_OUTPUT_TOKENS } from "./paragraph";
import type { RecipientCheck } from "./recipient";
import {
  checkRecipient,
  normalizeRecipient,
  recipientWarnings,
} from "./recipient";
import {
  accountEmail,
  actorOf,
  approvalEventStatements,
  approvalPayloadOf,
  newApproval,
} from "./shared";

/** The create body: the contract plus additive, optional conveniences. */
// The contract (with its additive optional fields) plus two server-side
// leniencies: `to` is trimmed and checked by `normalizeRecipient` (one 400
// message for every malformed address), and the greeting name is trimmed.
export const CreateEmailDraftSchema = CreateEmailRequestSchema.extend({
  to: z.string().min(3).max(254).optional(),
  recipient_name: z.string().trim().min(1).max(120).optional(),
});
export type CreateEmailDraft = z.infer<typeof CreateEmailDraftSchema>;

/** Facts the template reads (09 §5.1). */
export const TEMPLATE_FACT_KEYS = [
  "contact.full_name",
  "contact.phone",
  "links.linkedin",
] as const;
/** Facts the paragraph may cite (non-sensitive, no contact details). */
export const PARAGRAPH_FACT_KEYS = [
  "skills.extra",
  "profile.languages",
  "prefs.target_titles",
] as const;
const PROFILE_CV_KEY = "profile.primary_cv_id";
const MAILTO_RE = /^mailto:/i;
const CRLF_RE = /\r\n?/g;
const BULLET_SECTIONS = new Set([
  "summary",
  "experience",
  "projects",
  "volunteer",
  "awards",
  "certificates",
]);

export interface DraftInput {
  body: CreateEmailDraft;
  env: Env;
  flags: FeatureFlags;
  now: number;
  provider: () => AiProvider;
  source: ChangeSource;
}

export interface DraftReview {
  ai_paragraph: Omit<ParagraphOutcome, "usage"> | null;
  locale: Locale;
  payload_hash: string;
  recipient: RecipientCheck & { confirmed: boolean };
  templated: { body: boolean; subject: boolean };
  warnings: string[];
}

export interface DraftPlan {
  approval: ApprovalRecord;
  email: EmailApplicationRecord;
  review: DraftReview;
  statements: D1PreparedStatement[];
}

/** The address and subject of a `mailto:` apply link (09 §1). */
export function parseMailto(applyUrl: string | null): {
  subject: string | null;
  to: string | null;
} {
  if (!(applyUrl && MAILTO_RE.test(applyUrl))) {
    return { to: null, subject: null };
  }
  const rest = applyUrl.replace(MAILTO_RE, "");
  const [path = "", query = ""] = rest.split("?", 2);
  let first = "";
  try {
    first = decodeURIComponent(path).split(",")[0]?.trim() ?? "";
  } catch {
    first = "";
  }
  const params = new URLSearchParams(query);
  const subject = params.get("subject")?.replace(CRLF_RE, " ").trim() || null;
  return { to: first ? normalizeRecipient(first) : null, subject };
}

function postingLocale(posting: EmailPostingRow): Locale | null {
  if (!posting.extraction) {
    return null;
  }
  try {
    const extraction = JSON.parse(posting.extraction) as Record<
      string,
      unknown
    >;
    const language = extraction.language ?? extraction.lang;
    return language === "en" || language === "id" ? language : null;
  } catch {
    return null;
  }
}

function factText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object" && "code" in item) {
          const entry = item as { code: unknown; level?: unknown };
          return entry.level
            ? `${String(entry.code)} (${String(entry.level)})`
            : String(entry.code);
        }
        return factText(item);
      })
      .filter((item) => item !== "")
      .join(", ");
  }
  return "";
}

/** The CV whose lines the paragraph may cite: the tailored one, else the base. */
async function paragraphCv(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  input: {
    baseCvId: string | null;
    email: string;
    primaryCvId: string | null;
    variantId: string | null;
  }
): Promise<CVData | null> {
  const candidates: string[] = [];
  if (input.variantId) {
    const variant = await loadCvVariant(db, scope, input.variantId);
    if (variant?.status === "approved" && variant.tailored_cv_id) {
      candidates.push(variant.tailored_cv_id);
    }
    if (variant) {
      candidates.push(variant.base_cv_id);
    }
  }
  for (const id of [input.baseCvId, input.primaryCvId]) {
    if (id) {
      candidates.push(id);
    }
  }
  for (const id of [...new Set(candidates)]) {
    const raw = await loadOwnedCv(env, input.email, id);
    const parsed = raw === null ? null : CVDataSchema.safeParse(raw);
    if (parsed?.success) {
      return parsed.data as CVData;
    }
  }
  return null;
}

function paragraphSources(
  cv: CVData | null,
  facts: ReadonlyMap<string, unknown>
): ParagraphSources {
  const bullets: CvBullet[] = cv
    ? flattenCvBullets(cv).filter(
        (bullet) => BULLET_SECTIONS.has(bullet.section) && bullet.text !== ""
      )
    : [];
  const factList: ParagraphFact[] = [];
  for (const key of PARAGRAPH_FACT_KEYS) {
    const text = factText(facts.get(key));
    if (text !== "") {
      factList.push({ key, text });
    }
  }
  return {
    bullets,
    facts: factList,
    summary: cv?.summary ?? "",
  };
}

type Unavailable = Pick<ParagraphOutcome, "status">["status"];

function skipped(status: Unavailable): ParagraphOutcome {
  return {
    status,
    paragraph: null,
    source_bullet_ids: [],
    source_fact_keys: [],
    usage: null,
    violations: [],
  };
}

/** 09 §5.2 with the AI gates: kill switch, consent, D-34 budget. */
async function maybeDraftParagraph(
  db: JobsDb,
  scope: UserScope,
  input: DraftInput & {
    account: string;
    application: { base_cv_id: string | null; cv_variant_id: string | null };
    facts: ReadonlyMap<string, unknown>;
    locale: Locale;
    posting: EmailPostingRow;
    settings: { ai_consent_at: number | null; timezone: string };
  }
): Promise<ParagraphOutcome> {
  if (input.flags.AI_DISABLED) {
    return skipped("ai_disabled");
  }
  if (input.settings.ai_consent_at === null) {
    return skipped("consent_required");
  }
  const cv = await paragraphCv(db, scope, input.env, {
    variantId: input.application.cv_variant_id,
    baseCvId: input.application.base_cv_id,
    primaryCvId:
      typeof input.facts.get(PROFILE_CV_KEY) === "string"
        ? (input.facts.get(PROFILE_CV_KEY) as string)
        : null,
    email: input.account,
  });
  const sources = paragraphSources(cv, input.facts);
  const posting = {
    title: input.posting.title,
    company_name: input.posting.company_name,
    description_text: input.posting.description_text,
  };
  const estimate = costMicroUsd(
    AI_MODELS.structured,
    estimateTokens(
      `${posting.description_text.slice(0, 6000)}${sources.bullets.map((b) => b.text).join("\n")}`
    ) + 600,
    PARAGRAPH_MAX_OUTPUT_TOKENS
  );
  const budget = await getAiBudgetStatus(db, scope, {
    env: input.env,
    now: input.now,
    timezone: input.settings.timezone,
    estimateMicroUsd: estimate,
  });
  if (budget.exhausted) {
    return skipped("budget_exhausted");
  }
  try {
    return await draftParagraph(input.provider(), {
      locale: input.locale,
      posting,
      sources,
    });
  } catch (err) {
    console.log(
      JSON.stringify({
        evt: "email_paragraph_failed",
        error: err instanceof Error ? err.name : "unknown",
      })
    );
    return skipped("unavailable");
  }
}

function renderFor(
  locale: Locale,
  facts: ReadonlyMap<string, unknown>,
  posting: EmailPostingRow,
  input: { paragraph: string | null; recipientName: string | null }
) {
  const factValues: Record<string, unknown> = {};
  for (const key of TEMPLATE_FACT_KEYS) {
    const value = facts.get(key);
    if (value !== undefined) {
      factValues[key] = value;
    }
  }
  return renderEmailTemplate({
    locale,
    facts: factValues,
    posting: {
      title: posting.title,
      company_name: posting.company_name,
      source_job_ref: posting.source_job_ref,
    },
    recipientName: input.recipientName,
    optionalParagraph: input.paragraph,
  });
}

function assertDelivery(delivery: EmailDelivery, flags: FeatureFlags): void {
  if (delivery === "server_send" && !flags.JOBS_EMAIL_SERVER_SEND_ENABLED) {
    throw apiError(
      "policy_violation",
      "Sending from pilihpendidikan is not available; use local hand-off.",
      {
        details: {
          reason: "server_send_disabled",
          flag: "JOBS_EMAIL_SERVER_SEND_ENABLED",
        },
      }
    );
  }
}

function resolveRecipient(
  requested: string | undefined,
  mailto: { to: string | null }
): string {
  if (requested !== undefined) {
    const address = normalizeRecipient(requested);
    if (!address) {
      throw invalidRequest("The recipient is not a valid email address.", [
        { path: ["to"], message: "one plain address, ≤ 254 characters" },
      ]);
    }
    return address;
  }
  if (mailto.to) {
    return mailto.to;
  }
  throw invalidRequest("Give the recipient address (to).", [
    { path: ["to"], message: "required: the posting has no mailto: link" },
  ]);
}

async function defaultAttachments(
  db: JobsDb,
  scope: UserScope,
  variantId: string | null
): Promise<string[]> {
  if (!variantId) {
    return [];
  }
  const variant = await loadCvVariant(db, scope, variantId);
  return variant?.status === "approved" && variant.file_id
    ? [variant.file_id]
    : [];
}

/** Plans the draft (validation, template, optional AI paragraph, batch). */
export async function planEmailDraft(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  input: DraftInput
): Promise<DraftPlan> {
  const { body, now } = input;
  const [application, posting] = await Promise.all([
    loadApplication(db, scope, applicationId),
    loadApplicationPosting(db, scope, applicationId),
  ]);
  if (!(application && posting)) {
    throw notFound("Application not found.");
  }
  assertDelivery(body.delivery, input.flags);
  if (body.draft_paragraph && body.body_text !== undefined) {
    throw invalidRequest(
      "draft_paragraph fills the template: omit body_text to use it.",
      [{ path: ["draft_paragraph"], message: "needs a templated body" }]
    );
  }
  const mailto = parseMailto(posting.apply_url);
  const to = resolveRecipient(body.to, mailto);
  const recipient = checkRecipient(to, {
    companyDomain: posting.company_domain,
    applyDomain: posting.apply_domain,
  });
  const fileIds =
    body.attachment_file_ids ??
    (await defaultAttachments(db, scope, application.cv_variant_id));
  const [files, facts, settings, account] = await Promise.all([
    loadFiles(db, scope, fileIds),
    loadFacts(db, scope, [
      ...TEMPLATE_FACT_KEYS,
      ...PARAGRAPH_FACT_KEYS,
      PROFILE_CV_KEY,
    ]),
    getUserSettings(db, scope, now),
    accountEmail(input.env, scope),
  ]);
  const attachments = checkAttachments(fileIds, files);
  const locale: Locale =
    body.locale ?? postingLocale(posting) ?? settings.locale ?? "en";
  const paragraph = body.draft_paragraph
    ? await maybeDraftParagraph(db, scope, {
        ...input,
        account: account.email,
        application,
        facts,
        locale,
        posting,
        settings,
      })
    : null;
  const rendered = renderFor(locale, facts, posting, {
    paragraph: paragraph?.paragraph ?? null,
    recipientName: body.recipient_name ?? null,
  });
  const subject = (body.subject ?? mailto.subject ?? rendered.subject).trim();
  const bodyText = (body.body_text ?? rendered.body_text).replace(
    CRLF_RE,
    "\n"
  );
  assertSubject(subject);
  assertBody(bodyText);
  const content: EmailContent = {
    to,
    cc: ccFor(body.delivery, account.email),
    subject,
    body_text: bodyText,
    attachments,
  };
  const hash = await emailPayloadHash(content);
  const email: EmailApplicationRecord = {
    id: newId("eml", now),
    user_id: scope.userId,
    application_id: application.id,
    to_address: to,
    subject,
    body_text: bodyText,
    attachment_file_ids: attachments.map((attachment) => attachment.file_id),
    delivery: body.delivery,
    status: "draft",
    provider_message_id: null,
    approved_at: null,
    sent_at: null,
    revision: 1,
    created_at: now,
    updated_at: now,
  };
  // An AI client cannot tick "this address belongs to the employer" for the
  // user (09 §1): an MCP draft records no tick; the user ticks on approval.
  const recipientConfirmed =
    body.recipient_confirmed === true && input.source !== "mcp";
  const aiDrafted = body.ai_drafted === true || paragraph?.status === "drafted";
  const approval = newApproval(scope, {
    applicationId: application.id,
    decided: null,
    hash,
    now,
    payload: approvalPayloadOf(email, content, {
      aiDrafted,
      recipientConfirmed,
    }),
  });
  const superseded = await listSupersededApprovals(db, scope, application.id);
  const statements: D1PreparedStatement[] = [
    ...insertEmailStatements(db, scope, email),
    ...expireApprovalStatements(db, scope, superseded, now),
    ...insertApprovalStatements(db, scope, approval),
    ...approvalEventStatements(db, scope, {
      actor: actorOf(input.source),
      approval,
      now,
    }),
  ];
  if (paragraph?.usage) {
    statements.push(
      ...recordAiUsageStatements(db, scope, {
        purpose: "email_draft",
        inputTokens: paragraph.usage.input_tokens,
        outputTokens: paragraph.usage.output_tokens,
        costMicroUsd: paragraph.usage.cost_micro_usd,
        now,
        timezone: settings.timezone,
      })
    );
  }
  const warnings = recipientWarnings(recipient);
  if (paragraph && paragraph.status !== "drafted") {
    warnings.push(`ai_paragraph_${paragraph.status}`);
  }
  if (attachments.length === 0) {
    warnings.push("no_attachment");
  }
  let aiParagraph: DraftReview["ai_paragraph"] = null;
  if (paragraph) {
    const { usage: _usage, ...rest } = paragraph;
    aiParagraph = rest;
  }
  return {
    email,
    approval,
    statements,
    review: {
      payload_hash: hash,
      locale,
      templated: {
        subject: body.subject === undefined && mailto.subject === null,
        body: body.body_text === undefined,
      },
      recipient: { ...recipient, confirmed: recipientConfirmed },
      warnings,
      ai_paragraph: aiParagraph,
    },
  };
}
