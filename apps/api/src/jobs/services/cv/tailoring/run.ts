// The `tailor_cv` consumer (08 §4.1, 14 §6).
//
// A message for a `generating` variant WITHOUT a tailored document tailors:
//   1. base CV from CV_KV, owner stamp = the user's email (users.email)
//   2. copy-only variants (model "copy"): copy, no AI
//      AI variants: kill switch, consent, D-34 budget; flattenCvBullets →
//      numbered bullets; the posting fenced as untrusted (≤ 12 KB);
//      Responses Structured Outputs → CvTailoringPatch (store: false)
//   3. validator V1–V10; hard violations get ONE repair round-trip with the
//      violation list, then the variant fails; V4/V5 bullets fall back to
//      keep, a V6 summary keeps the existing one
//   4. applyPatch + CVDataSchema → private, photo-free CVData in the variant's
//      template, saved under the deterministic HMAC slug (a retry rewrites
//      the same document)
//   5. one batch: tailored_cv_id + diff (08 §4.5, with the canonical sha256)
//      + model, one-shot on `generating AND tailored_cv_id IS NULL`, plus the
//      AI usage counters (a retried message never counts twice)
//   6. a delayed render check (the same message type, 2 min later)
// A message for a variant that HAS its document is that render check: still
// no PDF 2 min after tailoring → a `render_cv` task (21 §4) for the CLI.
// Anything else (missing, other user, not generating) is acked untouched.

import type { CVData } from "@pilihpendidikan/cv-engine";
import { CVDataSchema, flattenCvBullets } from "@pilihpendidikan/cv-engine";
import type {
  CvBullet,
  CvTailoringPatch,
  CvVariantDiff,
} from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import {
  CV_TAILORING_PATCH_JSON_SCHEMA,
  CvTailoringPatchSchema,
  TAILOR_PROMPT_VERSION,
} from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import type { JobsAiMessageOf } from "@pilihpendidikan/jobs-contracts/queue";
import type { CvVariantRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { AiUsage } from "../../../ai/primitives";
import {
  costMicroUsd,
  estimateTokens,
  isAiProviderError,
} from "../../../ai/primitives";
import { getFeatureFlags } from "../../../core/flags";
import type { QueueContext, QueueOutcome } from "../../../queue/types";
import { ACK } from "../../../queue/types";
import {
  getAiBudgetStatus,
  recordAiUsageStatements,
} from "../../../repo/core/ai-usage";
import { GuardFailedError } from "../../../repo/core/db";
import { getUserSettings } from "../../../repo/core/settings";
import { findUserById } from "../../../repo/core/users";
import {
  commitCvStatements,
  completeTailoringStatements,
  loadFactsByKey,
  loadTailoringPosting,
  loadVariant,
} from "../../../repo/cv";
import {
  cvCanonicalSha256,
  deleteCvDocument,
} from "../../../../documents/cv-create";
import { tailoredCvSlug } from "../slug";
import {
  COPY_MODEL,
  copyVariant,
  ensureRenderFallbackTask,
  failCvVariant,
  loadOwnedCv,
  RENDER_FALLBACK_DELAY_MS,
  saveTailoredDocument,
  TAILOR_ESTIMATE_OUTPUT_TOKENS,
  tailorCvMessage,
  tailorModel,
} from "../variants";
import type { AppliedTailoring } from "./apply";
import { applyPatch, fullSectionOrder } from "./apply";
import {
  buildRepairInput,
  buildTailorInput,
  TAILOR_INSTRUCTIONS,
} from "./prompt";
import { postingTermsOf } from "./tokens";
import type { TailoringContext, ValidationResult } from "./validate";
import { formatViolations, validatePatch } from "./validate";

type TailorQc = QueueContext<JobsAiMessageOf<"tailor_cv">>;

/** Facts a summary may cite (V6): non-contact, non-sensitive, CV-relevant. */
export const TAILOR_FACT_KEYS = ["skills.extra", "profile.languages"] as const;
/** Delayed render checks after the first one (bounded re-sends). */
export const MAX_RENDER_CHECKS = 3;
const MAX_OUTPUT_TOKENS = 4000;
const CHECK_ID_RE = /^rc(\d+):/;

class TailoringFailure extends Error {
  readonly reason: string;
  readonly violations: string[];
  constructor(reason: string, violations: string[] = []) {
    super(reason);
    this.name = "TailoringFailure";
    this.reason = reason;
    this.violations = violations;
  }
}

function factText(key: string, value: unknown): string | null {
  if (key === "skills.extra" && Array.isArray(value)) {
    return value.filter((v) => typeof v === "string").join(", ") || null;
  }
  if (key === "profile.languages" && Array.isArray(value)) {
    const parts = value
      .map((v) => {
        const lang = v as { code?: unknown; level?: unknown };
        return typeof lang.code === "string"
          ? `${lang.code}${typeof lang.level === "string" ? ` (${lang.level})` : ""}`
          : null;
      })
      .filter((v): v is string => v !== null);
    return parts.join(", ") || null;
  }
  return null;
}

/** The patch the fake provider returns in dev: keep everything as it is. */
export function identityPatch(base: CVData): CvTailoringPatch {
  return {
    section_order: fullSectionOrder(base.sectionOrder),
    include_entries: [],
    bullets: [],
    summary: { text: "", source_bullet_ids: [], source_fact_keys: [] },
    skills_order: [],
    notes_for_user: [],
  };
}

interface ModelCall {
  model: string;
  patch: CvTailoringPatch | null;
  problem: string | null;
  usage: AiUsage | null;
}

async function callModel(
  qc: TailorQc,
  base: CVData,
  model: string,
  input: string
): Promise<ModelCall> {
  try {
    const result = await qc.ai().structured<CvTailoringPatch>({
      name: CV_TAILORING_PATCH_JSON_SCHEMA.name,
      schema: CV_TAILORING_PATCH_JSON_SCHEMA.schema as unknown as Record<
        string,
        unknown
      >,
      validator: CvTailoringPatchSchema,
      instructions: TAILOR_INSTRUCTIONS,
      input,
      model,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      fake: () => identityPatch(base),
    });
    return {
      model: result.model,
      patch: result.output,
      problem: result.output
        ? null
        : `refusal: ${result.refusal ?? "no output"}`,
      usage: result.usage,
    };
  } catch (err) {
    if (isAiProviderError(err) && err.kind === "invalid_output") {
      return {
        model,
        patch: null,
        problem: "The output did not match the patch schema.",
        usage: null,
      };
    }
    if (isAiProviderError(err) && !err.retryable) {
      throw new TailoringFailure(`ai_error:${err.kind}`);
    }
    // Retryable (429 / 5xx / timeout): the queue retries the message.
    throw err;
  }
}

function failureDiff(
  base: CVData | null,
  model: string,
  reason: string,
  violations: readonly string[]
): CvVariantDiff {
  const order = fullSectionOrder(base?.sectionOrder ?? []);
  return {
    prompt_version: TAILOR_PROMPT_VERSION,
    model,
    section_order: { from: order, to: order },
    excluded_entries: [],
    bullets: [],
    summary: null,
    notes_for_user: [],
    validator: {
      fallbacks_to_keep: 0,
      violations: [`failed: ${reason}`, ...violations],
    },
  };
}

interface Tailored {
  applied: AppliedTailoring;
  model: string;
  usages: AiUsage[];
}

function usageStatements(
  qc: TailorQc,
  usages: readonly AiUsage[],
  timezone: string
): D1PreparedStatement[] {
  if (usages.length === 0) {
    return [];
  }
  return recordAiUsageStatements(qc.db, qc.scope, {
    purpose: "tailor_cv",
    calls: usages.length,
    inputTokens: usages.reduce((n, u) => n + u.input_tokens, 0),
    outputTokens: usages.reduce((n, u) => n + u.output_tokens, 0),
    costMicroUsd: usages.reduce((n, u) => n + u.cost_micro_usd, 0),
    now: qc.now,
    timezone,
  });
}

interface Prepared {
  ctx: TailoringContext;
  input: string;
  model: string;
}

async function loadFacts(qc: TailorQc): Promise<Map<string, string>> {
  const facts = new Map<string, string>();
  const stored = await loadFactsByKey(qc.db, qc.scope, TAILOR_FACT_KEYS);
  for (const [key, value] of stored) {
    const text = factText(key, value);
    if (text) {
      facts.set(key, text);
    }
  }
  return facts;
}

// Kill switch, consent, posting, facts, prompt and the D-34 budget.
async function prepareTailoring(
  qc: TailorQc,
  variant: CvVariantRecord,
  base: CVData,
  timezone: string
): Promise<Prepared> {
  const { db, scope, env, now } = qc;
  if ((await getFeatureFlags(env, now)).AI_DISABLED) {
    throw new TailoringFailure("ai_disabled");
  }
  const settings = await getUserSettings(db, scope, now);
  if (settings.ai_consent_at === null) {
    throw new TailoringFailure("ai_consent_required");
  }
  const posting = variant.application_id
    ? await loadTailoringPosting(db, scope, variant.application_id)
    : null;
  if (!posting) {
    throw new TailoringFailure("posting_missing");
  }
  const facts = await loadFacts(qc);
  const bullets: CvBullet[] = flattenCvBullets(base);
  const postingText = [
    posting.title,
    posting.company_name,
    ...posting.requirements,
    posting.description_text,
  ].join("\n");
  const ctx: TailoringContext = {
    base,
    bullets,
    facts,
    postingTerms: postingTermsOf(postingText),
  };
  const model = tailorModel(env);
  const input = buildTailorInput({ base, bullets, facts, posting });
  const budget = await getAiBudgetStatus(db, scope, {
    env,
    now,
    timezone,
    estimateMicroUsd: costMicroUsd(
      model,
      estimateTokens(`${TAILOR_INSTRUCTIONS}\n${input}`),
      TAILOR_ESTIMATE_OUTPUT_TOKENS
    ),
  });
  if (budget.exhausted) {
    throw new TailoringFailure("ai_budget_exhausted");
  }
  return { ctx, input, model };
}

interface AcceptedPatch {
  model: string;
  patch: CvTailoringPatch;
  validation: ValidationResult;
}

function hardProblems(
  call: ModelCall,
  validation: ValidationResult | null
): string[] {
  return validation
    ? formatViolations(validation.hard)
    : [call.problem ?? "no patch"];
}

// One call, and one repair round-trip when the patch breaks V1–V3 / V7.
async function patchWithRepair(
  qc: TailorQc,
  base: CVData,
  prepared: Prepared,
  usages: AiUsage[]
): Promise<AcceptedPatch> {
  const attempt = async (input: string) => {
    const call = await callModel(qc, base, prepared.model, input);
    if (call.usage) {
      usages.push(call.usage);
    }
    const validation = call.patch
      ? validatePatch(call.patch, prepared.ctx)
      : null;
    return { call, validation };
  };
  let { call, validation } = await attempt(prepared.input);
  if (call.problem?.startsWith("refusal")) {
    throw new TailoringFailure("model_refused");
  }
  if (!(call.patch && validation) || validation.hard.length > 0) {
    ({ call, validation } = await attempt(
      buildRepairInput(prepared.input, hardProblems(call, validation))
    ));
  }
  if (!(call.patch && validation) || validation.hard.length > 0) {
    throw new TailoringFailure(
      "validation_failed",
      hardProblems(call, validation)
    );
  }
  return { model: call.model, patch: call.patch, validation };
}

async function tailorWithAi(
  qc: TailorQc,
  variant: CvVariantRecord,
  base: CVData,
  usages: AiUsage[],
  timezone: string
): Promise<Tailored> {
  const prepared = await prepareTailoring(qc, variant, base, timezone);
  const accepted = await patchWithRepair(qc, base, prepared, usages);
  try {
    const applied = applyPatch(
      base,
      accepted.patch,
      accepted.validation,
      prepared.ctx.bullets,
      {
        model: accepted.model,
        promptVersion: TAILOR_PROMPT_VERSION,
        template: variant.template,
      }
    );
    return { applied, model: accepted.model, usages };
  } catch (err) {
    throw new TailoringFailure("apply_failed", [
      err instanceof Error ? err.message : String(err),
    ]);
  }
}

async function sendRenderCheck(
  qc: TailorQc,
  check: number,
  delayMs: number
): Promise<void> {
  try {
    await qc.env.JOBS_AI_QUEUE.send(
      tailorCvMessage(qc.scope.userId, qc.message.cv_variant_id, check),
      { delaySeconds: Math.max(1, Math.ceil(delayMs / 1000)) }
    );
  } catch (err) {
    // The cron sweep (file-retention) creates the render task instead.
    qc.log("tailor_render_check_send_failed", {
      cvv_id: qc.message.cv_variant_id,
      error: err instanceof Error ? err.name : String(err),
    });
  }
}

/** The render need of 08 §4.1 step 8 (a delayed `tailor_cv` delivery). */
async function renderCheck(
  qc: TailorQc,
  variant: CvVariantRecord
): Promise<QueueOutcome> {
  if (variant.file_id) {
    return ACK;
  }
  const elapsed = qc.now - variant.updated_at;
  if (elapsed < RENDER_FALLBACK_DELAY_MS) {
    const check = Number(CHECK_ID_RE.exec(qc.message.message_id)?.[1] ?? "0");
    if (check < MAX_RENDER_CHECKS) {
      await sendRenderCheck(qc, check + 1, RENDER_FALLBACK_DELAY_MS - elapsed);
    }
    return ACK;
  }
  const created = await ensureRenderFallbackTask(qc.db, qc.scope, {
    cvvId: variant.id,
    applicationId: variant.application_id,
    now: qc.now,
  });
  qc.log("tailor_render_fallback", { cvv_id: variant.id, created });
  return ACK;
}

async function fail(
  qc: TailorQc,
  variant: CvVariantRecord,
  base: CVData | null,
  failure: TailoringFailure,
  usages: readonly AiUsage[],
  timezone: string
): Promise<QueueOutcome> {
  const model = variant.model ?? tailorModel(qc.env);
  await failCvVariant(qc.db, qc.scope, {
    cvvId: variant.id,
    diff: failureDiff(base, model, failure.reason, failure.violations),
    model,
    extra: usageStatements(qc, usages, timezone),
    now: qc.now,
  });
  qc.log("tailor_failed", { cvv_id: variant.id, reason: failure.reason });
  return ACK;
}

async function produce(
  qc: TailorQc,
  variant: CvVariantRecord,
  base: CVData,
  usages: AiUsage[],
  timezone: string
): Promise<Tailored> {
  if (variant.model === COPY_MODEL) {
    return {
      applied: copyVariant(base, variant.template),
      model: COPY_MODEL,
      usages,
    };
  }
  return await tailorWithAi(qc, variant, base, usages, timezone);
}

/** Tailors one `generating` variant (or runs its render check). */
export async function runTailorCv(qc: TailorQc): Promise<QueueOutcome> {
  const { db, scope, env, now } = qc;
  const variant = await loadVariant(db, scope, qc.message.cv_variant_id);
  if (!variant || variant.status !== "generating") {
    return ACK;
  }
  if (variant.tailored_cv_id) {
    return await renderCheck(qc, variant);
  }
  const usages: AiUsage[] = [];
  const settings = await getUserSettings(db, scope, now);
  const user = await findUserById(env.DB, scope.userId);
  if (!user || user.deleted_at !== null) {
    return await fail(
      qc,
      variant,
      null,
      new TailoringFailure("user_missing"),
      usages,
      settings.timezone
    );
  }
  const raw = await loadOwnedCv(env, user.email, variant.base_cv_id);
  const parsed = raw === null ? null : CVDataSchema.safeParse(raw);
  if (!parsed?.success) {
    const reason = raw === null ? "base_cv_not_found" : "base_cv_invalid";
    return await fail(
      qc,
      variant,
      null,
      new TailoringFailure(reason),
      usages,
      settings.timezone
    );
  }
  const base = parsed.data as CVData;
  let tailored: Tailored;
  try {
    tailored = await produce(qc, variant, base, usages, settings.timezone);
  } catch (err) {
    if (err instanceof TailoringFailure) {
      return await fail(qc, variant, base, err, usages, settings.timezone);
    }
    throw err;
  }
  const slug = await tailoredCvSlug(env, variant.base_cv_id, variant.id);
  if (
    !(await saveTailoredDocument(env, user.email, slug, tailored.applied.cv))
  ) {
    return await fail(
      qc,
      variant,
      base,
      new TailoringFailure("slug_taken"),
      usages,
      settings.timezone
    );
  }
  const diff: CvVariantDiff = {
    ...tailored.applied.diff,
    tailored_cv_sha256: await cvCanonicalSha256(tailored.applied.cv),
  };
  try {
    await commitCvStatements(db, [
      ...completeTailoringStatements(db, scope, {
        id: variant.id,
        tailoredCvId: slug,
        diff,
        model: tailored.model,
        now,
      }),
      ...usageStatements(qc, tailored.usages, settings.timezone),
    ]);
  } catch (err) {
    if (!(err instanceof GuardFailedError)) {
      throw err;
    }
    // Rejected / superseded / completed meanwhile: drop a document nobody owns.
    const current = await loadVariant(db, scope, variant.id);
    if (current?.tailored_cv_id !== slug) {
      await deleteCvDocument(env, slug);
    }
    return ACK;
  }
  qc.log("tailor_done", {
    cvv_id: variant.id,
    model: tailored.model,
    fallbacks: diff.validator.fallbacks_to_keep,
  });
  await sendRenderCheck(qc, 1, RENDER_FALLBACK_DELAY_MS);
  return ACK;
}
