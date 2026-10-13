// The envelope of every AI proxy call (05 §9, 19 §2, D-12): the lease
// check, the AI gates, the budget pre-check and the usage write.
//
//   1. `lease_ref` must be the CURRENT, unexpired lease of an apply task of
//      the calling device (21 §11): unknown / not-owned task → 404, any other
//      mismatch → 409 lease_lost;
//   2. AI_DISABLED (D-33) → 503 upstream_unavailable (`details.reason =
//      "ai_disabled"`); no AI consent (11 §11) → 422 policy_violation
//      (`ai_consent_required`);
//   3. the estimated cost must fit the user's month and day budget (D-34)
//      → else 429 ai_budget_exhausted;
//   4. usage goes to `ai_usage` (purpose `agent`, one call per provider
//      request) and `automation_attempts.ai_calls` (+1 per proxy call) in the
//      same batch as the response's idempotency row; a call that fails after
//      spending still records what it spent.
// Prompts and page text are never logged (11 §8.6): the log line carries the
// endpoint, model, counts, tokens, cost and latency only.

import type {
  LeaseRef,
  PageObservation,
} from "@pilihpendidikan/jobs-contracts/agent";
import { OBSERVATION_LIMITS } from "@pilihpendidikan/jobs-contracts/agent";
import type { UserSettingsRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { AiProvider } from "../../ai/provider";
import type { AiUsage } from "../../ai/primitives";
import { sumUsage } from "../../ai/primitives";
import type { RouteContext } from "../../core/context";
import { ApiError, apiError, notFound } from "../../core/http";
import type { TaskLease } from "../../repo/ai-proxy";
import {
  attemptAiCallsStatement,
  findTaskLease,
  LEASED_STATES,
  recordUsageNow,
} from "../../repo/ai-proxy";
import {
  assertAiBudget,
  getAiBudgetStatus,
  recordAiUsageStatements,
} from "../../repo/core/ai-usage";
import { getUserSettings } from "../../repo/core/settings";

/** 05 §9: one screenshot of at most 1.5 MB. */
export const SCREENSHOT_MAX_BYTES = 1_500_000;
/** Bodies carrying a screenshot (base64 ≤ 2 MB) plus the observation. */
export const AI_PROXY_MAX_BODY_BYTES = 2_621_440;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const JPEG_B64_PREFIX = "/9j/";
const PADDING_RE = /=+$/;

/**
 * Checks the screenshot of a request (05 §9): base64 JPEG, ≤ 1.5 MB decoded.
 * 400 invalid_request for anything else, 413 when too large.
 */
export function assertScreenshot(base64: string | null): void {
  if (base64 === null) {
    return;
  }
  if (base64.length > OBSERVATION_LIMITS.screenshotB64) {
    throw apiError("payload_too_large", "The screenshot is over 1.5 MB.", {
      details: { limit_bytes: SCREENSHOT_MAX_BYTES },
    });
  }
  if (!(BASE64_RE.test(base64) && base64.startsWith(JPEG_B64_PREFIX))) {
    throw apiError(
      "invalid_request",
      "screenshot_jpeg_b64 must be one base64-encoded JPEG."
    );
  }
  const padding = base64.length - base64.replace(PADDING_RE, "").length;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;
  if (bytes > SCREENSHOT_MAX_BYTES) {
    throw apiError("payload_too_large", "The screenshot is over 1.5 MB.", {
      details: { limit_bytes: SCREENSHOT_MAX_BYTES },
    });
  }
}

/** The observation without its screenshot (never sent to Responses). */
export function withoutScreenshot(
  observation: PageObservation
): PageObservation {
  return { ...observation, screenshot_jpeg_b64: null };
}

/** Usage of one proxy call (possibly several provider requests). */
export class UsageMeter {
  readonly #parts: AiUsage[] = [];
  #calls = 0;

  add(usage: AiUsage, calls: number): void {
    if (calls > 0) {
      this.#parts.push(usage);
      this.#calls += calls;
    }
  }

  get calls(): number {
    return this.#calls;
  }

  get usage(): AiUsage {
    return sumUsage(this.#parts);
  }

  get models(): string[] {
    return [...new Set(this.#parts.map((part) => part.model))];
  }
}

export interface AgentCall {
  ai: AiProvider;
  /** 429 ai_budget_exhausted unless `estimateMicroUsd` fits (D-34). */
  budget(estimateMicroUsd: number): Promise<void>;
  lease: TaskLease & { lease_id: string };
  meter: UsageMeter;
  settings: UserSettingsRecord;
}

type Ctx = RouteContext<Readonly<Record<string, string>>, unknown, unknown>;

/** 404 / 409 lease_lost unless `ref` is the calling device's live lease. */
export async function requireLiveLease(
  c: Ctx,
  ref: LeaseRef
): Promise<TaskLease & { lease_id: string }> {
  const lease = await findTaskLease(c.db, c.scope, ref.task_id);
  if (!lease) {
    throw notFound("Task not found.");
  }
  const deviceId = c.caller.deviceId;
  const live =
    deviceId !== null &&
    lease.lease_id === ref.lease_id &&
    lease.lease_device_id === deviceId &&
    lease.lease_expires_at !== null &&
    lease.lease_expires_at > c.now &&
    (LEASED_STATES as readonly string[]).includes(lease.state);
  if (!(live && lease.lease_id)) {
    throw apiError(
      "lease_lost",
      "This lease is no longer held by this device. Stop the attempt.",
      { details: { task_id: ref.task_id, lease_id: ref.lease_id } }
    );
  }
  if (lease.kind !== "apply") {
    throw apiError(
      "policy_violation",
      "AI agent calls are only available to apply tasks.",
      { details: { reason: "not_an_apply_task" } }
    );
  }
  return { ...lease, lease_id: lease.lease_id };
}

/** AI_DISABLED → 503, no consent → 422 (11 §11, D-33); the user's settings. */
export async function openAiGate(c: Ctx): Promise<UserSettingsRecord> {
  if (c.flags.AI_DISABLED) {
    throw new ApiError(
      "upstream_unavailable",
      "AI features are switched off for now. Pause and try again later.",
      { details: { reason: "ai_disabled" }, headers: { "Retry-After": "600" } }
    );
  }
  const settings = await getUserSettings(c.db, c.scope, c.now);
  if (settings.ai_consent_at === null) {
    throw apiError(
      "policy_violation",
      "AI features are off for this account. Turn them on in Settings.",
      { details: { reason: "ai_consent_required" } }
    );
  }
  return settings;
}

function usageStatements(
  c: Ctx,
  call: Pick<AgentCall, "lease" | "meter" | "settings">
): D1PreparedStatement[] {
  if (call.meter.calls === 0) {
    return [];
  }
  const usage = call.meter.usage;
  return [
    ...recordAiUsageStatements(c.db, c.scope, {
      purpose: "agent",
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costMicroUsd: usage.cost_micro_usd,
      calls: call.meter.calls,
      now: c.now,
      timezone: call.settings.timezone,
    }),
    attemptAiCallsStatement(
      c.db,
      c.scope,
      { leaseId: call.lease.lease_id, taskId: call.lease.task_id },
      1
    ),
  ];
}

function logCall(
  c: Ctx,
  endpoint: string,
  meter: UsageMeter,
  started: number,
  outcome: string
): void {
  const usage = meter.usage;
  console.log(
    JSON.stringify({
      evt: "ai_call",
      endpoint,
      request_id: c.requestId,
      outcome,
      models: meter.models,
      calls: meter.calls,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_micro_usd: usage.cost_micro_usd,
      latency_ms: Date.now() - started,
    })
  );
}

/**
 * Runs one agent AI call inside the envelope above and answers with `body`
 * (the usage and the idempotency row are one batch, 05 §1.4).
 */
export async function runAgentCall(
  c: Ctx,
  endpoint: string,
  leaseRef: LeaseRef,
  work: (call: AgentCall) => Promise<unknown>
): Promise<Response> {
  const lease = await requireLiveLease(c, leaseRef);
  const settings = await openAiGate(c);
  const meter = new UsageMeter();
  const call: AgentCall = {
    ai: c.ai(),
    lease,
    meter,
    settings,
    async budget(estimateMicroUsd) {
      assertAiBudget(
        await getAiBudgetStatus(c.db, c.scope, {
          env: c.env,
          now: c.now,
          timezone: settings.timezone,
          estimateMicroUsd,
        })
      );
    },
  };
  const started = Date.now();
  let body: unknown;
  try {
    body = await work(call);
  } catch (err) {
    logCall(c, endpoint, meter, started, "error");
    if (meter.calls > 0) {
      try {
        await recordUsageNow(c.db, usageStatements(c, call));
      } catch {
        // The failure that got us here is the one to report.
      }
    }
    throw err;
  }
  logCall(c, endpoint, meter, started, "ok");
  return await c.commit(usageStatements(c, call), { body });
}
