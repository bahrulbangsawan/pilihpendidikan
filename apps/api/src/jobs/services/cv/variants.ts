// CV variants (05 §7, 08): create (copy-only or AI tailoring), detail,
// render tickets, linking a rendered PDF, approve / reject, the render_cv
// fallback, failure and purge. Routes, the queue consumer, the cron and the
// automation area (leaf-2.7) all go through these functions; SQL lives in
// repo/cv and repo/files.
//
// Lifecycle (08 §4.1):
//   generating ──tailor_cv──▶ generating + tailored_cv_id ──PDF upload──▶ draft
//        │                                                  │      (auto-approve, 08 §7)
//        └──▶ failed                                         └──────────────▶ approved
//   draft ──approve──▶ approved (application.cv_variant_id, cv_variant_attached,
//                                 preparing → ready when the rule says so)
//   generating / draft / failed ──reject (or superseded by a newer variant)──▶ rejected

import type { CVData } from "@pilihpendidikan/cv-engine";
import { CVDataSchema } from "@pilihpendidikan/cv-engine";
import type { CvVariantDetail } from "@pilihpendidikan/jobs-contracts/api";
import type { CvVariantDiff } from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import type {
  ActorKind,
  ApprovalDecidedVia,
  ChangeSource,
  CvTemplate,
} from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { TailorCvMessageSchema } from "@pilihpendidikan/jobs-contracts/queue";
import type {
  ApplicationRecord,
  ApprovalRecord,
  CvVariantRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { z } from "zod";
import {
  createCvDocument,
  cvCanonicalSha256,
  deleteCvDocument,
  isTailoredCvId,
} from "../../../documents/cv-create";
import type { Env } from "../../../env";
import { AI_MODELS, costMicroUsd } from "../../ai/primitives";
import { MINUTE_MS } from "../../core/clock";
import { getFeatureFlags } from "../../core/flags";
import {
  apiError,
  insufficientScope,
  invalidTransition,
  notFound,
  upstreamUnavailable,
} from "../../core/http";
import { assertRevision } from "../../core/revision";
import type { UserScope } from "../../core/scope";
import type { GrantedVia } from "../../core/context";
import { assertAiBudget, getAiBudgetStatus } from "../../repo/core/ai-usage";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { GuardFailedError } from "../../repo/core/db";
import { getUserSettings } from "../../repo/core/settings";
import { findUserById } from "../../repo/core/users";
import {
  applicationEventStatements,
  attachRenderedFileStatements,
  closeApprovalsStatements,
  commitCvStatements,
  decideApprovalStatements,
  decideVariantStatements,
  deleteVariantsStatements,
  deviceHoldsRenderLease,
  failVariantStatements,
  hasPendingAnswerApprovals,
  insertVariantApprovalStatements,
  insertVariantStatements,
  listApplicationVariants,
  listSupersedableVariants,
  listVariantApprovals,
  liveRenderTask,
  loadApplicationRule,
  loadVariant,
  planApplicationChange,
  renderTaskStatements,
  supersedeVariantStatements,
} from "../../repo/cv";
import {
  loadFile,
  markFileDeletedStatements,
  setFileRetentionStatement,
  toFileView,
} from "../../repo/files";
import { UNREFERENCED_RETENTION_MS } from "../files/policy";
import { cvVariantPayloadHash } from "./canonical";
import type { IssuedRenderTicket } from "./ticket";
import { issueRenderTicket } from "./ticket";
import { copyAsTailored, isPureSelection } from "./tailoring/apply";

/** `cv_variants.model` of copy-only variants (no AI, M3). */
export const COPY_MODEL = "copy";
/** `diff.prompt_version` of copy-only variants. */
export const COPY_PROMPT_VERSION = "copy-v1";
/** 08 §4.1 step 8: no web render within 2 min → render_cv task. */
export const RENDER_FALLBACK_DELAY_MS = 2 * MINUTE_MS;
/** Expected cost of one tailoring call, for the up-front budget check. */
export const TAILOR_ESTIMATE_INPUT_TOKENS = 6000;
export const TAILOR_ESTIMATE_OUTPUT_TOKENS = 2000;

type TailorCvMessage = z.infer<typeof TailorCvMessageSchema>;

/** The tailoring model (`TAILOR_MODEL`, default 08 §4.3). */
export function tailorModel(env: Pick<Env, "TAILOR_MODEL">): string {
  return env.TAILOR_MODEL?.trim() || AI_MODELS.structured;
}

/** The `tailor_cv` message of a variant; `check` > 0 marks a render check. */
export function tailorCvMessage(
  userId: string,
  cvvId: string,
  check = 0
): TailorCvMessage {
  return {
    v: 1,
    type: "tailor_cv",
    message_id: check > 0 ? `rc${check}:${cvvId}` : `tailor:${cvvId}`,
    user_id: userId,
    cv_variant_id: cvvId,
  };
}

// ---------------------------------------------------------------------------
// Base CVs (CV_KV)
// ---------------------------------------------------------------------------

/** A CV document stamped to `email`, or null (missing or not owned). */
export async function loadOwnedCv(
  env: Pick<Env, "CV_KV">,
  email: string,
  cvId: string
): Promise<unknown | null> {
  const [doc, owner] = await Promise.all([
    env.CV_KV.get(`cv:${cvId}`, "json"),
    env.CV_KV.get(`owner:cv:${cvId}`),
  ]);
  return doc !== null && owner === email ? doc : null;
}

async function ownerEmail(
  env: Pick<Env, "DB">,
  scope: UserScope
): Promise<string> {
  const user = await findUserById(env.DB, scope.userId);
  if (!user || user.deleted_at !== null) {
    throw notFound("User not found.");
  }
  return user.email;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** AI kill switch (D-33), consent (04 §2.7) and the D-34 budget. */
export async function assertTailoringAllowed(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  now: number
): Promise<void> {
  const flags = await getFeatureFlags(env, now);
  if (flags.AI_DISABLED) {
    throw upstreamUnavailable("AI features are temporarily turned off.");
  }
  const settings = await getUserSettings(db, scope, now);
  if (settings.ai_consent_at === null) {
    throw apiError(
      "policy_violation",
      "Turn on AI features in Settings before tailoring a CV.",
      { details: { reason: "ai_consent_required" } }
    );
  }
  const model = tailorModel(env);
  const status = await getAiBudgetStatus(db, scope, {
    env,
    now,
    timezone: settings.timezone,
    estimateMicroUsd: costMicroUsd(
      model,
      TAILOR_ESTIMATE_INPUT_TOKENS,
      TAILOR_ESTIMATE_OUTPUT_TOKENS
    ),
  });
  assertAiBudget(status);
}

export interface CreateCvVariantInput {
  actorKind: ActorKind;
  applicationId: string;
  baseCvId: string;
  now: number;
  /** `last_change_source` of the application (default "system"). */
  source?: ChangeSource;
  tailor: boolean;
  template: CvTemplate;
}

export interface CreateCvVariantPlan {
  /** Sends the `tailor_cv` message; call only after the batch committed. */
  afterCommit: () => Promise<void>;
  cvVariantId: string;
  statements: D1PreparedStatement[];
  /** The variant as the batch writes it (202 body). */
  variant: CvVariantRecord;
}

/**
 * Plans a new variant for an application (05 §7, 08 §4.1): the `generating`
 * row, superseding the application's in-flight variants (08 §10), and the
 * system stage move saved → preparing with `base_cv_id`. The base CV must be
 * the user's own document; tailoring also needs AI consent and budget.
 */
export async function planCreateCvVariant(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  input: CreateCvVariantInput
): Promise<CreateCvVariantPlan> {
  const app = await loadApplication(db, scope, input.applicationId);
  if (!app) {
    throw notFound("Application not found.");
  }
  const email = await ownerEmail(env, scope);
  const base = await loadOwnedCv(env, email, input.baseCvId);
  if (base === null) {
    throw notFound("Base CV not found.");
  }
  if (!CVDataSchema.safeParse(base).success) {
    throw apiError(
      "policy_violation",
      "This CV cannot be used as a base: open it in the CV builder and save it once.",
      { details: { reason: "base_cv_invalid" } }
    );
  }
  if (input.tailor) {
    await assertTailoringAllowed(db, scope, env, input.now);
  }
  const id = newId("cvv", input.now);
  const model = input.tailor ? null : COPY_MODEL;
  const superseded = await listSupersedableVariants(db, scope, app.id);
  const staleApprovals: string[] = [];
  for (const old of superseded) {
    for (const approval of await listVariantApprovals(db, scope, old.id)) {
      if (approval.state === "pending") {
        staleApprovals.push(approval.id);
      }
    }
  }
  const change = await planApplicationChange(db, scope, app.id, {
    now: input.now,
    source: input.source ?? "system",
    stage: {
      to: "preparing",
      reason:
        input.actorKind === "system"
          ? "rule_cv_policy"
          : "cv_variant_requested",
    },
    fields: { base_cv_id: input.baseCvId },
    eventKeyPrefix: `cvv:${id}`,
  });
  const statements = [
    ...change.statements,
    ...supersedeVariantStatements(
      db,
      scope,
      superseded.map((v) => v.id),
      input.now
    ),
    ...closeApprovalsStatements(
      db,
      scope,
      staleApprovals,
      "expired",
      input.now
    ),
    ...insertVariantStatements(db, scope, {
      id,
      applicationId: app.id,
      baseCvId: input.baseCvId,
      template: input.template,
      model,
      now: input.now,
    }),
  ];
  const variant: CvVariantRecord = {
    id,
    user_id: scope.userId,
    application_id: app.id,
    base_cv_id: input.baseCvId,
    tailored_cv_id: null,
    template: input.template,
    status: "generating",
    file_id: null,
    diff: {},
    model,
    approved_at: null,
    revision: 1,
    created_at: input.now,
    updated_at: input.now,
  } as CvVariantRecord;
  return {
    cvVariantId: id,
    variant,
    statements,
    afterCommit: async () => {
      try {
        await env.JOBS_AI_QUEUE.send(tailorCvMessage(scope.userId, id));
      } catch (err) {
        // Never leave a variant generating forever: fail it so the user can retry.
        await commitCvStatements(
          db,
          failVariantStatements(db, scope, {
            id,
            diff: null,
            model: null,
            now: input.now,
          })
        ).catch(() => undefined);
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function storedDocSha(diff: CvVariantRecord["diff"]): string | null {
  return "tailored_cv_sha256" in diff &&
    typeof diff.tailored_cv_sha256 === "string"
    ? diff.tailored_cv_sha256
    : null;
}

/**
 * True when an approved variant's document no longer matches the canonical
 * hash recorded with its PDF (08 §5: edited in apps/cv after approval, or
 * deleted).
 */
export async function editedAfterApproval(
  env: Pick<Env, "CV_KV">,
  variant: CvVariantRecord,
  doc?: unknown
): Promise<boolean> {
  if (variant.status !== "approved" || !variant.tailored_cv_id) {
    return false;
  }
  const stored = storedDocSha(variant.diff);
  const current =
    doc === undefined
      ? await env.CV_KV.get(`cv:${variant.tailored_cv_id}`, "json")
      : doc;
  if (current === null) {
    return true;
  }
  return stored !== null && (await cvCanonicalSha256(current)) !== stored;
}

/** `GET /api/v1/cv-variants/{cvv_id}` (05 §7). */
export async function getCvVariantDetail(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  options: { cvvId: string; includeCvData: boolean }
): Promise<CvVariantDetail> {
  const variant = await loadVariant(db, scope, options.cvvId);
  if (!variant) {
    throw notFound("CV variant not found.");
  }
  const file = variant.file_id
    ? await loadFile(db, scope, variant.file_id)
    : null;
  const needsDoc =
    variant.tailored_cv_id !== null &&
    (options.includeCvData || variant.status === "approved");
  const doc = needsDoc
    ? await env.CV_KV.get(`cv:${variant.tailored_cv_id}`, "json")
    : undefined;
  const detail: CvVariantDetail = {
    cv_variant: variant,
    file: file ? toFileView(file) : null,
    edited_after_approval: await editedAfterApproval(env, variant, doc),
  };
  if (options.includeCvData) {
    detail.tailored_cv = (doc ?? null) as Record<string, unknown> | null;
  }
  return detail;
}

// ---------------------------------------------------------------------------
// Render tickets
// ---------------------------------------------------------------------------

function assertRenderable(variant: CvVariantRecord): void {
  if (
    !(variant.status === "generating" || variant.status === "draft") ||
    variant.tailored_cv_id === null
  ) {
    throw invalidTransition("This CV variant has nothing to render.", {
      reason: "not_renderable",
      status: variant.status,
    });
  }
}

/**
 * `POST /api/v1/cv-variants/{cvv_id}/render-ticket` (08 §6.4): to the web
 * (`cv:write`) or to a device holding a live lease on the variant's
 * render_cv task (`automation:execute`).
 */
export async function issueVariantRenderTicket(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  options: {
    cvvId: string;
    deviceId: string | null;
    grantedVia: GrantedVia;
    now: number;
  }
): Promise<IssuedRenderTicket> {
  const variant = await loadVariant(db, scope, options.cvvId);
  if (!variant) {
    throw notFound("CV variant not found.");
  }
  if (options.grantedVia === "alt_scope") {
    const leased =
      options.deviceId !== null &&
      (await deviceHoldsRenderLease(db, scope, {
        cvvId: variant.id,
        deviceId: options.deviceId,
        now: options.now,
      }));
    if (!leased) {
      throw insufficientScope(["cv:write"]);
    }
  }
  assertRenderable(variant);
  return await issueRenderTicket(env, {
    userId: scope.userId,
    cvvId: variant.id,
    now: options.now,
  });
}

/**
 * 08 §6.5 pre-check before an upload streams: the linked variant is the
 * caller's and is `generating` (first render) or `draft` (re-render) with a
 * tailored document. The commit batch re-checks it with a guard.
 */
export async function assertVariantAcceptsPdf(
  db: JobsDb,
  scope: UserScope,
  cvvId: string
): Promise<void> {
  const variant = await loadVariant(db, scope, cvvId);
  if (!variant) {
    throw notFound("CV variant not found.");
  }
  assertRenderable(variant);
}

// ---------------------------------------------------------------------------
// Rendered PDF → draft (or auto-approved)
// ---------------------------------------------------------------------------

// 06 §3 / 03 §5.1: preparing → ready on approval only when the application's
// rule (an enabled rule of any mode) or the application's own mode (not
// "manual") calls for it, and no `answer` approval is still open.
async function readyRuleApplies(
  db: JobsDb,
  scope: UserScope,
  app: ApplicationRecord
): Promise<boolean> {
  if (app.stage !== "preparing") {
    return false;
  }
  if (await hasPendingAnswerApprovals(db, scope, app.id)) {
    return false;
  }
  const rule = await loadApplicationRule(db, scope, app.automation_rule_id);
  if (rule?.enabled) {
    return true;
  }
  return app.mode !== "manual";
}

// 08 §7: auto mode + require_cv_approval = false + no model-written text.
async function autoApproveApplies(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  app: ApplicationRecord | null,
  diff: CvVariantDiff,
  now: number
): Promise<boolean> {
  if (!(app && isPureSelection(diff))) {
    return false;
  }
  const rule = await loadApplicationRule(db, scope, app.automation_rule_id);
  if (
    !rule?.enabled ||
    rule.mode !== "auto" ||
    rule.activated_approval_id === null ||
    rule.cv_policy.require_cv_approval !== false
  ) {
    return false;
  }
  return (await getFeatureFlags(env, now)).JOBS_AUTO_MODE_ENABLED;
}

function approvalPayload(
  variant: CvVariantRecord,
  file: { id: string; sha256: string },
  diff: CvVariantDiff
): Record<string, unknown> {
  return {
    type: "cv_variant",
    cv_variant_id: variant.id,
    file_id: file.id,
    sha256: file.sha256,
    template: variant.template,
    rephrased_bullets: diff.bullets.filter(
      (b) => b.operation === "rephrase" || b.operation === "merge"
    ).length,
    notes_for_user: diff.notes_for_user,
  };
}

function asDiff(variant: CvVariantRecord): CvVariantDiff | null {
  return "prompt_version" in variant.diff
    ? (variant.diff as CvVariantDiff)
    : null;
}

async function pendingApprovalIds(
  db: JobsDb,
  scope: UserScope,
  cvvId: string
): Promise<string[]> {
  return (await listVariantApprovals(db, scope, cvvId))
    .filter((a) => a.state === "pending")
    .map((a) => a.id);
}

export interface AttachPlan {
  autoApproved: boolean;
  statements: D1PreparedStatement[];
}

/**
 * The statements linking an uploaded `cv_pdf` to its variant (08 §6.5):
 * `file_id`, `status = 'draft'` and a `cv_variant` approval bound to
 * `payload_hash = sha256(file.sha256 + canonical diff)` — or, when the rule
 * auto-approves (08 §7), `approved` and attached to the application. A
 * re-render expires the previous approval and starts the old PDF's 30-day
 * orphan clock. Runs inside the upload's commit batch.
 */
export async function planAttachRenderedFile(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  input: {
    cvvId: string;
    file: { id: string; sha256: string };
    now: number;
    source: ChangeSource;
  }
): Promise<AttachPlan> {
  const variant = await loadVariant(db, scope, input.cvvId);
  if (!variant) {
    throw notFound("CV variant not found.");
  }
  assertRenderable(variant);
  const stored = asDiff(variant);
  if (!stored) {
    throw invalidTransition("This CV variant has nothing to render.", {
      reason: "not_renderable",
    });
  }
  const doc = await env.CV_KV.get(`cv:${variant.tailored_cv_id}`, "json");
  const diff: CvVariantDiff = {
    ...stored,
    tailored_cv_sha256:
      doc === null ? stored.tailored_cv_sha256 : await cvCanonicalSha256(doc),
  };
  const app = variant.application_id
    ? await loadApplication(db, scope, variant.application_id)
    : null;
  const auto = await autoApproveApplies(db, scope, env, app, diff, input.now);
  const payload = approvalPayload(variant, input.file, diff);
  const payloadHash = await cvVariantPayloadHash(input.file.sha256, diff);
  const approvalId = newId("apr", input.now);
  const statements: D1PreparedStatement[] = [
    ...attachRenderedFileStatements(db, scope, {
      variant,
      fileId: input.file.id,
      diff,
      status: auto ? "approved" : "draft",
      approvedAt: auto ? input.now : null,
      now: input.now,
    }),
    ...closeApprovalsStatements(
      db,
      scope,
      await pendingApprovalIds(db, scope, variant.id),
      "expired",
      input.now
    ),
    ...insertVariantApprovalStatements(db, scope, {
      id: approvalId,
      applicationId: variant.application_id,
      payload,
      payloadHash,
      state: auto ? "approved" : "pending",
      decidedVia: null,
      now: input.now,
    }),
  ];
  if (variant.file_id && variant.file_id !== input.file.id) {
    statements.push(
      setFileRetentionStatement(
        db,
        scope,
        variant.file_id,
        input.now + UNREFERENCED_RETENTION_MS
      )
    );
  }
  if (app && auto) {
    const change = await planApplicationChange(db, scope, app.id, {
      now: input.now,
      source: "system",
      stage: (await readyRuleApplies(db, scope, app))
        ? { to: "ready", reason: "cv_variant_auto_approved" }
        : undefined,
      fields: { cv_variant_id: variant.id },
      eventKeyPrefix: `cvv:${variant.id}:${approvalId}`,
      events: [
        {
          applicationId: app.id,
          type: "approval_decided",
          actorKind: "system",
          payload: {
            approval_id: approvalId,
            kind: "cv_variant",
            decision: "approved",
            auto: true,
          },
        },
        {
          applicationId: app.id,
          type: "cv_variant_attached",
          actorKind: "system",
          payload: {
            cv_variant_id: variant.id,
            file_id: input.file.id,
            sha256: input.file.sha256,
          },
        },
      ],
    });
    statements.push(...change.statements);
  } else if (app) {
    statements.push(
      ...applicationEventStatements(
        db,
        scope,
        [
          {
            applicationId: app.id,
            type: "approval_requested",
            actorKind: "system",
            payload: { approval_id: approvalId, kind: "cv_variant" },
          },
        ],
        input.now
      )
    );
  }
  return { statements, autoApproved: auto };
}

// ---------------------------------------------------------------------------
// Approve / reject
// ---------------------------------------------------------------------------

export interface DecisionInput {
  /** `base_revision` of the variant (D-21); null skips the check (approval route). */
  baseRevision: number | null;
  cvvId: string;
  decidedVia: ApprovalDecidedVia;
  now: number;
  /** When deciding through an approval (05 §8 decide), the hash it shows. */
  payloadHash?: string;
  reason?: string;
  source: ChangeSource;
}

export interface DecisionPlan {
  application: ApplicationRecord | null;
  statements: D1PreparedStatement[];
  variant: CvVariantRecord;
}

/**
 * MCP may decide `cv_variant` approvals only when the user allowed it
 * (`user_settings.allow_mcp_approvals`, 04 §2.7); web and CLI always may.
 */
async function assertDecider(
  db: JobsDb,
  scope: UserScope,
  input: Pick<DecisionInput, "decidedVia" | "now">
): Promise<void> {
  if (input.decidedVia !== "mcp") {
    return;
  }
  const settings = await getUserSettings(db, scope, input.now);
  if (!settings.allow_mcp_approvals) {
    throw apiError(
      "policy_violation",
      "Approving CVs from an AI assistant is turned off in Settings.",
      { details: { reason: "mcp_approvals_disabled" } }
    );
  }
}

/** The event actor of a decision (MCP decisions are `mcp`, 03 §6). */
function deciderKind(via: ApprovalDecidedVia): ActorKind {
  return via === "mcp" ? "mcp" : "user";
}

function decided(
  variant: CvVariantRecord,
  status: "approved" | "rejected",
  now: number
): CvVariantRecord {
  return {
    ...variant,
    status,
    approved_at: status === "approved" ? now : null,
    revision: variant.revision + 1,
    updated_at: now,
  };
}

async function pendingApprovalFor(
  db: JobsDb,
  scope: UserScope,
  cvvId: string
): Promise<{ latest: ApprovalRecord | null; pending: ApprovalRecord | null }> {
  const approvals = await listVariantApprovals(db, scope, cvvId);
  return {
    pending: approvals.find((a) => a.state === "pending") ?? null,
    latest: approvals[0] ?? null,
  };
}

/**
 * Approve (05 §7): needs a `ready` PDF and the pending approval whose
 * `payload_hash` matches the current file + diff (a re-render invalidates
 * it, T8-10). Attaches the variant to its application (`cv_variant_id`,
 * `cv_variant_attached`) and moves preparing → ready when the rule says so.
 */
export async function planApproveCvVariant(
  db: JobsDb,
  scope: UserScope,
  input: DecisionInput
): Promise<DecisionPlan> {
  await assertDecider(db, scope, input);
  const variant = await loadVariant(db, scope, input.cvvId);
  if (!variant) {
    throw notFound("CV variant not found.");
  }
  if (input.baseRevision !== null) {
    assertRevision(variant, input.baseRevision);
  }
  if (variant.status !== "draft") {
    throw invalidTransition(
      `A ${variant.status} CV variant cannot be approved.`,
      {
        reason: "not_draft",
        status: variant.status,
      }
    );
  }
  const file = variant.file_id
    ? await loadFile(db, scope, variant.file_id)
    : null;
  const diff = asDiff(variant);
  if (!(file && file.status === "ready" && file.kind === "cv_pdf" && diff)) {
    throw invalidTransition("Render the PDF before approving this CV.", {
      reason: "pdf_not_ready",
    });
  }
  const expected = await cvVariantPayloadHash(file.sha256, diff);
  const { pending, latest } = await pendingApprovalFor(db, scope, variant.id);
  if (!pending) {
    if (latest?.state === "expired") {
      throw apiError(
        "approval_expired",
        "This approval expired. Render the PDF again."
      );
    }
    throw invalidTransition("This CV variant has no open approval.", {
      reason: "approval_missing",
    });
  }
  if (
    pending.payload_hash !== expected ||
    (input.payloadHash !== undefined &&
      input.payloadHash !== pending.payload_hash)
  ) {
    throw apiError(
      "policy_violation",
      "The PDF or the changes differ from what this approval shows. Render it again.",
      { details: { reason: "payload_hash_mismatch" } }
    );
  }
  const statements = [
    ...decideVariantStatements(db, scope, {
      variant,
      status: "approved",
      now: input.now,
    }),
    ...decideApprovalStatements(db, scope, {
      approval: pending,
      state: "approved",
      decidedVia: input.decidedVia,
      response: null,
      now: input.now,
    }),
  ];
  let application: ApplicationRecord | null = null;
  const app = variant.application_id
    ? await loadApplication(db, scope, variant.application_id)
    : null;
  if (app) {
    const change = await planApplicationChange(db, scope, app.id, {
      now: input.now,
      source: input.source,
      stage: (await readyRuleApplies(db, scope, app))
        ? { to: "ready", reason: "cv_variant_approved" }
        : undefined,
      fields: { cv_variant_id: variant.id },
      eventKeyPrefix: `cvv:${variant.id}:${pending.id}`,
      events: [
        {
          applicationId: app.id,
          type: "approval_decided",
          actorKind: deciderKind(input.decidedVia),
          payload: {
            approval_id: pending.id,
            kind: "cv_variant",
            decision: "approved",
          },
        },
        {
          applicationId: app.id,
          type: "cv_variant_attached",
          actorKind: deciderKind(input.decidedVia),
          payload: {
            cv_variant_id: variant.id,
            file_id: file.id,
            sha256: file.sha256,
          },
        },
      ],
    });
    statements.push(...change.statements);
    application = change.after;
  }
  return {
    statements,
    variant: decided(variant, "approved", input.now),
    application,
  };
}

/** Reject (05 §7): generating / draft / failed → rejected; its pending approval too. */
export async function planRejectCvVariant(
  db: JobsDb,
  scope: UserScope,
  input: DecisionInput
): Promise<DecisionPlan> {
  await assertDecider(db, scope, input);
  const variant = await loadVariant(db, scope, input.cvvId);
  if (!variant) {
    throw notFound("CV variant not found.");
  }
  if (input.baseRevision !== null) {
    assertRevision(variant, input.baseRevision);
  }
  if (!["generating", "draft", "failed"].includes(variant.status)) {
    throw invalidTransition(
      `A ${variant.status} CV variant cannot be rejected.`,
      {
        reason: "not_rejectable",
        status: variant.status,
      }
    );
  }
  const { pending } = await pendingApprovalFor(db, scope, variant.id);
  if (
    input.payloadHash !== undefined &&
    pending?.payload_hash !== input.payloadHash
  ) {
    throw apiError(
      "policy_violation",
      "The approval changed since it was shown.",
      { details: { reason: "payload_hash_mismatch" } }
    );
  }
  const statements = [
    ...decideVariantStatements(db, scope, {
      variant,
      status: "rejected",
      now: input.now,
    }),
  ];
  if (pending) {
    statements.push(
      ...decideApprovalStatements(db, scope, {
        approval: pending,
        state: "rejected",
        decidedVia: input.decidedVia,
        response: input.reason ? { note: input.reason } : null,
        now: input.now,
      })
    );
    if (variant.application_id) {
      statements.push(
        ...applicationEventStatements(
          db,
          scope,
          [
            {
              applicationId: variant.application_id,
              type: "approval_decided",
              actorKind: deciderKind(input.decidedVia),
              payload: {
                approval_id: pending.id,
                kind: "cv_variant",
                decision: "rejected",
              },
            },
          ],
          input.now
        )
      );
    }
  }
  return {
    statements,
    variant: decided(variant, "rejected", input.now),
    application: null,
  };
}

/**
 * Decides a `cv_variant` approval by id (for `POST /api/v1/approvals/{id}/
 * decide`, leaf-2.7): resolves the variant from the approval payload and
 * applies approve / reject with the shown `payload_hash`.
 */
export async function planCvVariantApprovalDecision(
  db: JobsDb,
  scope: UserScope,
  input: {
    approval: ApprovalRecord;
    decidedVia: ApprovalDecidedVia;
    decision: "approve" | "reject";
    now: number;
    payloadHash: string;
    reason?: string;
    source: ChangeSource;
  }
): Promise<DecisionPlan> {
  const cvvId =
    input.approval.payload.type === "cv_variant"
      ? input.approval.payload.cv_variant_id
      : null;
  if (!cvvId) {
    throw notFound("CV variant approval not found.");
  }
  const decision: DecisionInput = {
    cvvId,
    baseRevision: null,
    decidedVia: input.decidedVia,
    now: input.now,
    payloadHash: input.payloadHash,
    reason: input.reason,
    source: input.source,
  };
  return input.decision === "approve"
    ? await planApproveCvVariant(db, scope, decision)
    : await planRejectCvVariant(db, scope, decision);
}

// ---------------------------------------------------------------------------
// Tailored documents, failure, render fallback, purge
// ---------------------------------------------------------------------------

/** Writes the tailored document (private, `-t-` slug) as the user's own CV. */
export async function saveTailoredDocument(
  env: Pick<Env, "CV_KV">,
  email: string,
  slug: string,
  cv: CVData
): Promise<boolean> {
  const result = await createCvDocument(env, { email }, slug, cv, {
    replaceOwned: true,
  });
  return result.ok;
}

/** A copy-only variant's document and diff (no AI). */
export function copyVariant(base: CVData, template: CvTemplate) {
  return copyAsTailored(base, template, {
    model: COPY_MODEL,
    promptVersion: COPY_PROMPT_VERSION,
  });
}

/**
 * Fails a `generating` variant (validation, budget, missing inputs, the DLQ).
 * `extra` statements (AI usage of a spent call) join the same batch. Returns
 * false when the variant had already left `generating`.
 */
export async function failCvVariant(
  db: JobsDb,
  scope: UserScope,
  input: {
    cvvId: string;
    diff?: CvVariantDiff | null;
    extra?: readonly D1PreparedStatement[];
    model?: string | null;
    now: number;
  }
): Promise<boolean> {
  try {
    await commitCvStatements(db, [
      ...failVariantStatements(db, scope, {
        id: input.cvvId,
        diff: input.diff ?? null,
        model: input.model ?? null,
        now: input.now,
      }),
      ...(input.extra ?? []),
    ]);
    return true;
  } catch (err) {
    if (err instanceof GuardFailedError) {
      return false;
    }
    throw err;
  }
}

/**
 * The render_cv fallback (08 §4.1 step 8, 21 §4): a queued task for any
 * device with `render_cv`, once per variant. False when one already exists.
 */
export async function ensureRenderFallbackTask(
  db: JobsDb,
  scope: UserScope,
  input: { applicationId: string | null; cvvId: string; now: number }
): Promise<boolean> {
  if (await liveRenderTask(db, scope, input.cvvId)) {
    return false;
  }
  const { statements } = renderTaskStatements(db, scope, {
    cvvId: input.cvvId,
    applicationId: input.applicationId,
    actorKind: "system",
    now: input.now,
  });
  await commitCvStatements(db, statements);
  return true;
}

/**
 * Purge of an application's CV data (06 §8 hard delete, 08 §9): variants and
 * their approvals (statements for the caller's batch), then — after commit —
 * the tailored documents and the R2 PDFs.
 */
export async function planPurgeApplicationCvVariants(
  db: JobsDb,
  scope: UserScope,
  env: Env,
  input: { applicationId: string; now: number }
): Promise<{
  afterCommit: () => Promise<void>;
  statements: D1PreparedStatement[];
}> {
  const variants = await listApplicationVariants(
    db,
    scope,
    input.applicationId
  );
  const statements = deleteVariantsStatements(
    db,
    scope,
    variants.map((v) => v.id),
    input.now
  );
  const r2Keys: string[] = [];
  for (const variant of variants) {
    const file = variant.file_id
      ? await loadFile(db, scope, variant.file_id)
      : null;
    if (file && file.status !== "deleted") {
      statements.push(
        ...markFileDeletedStatements(db, scope, file.id, input.now)
      );
      r2Keys.push(file.r2_key);
    }
  }
  const docs = variants
    .map((v) => v.tailored_cv_id)
    .filter((id): id is string => id !== null && isTailoredCvId(id));
  return {
    statements,
    afterCommit: async () => {
      for (const id of docs) {
        await deleteCvDocument(env, id);
      }
      if (r2Keys.length > 0) {
        await env.JOBS_FILES.delete(r2Keys);
      }
    },
  };
}
