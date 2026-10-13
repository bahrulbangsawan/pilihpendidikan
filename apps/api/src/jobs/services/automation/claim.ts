// POST /api/v1/devices/{dev_id}/tasks:claim (21 §3, §5.1, D-11).
//
//   1. authorize: the path device is the caller's device (404 otherwise),
//      it accepts tasks (403 device_not_accepting_tasks) and runs a CLI at
//      or above the minimum version (426); JOBS_AUTOMATION_ENABLED off →
//      no work (tasks stay queued);
//   2. lazy reaping for this user (21 §7.1);
//   3. candidates in claim order with every eligibility predicate (kind
//      slots of this device, capabilities, target device, not_before /
//      expires_at, no pending cancel; no apply while automation_paused; no
//      auto apply while JOBS_AUTO_MODE_ENABLED is off or its rule cannot act
//      now — limits, active hours, activation);
//   4. for the first candidate: build its context, then ONE batch — the
//      conditional UPDATE … RETURNING, the guard that it took effect, the
//      attempt row, the `_claimed` event, change_log and the idempotency
//      row holding this exact response. A lost race moves to the next
//      candidate; nothing of the losing batch is written.

import type { TaskKind } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { AutomationTaskRecord } from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import type { CallerDevice } from "../../core/device";
import type { FeatureFlags } from "../../core/flags";
import { ApiError, apiError, isApiError, notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { cliVersions } from "../../core/version";
import type { ClaimFilter } from "../../repo/automation/claim";
import {
  CLAIM_LOST_LABEL,
  claimStatements,
  heldLeaseKinds,
  listClaimCandidates,
} from "../../repo/automation/claim";
import { postingOfUserJob, variantFile } from "../../repo/automation/context";
import { intentCounts } from "../../repo/automation/limits";
import { executeBatch } from "../../repo/automation/records";
import { loadActivation, loadRule } from "../../repo/automation/rules";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { GuardFailedError, UniqueViolationError } from "../../repo/core/db";
import {
  HEARTBEAT_INTERVAL_MS,
  LEASE_DURATION_MS,
} from "../../repo/core/leases";
import { getUserSettings } from "../../repo/core/settings";
import { buildTaskContext } from "./context";
import {
  companyKey,
  coverageProblem,
  GLOBAL_SUBMISSIONS_PER_DAY,
  ruleIneffective,
} from "./policy";
import { reapUser } from "./reaper";
import { pollIntervalMs, POLL_IDLE_MS, versionAtLeast } from "./shared";

const ALL_KINDS: readonly TaskKind[] = ["apply", "discover", "render_cv"];
const CANDIDATES_PER_ROUND = 5;
const MAX_ROUNDS = 25;
/**
 * Candidates one claim may pass over (lost races, auto tasks outside their
 * window, rule tasks waiting for a CV) before answering 204: bounds the work
 * of a poll when many queued tasks are not claimable yet.
 */
const MAX_SKIPPED = 25;

export interface ClaimInput {
  capabilities: readonly string[];
  /** `X-Pilih-Client` CLI version (falls back to the device row). */
  clientVersion: string | null;
  device: CallerDevice;
  env: Env;
  flags: Pick<
    FeatureFlags,
    "JOBS_AUTOMATION_ENABLED" | "JOBS_AUTO_MODE_ENABLED"
  >;
  /** The statements storing this request's idempotency row for a body. */
  idempotency: (status: number, body: unknown) => D1PreparedStatement[];
  now: number;
  pathDeviceId: string;
}

export type ClaimOutcome =
  | { body: ClaimBody; kind: "claimed" }
  | { kind: "empty"; pollIntervalMs: number };

export interface ClaimBody {
  context: unknown;
  lease: {
    /** The attempt row opened with the lease (late evidence, 21 §9). */
    attempt_id: string;
    expires_at: number;
    heartbeat_interval_ms: number;
    lease_id: string;
  };
  poll_interval_ms: number;
  task: AutomationTaskRecord;
}

function authorize(input: ClaimInput): void {
  if (input.pathDeviceId !== input.device.id) {
    throw notFound("Device not found.");
  }
  if (!input.device.accepts_tasks) {
    throw apiError(
      "device_not_accepting_tasks",
      "This device does not accept tasks (pilih-jobs worker enable)."
    );
  }
  const min = cliVersions(input.env).min;
  const version = input.clientVersion ?? input.device.cli_version;
  if (!versionAtLeast(version, min)) {
    throw new ApiError(
      "cli_upgrade_required",
      `pilih-jobs ${min} or newer is required. Run \`pilih-jobs update\`.`,
      { details: { client_version: version, min_cli_version: min } }
    );
  }
}

/** Why an auto apply candidate cannot be claimed now (19 §10), or null. */
async function autoCandidateProblem(
  db: JobsDb,
  scope: UserScope,
  task: AutomationTaskRecord,
  input: { autoModeEnabled: boolean; now: number; timezone: string }
): Promise<string | null> {
  const ruleId = task.payload.rule_id;
  const rule = ruleId ? await loadRule(db, scope, ruleId) : null;
  if (!rule) {
    return "rule_missing";
  }
  const activation = rule.activated_approval_id
    ? await loadActivation(db, scope, rule.activated_approval_id)
    : null;
  const ineffective = ruleIneffective(rule, {
    activation,
    autoModeEnabled: input.autoModeEnabled,
    now: input.now,
    timezone: input.timezone,
  });
  if (ineffective) {
    return ineffective;
  }
  const app = task.application_id
    ? await loadApplication(db, scope, task.application_id)
    : null;
  const posting = app
    ? await postingOfUserJob(db, scope, app.user_job_id)
    : null;
  if (!posting) {
    return "posting_missing";
  }
  const coverage = coverageProblem(rule, posting);
  if (coverage) {
    return coverage;
  }
  const counts = await intentCounts(db, scope, {
    companyKey: companyKey(posting),
    now: input.now,
    ruleId: rule.id,
  });
  if (
    (counts.rule24h ?? 0) >= rule.limits.max_per_day ||
    (counts.company30d ?? 0) >= rule.limits.max_per_company_per_30d ||
    counts.global24h >= GLOBAL_SUBMISSIONS_PER_DAY
  ) {
    return "limits";
  }
  return null;
}

const WAITING_STAGES = new Set(["saved", "preparing", "ready"]);

/**
 * A rule-created apply task waits in the queue until its card is ready to
 * apply (19 §10): the card is still saved/preparing/ready and, for a rule
 * that tailors the CV, the tailored variant is approved.
 */
async function ruleTaskNotReady(
  db: JobsDb,
  scope: UserScope,
  task: AutomationTaskRecord
): Promise<string | null> {
  if (
    task.created_by !== "rule" ||
    task.kind !== "apply" ||
    !task.application_id
  ) {
    return null;
  }
  const rule = task.payload.rule_id
    ? await loadRule(db, scope, task.payload.rule_id)
    : null;
  if (!rule) {
    return "rule_missing";
  }
  const app = await loadApplication(db, scope, task.application_id);
  if (!app) {
    return "application_missing";
  }
  if (app.archived || !WAITING_STAGES.has(app.stage)) {
    return `stage_${app.stage}`;
  }
  if (rule.cv_policy.tailor === true) {
    const variant = app.cv_variant_id
      ? await variantFile(db, scope, app.cv_variant_id)
      : null;
    if (variant?.status !== "approved") {
      return "cv_not_ready";
    }
  }
  return null;
}

function claimedTask(
  candidate: AutomationTaskRecord,
  lease: { expiresAt: number; leaseId: string },
  deviceId: string,
  now: number
): AutomationTaskRecord {
  return {
    ...candidate,
    state: "claimed",
    lease_id: lease.leaseId,
    lease_device_id: deviceId,
    lease_expires_at: lease.expiresAt,
    attempt_count: candidate.attempt_count + 1,
    pause_reason: null,
    resume_requested: false,
    local_state: null,
    progress: {},
    error_class: null,
    error_message: null,
    revision: candidate.revision + 1,
    updated_at: now,
  };
}

function logClaim(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ evt: "task_claim", ...fields }));
}

/** Claims at most one task for the calling device. */
export async function claimTask(
  db: JobsDb,
  scope: UserScope,
  input: ClaimInput
): Promise<ClaimOutcome> {
  authorize(input);
  const { now } = input;
  if (!input.flags.JOBS_AUTOMATION_ENABLED) {
    logClaim({ result: "disabled", device_id: input.device.id });
    return { kind: "empty", pollIntervalMs: POLL_IDLE_MS };
  }
  await reapUser(db, scope, now);
  const settings = await getUserSettings(db, scope, now);
  const held = await heldLeaseKinds(db, scope, input.device.id, now);
  const kinds = ALL_KINDS.filter(
    (kind) =>
      !(held.includes(kind) || (kind === "apply" && settings.automation_paused))
  );
  const poll = await pollIntervalMs(input.env, db, scope, now);
  if (kinds.length === 0) {
    logClaim({ result: "empty", device_id: input.device.id, reason: "slots" });
    return { kind: "empty", pollIntervalMs: poll };
  }
  const filter: ClaimFilter = {
    capabilities: input.capabilities,
    deviceId: input.device.id,
    excludeAutoApply: !input.flags.JOBS_AUTO_MODE_ENABLED,
    kinds,
    now,
  };
  const skipped = new Set<string>();
  for (
    let round = 0;
    round < MAX_ROUNDS && skipped.size < MAX_SKIPPED;
    round++
  ) {
    const candidates = (
      await listClaimCandidates(
        db,
        scope,
        filter,
        CANDIDATES_PER_ROUND + skipped.size
      )
    ).filter((task) => !skipped.has(task.id));
    if (candidates.length === 0) {
      break;
    }
    for (const candidate of candidates) {
      const claimed = await tryClaim(db, scope, input, filter, candidate, {
        poll,
        skipped,
        timezone: settings.timezone,
      });
      if (claimed) {
        return claimed;
      }
    }
  }
  logClaim({ result: "empty", device_id: input.device.id });
  return { kind: "empty", pollIntervalMs: poll };
}

async function tryClaim(
  db: JobsDb,
  scope: UserScope,
  input: ClaimInput,
  filter: ClaimFilter,
  candidate: AutomationTaskRecord,
  state: { poll: number; skipped: Set<string>; timezone: string }
): Promise<ClaimOutcome | null> {
  const { now } = input;
  const waiting = await ruleTaskNotReady(db, scope, candidate);
  if (waiting) {
    state.skipped.add(candidate.id);
    logClaim({ result: "skip", task_id: candidate.id, reason: waiting });
    return null;
  }
  if (candidate.kind === "apply" && candidate.payload.mode === "auto") {
    const problem = await autoCandidateProblem(db, scope, candidate, {
      autoModeEnabled: input.flags.JOBS_AUTO_MODE_ENABLED,
      now,
      timezone: state.timezone,
    });
    if (problem) {
      state.skipped.add(candidate.id);
      logClaim({ result: "skip", task_id: candidate.id, reason: problem });
      return null;
    }
  }
  let context: unknown;
  try {
    context = await buildTaskContext(db, scope, input.env, candidate, {
      issueTicket: true,
      now,
    });
  } catch (err) {
    if (isApiError(err) && err.code === "not_found") {
      state.skipped.add(candidate.id);
      logClaim({ result: "skip", task_id: candidate.id, reason: "context" });
      return null;
    }
    throw err;
  }
  const lease = {
    leaseId: newId("lse", now),
    attemptId: newId("att", now),
    expiresAt: now + LEASE_DURATION_MS,
    cliVersion: input.clientVersion ?? input.device.cli_version,
  };
  const body: ClaimBody = {
    task: claimedTask(candidate, lease, input.device.id, now),
    lease: {
      lease_id: lease.leaseId,
      attempt_id: lease.attemptId,
      expires_at: lease.expiresAt,
      heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
    },
    context,
    poll_interval_ms: state.poll,
  };
  try {
    await executeBatch(db, [
      ...claimStatements(db, scope, filter, candidate, lease),
      ...input.idempotency(200, body),
    ]);
  } catch (err) {
    const lost =
      (err instanceof GuardFailedError && err.label === CLAIM_LOST_LABEL) ||
      (err instanceof UniqueViolationError &&
        err.table === "automation_attempts");
    if (lost) {
      state.skipped.add(candidate.id);
      return null;
    }
    throw err;
  }
  logClaim({
    result: "claimed",
    task_id: candidate.id,
    kind: candidate.kind,
    created_by: candidate.created_by,
    device_id: input.device.id,
    attempt_no: candidate.attempt_count + 1,
    latency_ms: now - Math.max(candidate.created_at, candidate.not_before),
  });
  return { kind: "claimed", body };
}
