// The `evaluate_rules` consumer logic (07 §10, 19 §8.3, §10, 21 §4 "rule
// path", 14 §6 idempotency).
//
// For each tracked posting of the message and each enabled, effective rule
// (creation order; the first rule that acts wins):
//   1. only a `ready` score of the CURRENT profile version and rubric
//      counts; a missing or still-queued score enqueues scoring and defers
//      (never matches on a stale score); blocking gates always exclude,
//      possible gates and deterministic-only scores per the criteria;
//   2. the criteria (keywords, titles, companies, sources, places, …), the
//      coverage (open posting, browser_supported, allowed domain, auto-capable
//      adapter for auto) and the rule's task-creation limits (per day, per
//      company per 30 days);
//   3. no other application for the same job (repost dedupe group) is
//      applied or submitted (19 §10);
//   4. the application: tracked as `ready` when the rule uses the base CV as
//      is, else `saved` with a tailored CV variant requested
//      (`cv_policy.tailor`); an existing card must be `ready`, or
//      `saved`/`preparing` with the tailoring policy;
//   5. the apply task, idempotency key `rule:<rule id>:<posting id>` (+ the
//      `ux_tasks_live_apply` index), created by "rule" under the full task
//      policy (auto: approved activation, coverage, D-35 limits).
// Email is never a rule action (09 §1): only browser-supported postings.

import type { MatchScoreRecord } from "@pilihpendidikan/jobs-contracts/records";
import type {
  ApplicationRecord,
  AutomationRuleRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import type { Env } from "../../../env";
import type { FeatureFlags } from "../../core/flags";
import { isApiError } from "../../core/http";
import type { UserScope } from "../../core/scope";
import {
  appliedInDedupeGroup,
  applicationsOfUserJobs,
  scoresFor,
  trackedPostings,
} from "../../repo/automation/context";
import type { TrackedPosting } from "../../repo/automation/context";
import { ruleTasksCreated } from "../../repo/automation/limits";
import { executeBatch } from "../../repo/automation/records";
import { listEnabledRules, loadActivation } from "../../repo/automation/rules";
import { findLiveApplyTask } from "../../repo/automation/tasks";
import type { JobsDb } from "../../repo/core/db";
import { UniqueViolationError } from "../../repo/core/db";
import { computeProfileVersion } from "../../repo/core/profile-version";
import { enqueueScoring } from "../../repo/core/score-queue";
import { getUserSettings } from "../../repo/core/settings";
import { planTrackApplication } from "../applications/index";
import type { CvRequest } from "./cv-variant";
import { planRuleCvVariant } from "./cv-variant";
import {
  companyKey,
  coverageProblem,
  criteriaMatch,
  DAY_MS,
  ruleIneffective,
  scoreVerdict,
} from "./policy";
import { planCreateTask } from "./tasks";

const IN_CHUNK = 90;

export interface RuleEvaluation {
  /** Postings whose score must be computed first (deferred). */
  deferred: string[];
  /** Task ids created. */
  created: string[];
  /** posting id → why no task was created. */
  skipped: Record<string, string>;
}

export interface EvaluateInput {
  env: Env;
  flags: FeatureFlags;
  now: number;
  postingIds: readonly string[];
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const READY_STAGES = new Set(["saved", "preparing", "ready"]);

/** Whether the rule may act on this application's stage (19 §10). */
function stageAllows(
  app: ApplicationRecord,
  rule: AutomationRuleRecord
): boolean {
  if (app.stage === "ready") {
    return true;
  }
  return READY_STAGES.has(app.stage) && rule.cv_policy.tailor === true;
}

async function effectiveRules(
  db: JobsDb,
  scope: UserScope,
  input: { flags: FeatureFlags; now: number; timezone: string }
): Promise<AutomationRuleRecord[]> {
  const out: AutomationRuleRecord[] = [];
  for (const rule of await listEnabledRules(db, scope)) {
    const activation = rule.activated_approval_id
      ? await loadActivation(db, scope, rule.activated_approval_id)
      : null;
    const problem = ruleIneffective(rule, {
      activation,
      autoModeEnabled: input.flags.JOBS_AUTO_MODE_ENABLED,
      checkActiveHours: false,
      now: input.now,
      timezone: input.timezone,
    });
    if (problem === null) {
      out.push(rule);
    }
  }
  return out;
}

async function underRuleLimits(
  db: JobsDb,
  scope: UserScope,
  rule: AutomationRuleRecord,
  key: string | null,
  now: number
): Promise<boolean> {
  const today = await ruleTasksCreated(db, scope, {
    ruleId: rule.id,
    since: now - DAY_MS,
  });
  if (today >= rule.limits.max_per_day) {
    return false;
  }
  if (!key) {
    return true;
  }
  const company = await ruleTasksCreated(db, scope, {
    ruleId: rule.id,
    since: now - 30 * DAY_MS,
    companyKey: key,
  });
  return company < rule.limits.max_per_company_per_30d;
}

/** The first rule that matches a posting, or why none did. */
async function matchRule(
  db: JobsDb,
  scope: UserScope,
  rules: readonly AutomationRuleRecord[],
  item: TrackedPosting,
  score: MatchScoreRecord | undefined,
  now: number
): Promise<
  { rule: AutomationRuleRecord } | { deferred: true } | { reason: string }
> {
  let reason = "no_rule_matches";
  for (const rule of rules) {
    if (!criteriaMatch(rule.criteria, item.posting, item.source_id)) {
      continue;
    }
    const coverage = coverageProblem(rule, item.posting);
    if (coverage !== null) {
      reason = coverage;
      continue;
    }
    const verdict = scoreVerdict(score, rule.criteria, now);
    if (!verdict.ok) {
      if (verdict.reason === "missing" || verdict.reason === "pending") {
        return { deferred: true };
      }
      reason = `score_${verdict.reason}`;
      continue;
    }
    if (
      !(await underRuleLimits(db, scope, rule, companyKey(item.posting), now))
    ) {
      reason = "limit_reached";
      continue;
    }
    return { rule };
  }
  return { reason };
}

async function ensureApplication(
  db: JobsDb,
  scope: UserScope,
  input: {
    existing: ApplicationRecord | undefined;
    item: TrackedPosting;
    now: number;
    rule: AutomationRuleRecord;
  }
): Promise<ApplicationRecord | string> {
  const { existing, item, rule, now } = input;
  if (existing) {
    if (existing.archived || !stageAllows(existing, rule)) {
      return `stage_${existing.stage}`;
    }
    return existing;
  }
  const plan = await planTrackApplication(db, scope, {
    actorKind: "system",
    source: "system",
    now,
    userJobId: item.user_job_id,
    stage: rule.cv_policy.tailor === true ? "saved" : "ready",
    mode: rule.mode,
    idempotencyKey: `rule:${rule.id}:${item.posting.id}`,
  });
  if (plan.statements.length > 0) {
    try {
      await executeBatch(db, plan.statements);
    } catch (err) {
      if (!(err instanceof UniqueViolationError)) {
        throw err;
      }
    }
  }
  const tracked = await applicationsOfUserJobs(db, scope, [item.user_job_id]);
  return tracked.get(item.user_job_id) ?? "track_failed";
}

async function actOnPosting(
  db: JobsDb,
  scope: UserScope,
  input: EvaluateInput & {
    app: ApplicationRecord | undefined;
    item: TrackedPosting;
    rule: AutomationRuleRecord;
  }
): Promise<{ created?: string; skipped?: string }> {
  const { item, rule, now } = input;
  if (
    item.posting.dedupe_group &&
    (await appliedInDedupeGroup(db, scope, {
      applicationId: input.app?.id ?? null,
      dedupeGroup: item.posting.dedupe_group,
    }))
  ) {
    return { skipped: "already_applied_elsewhere" };
  }
  const app = await ensureApplication(db, scope, {
    existing: input.app,
    item,
    now,
    rule,
  });
  if (typeof app === "string") {
    return { skipped: app };
  }
  if (await findLiveApplyTask(db, scope, app.id)) {
    return { skipped: "live_task" };
  }
  let cv: CvRequest | null = null;
  if (rule.cv_policy.tailor === true && !app.cv_variant_id) {
    cv = await planRuleCvVariant(db, scope, input.env, { app, rule, now });
    if (!cv.ok) {
      return { skipped: cv.reason };
    }
  }
  try {
    const plan = await planCreateTask(
      db,
      scope,
      input.env,
      {
        kind: "apply",
        applicationId: app.id,
        payload: { mode: rule.mode, rule_id: rule.id },
        idempotencyKey: `rule:${rule.id}:${item.posting.id}`,
        createdBy: "rule",
        requireDevice: false,
        grantedVia: "system",
        source: "system",
        now,
      },
      input.flags
    );
    if (plan.existing) {
      return { skipped: "already_created" };
    }
    await executeBatch(db, [
      ...(cv?.ok ? cv.statements : []),
      ...plan.statements,
    ]);
    if (cv?.ok) {
      await cv.afterCommit();
    }
    return { created: plan.task.id };
  } catch (err) {
    if (err instanceof UniqueViolationError) {
      return { skipped: "duplicate" };
    }
    if (isApiError(err) && err.status < 500) {
      return { skipped: err.code };
    }
    throw err;
  }
}

/** Evaluates the user's rules against some postings (one queue message). */
export async function evaluateRules(
  db: JobsDb,
  scope: UserScope,
  input: EvaluateInput
): Promise<RuleEvaluation> {
  const result: RuleEvaluation = { created: [], deferred: [], skipped: {} };
  const { flags, now } = input;
  if (!flags.JOBS_AUTOMATION_ENABLED) {
    return result;
  }
  const settings = await getUserSettings(db, scope, now);
  if (settings.automation_paused) {
    return result;
  }
  const rules = await effectiveRules(db, scope, {
    flags,
    now,
    timezone: settings.timezone,
  });
  if (rules.length === 0) {
    return result;
  }
  const ids = [...new Set(input.postingIds)];
  const tracked: TrackedPosting[] = [];
  for (const part of chunks(ids, IN_CHUNK)) {
    tracked.push(...(await trackedPostings(db, scope, part)));
  }
  if (tracked.length === 0) {
    return result;
  }
  const profileVersion = await computeProfileVersion(input.env, db, scope);
  const scores = new Map<string, MatchScoreRecord>();
  const apps = new Map<string, ApplicationRecord>();
  for (const part of chunks(tracked, IN_CHUNK)) {
    const found = await scoresFor(db, scope, {
      postingIds: part.map((t) => t.posting.id),
      profileVersion,
      rubricVersion: RUBRIC_VERSION,
    });
    for (const [id, score] of found) {
      scores.set(id, score);
    }
    const byJob = await applicationsOfUserJobs(
      db,
      scope,
      part.map((t) => t.user_job_id)
    );
    for (const [id, app] of byJob) {
      apps.set(id, app);
    }
  }
  for (const item of tracked) {
    const match = await matchRule(
      db,
      scope,
      rules,
      item,
      scores.get(item.posting.id),
      now
    );
    if ("deferred" in match) {
      result.deferred.push(item.posting.id);
      continue;
    }
    if ("reason" in match) {
      result.skipped[item.posting.id] = match.reason;
      continue;
    }
    const outcome = await actOnPosting(db, scope, {
      ...input,
      app: apps.get(item.user_job_id),
      item,
      rule: match.rule,
    });
    if (outcome.created) {
      result.created.push(outcome.created);
    } else {
      result.skipped[item.posting.id] = outcome.skipped ?? "skipped";
    }
  }
  if (result.deferred.length > 0) {
    await enqueueScoring(input.env, db, scope, {
      postingIds: result.deferred,
      profileVersion,
      now,
    });
  }
  return result;
}
