// Pure automation policy (19 §8, 07 §10, 21 §8, D-35): rule validation and
// effectiveness, coverage of a posting, score criteria, active hours, the
// company key of the per-company cap, the retry decision and the canonical
// hashing of a rule activation. No I/O here: services feed it rows.

import type {
  AdapterId,
  TaskErrorClass,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  ADAPTER_IDS,
  TASK_ERROR_RETRY,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { AdapterManifest } from "@pilihpendidikan/jobs-contracts/adapters";
import { getAdapterManifest } from "@pilihpendidikan/jobs-contracts/adapters";
import {
  asciiHost,
  normalizeText,
  registrableDomain,
  sha256Hex,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import type {
  ApprovalRecord,
  AutomationRuleRecord,
  JobPostingRecord,
  MatchScoreRecord,
  RuleCriteria,
  RuleLimits,
} from "@pilihpendidikan/jobs-contracts/records";
import { RULE_LIMIT_DEFAULTS } from "@pilihpendidikan/jobs-contracts/records";
import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import { apiError } from "../../core/http";

export const DAY_MS = 86_400_000;
/** D-35 / 19 §8.3: an auto activation is valid for at most 30 days. */
export const AUTO_MAX_VALIDITY_MS =
  RULE_LIMIT_DEFAULTS.auto_max_validity_days * DAY_MS;
export const GLOBAL_SUBMISSIONS_PER_DAY =
  RULE_LIMIT_DEFAULTS.global_submissions_per_day;
export const AUTO_MIN_SCORE = RULE_LIMIT_DEFAULTS.auto_min_score;
/** 11 T-11: anomaly alert above this many submissions per user per hour. */
export const SUBMISSION_BURST_PER_HOUR = 20;

// ---------------------------------------------------------------------------
// Domains and companies
// ---------------------------------------------------------------------------

/** Lowercase registrable domains, deduplicated, in input order. */
export function normalizeDomains(domains: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of domains) {
    const host = asciiHost(raw) ?? raw.trim().toLowerCase();
    const domain = registrableDomain(host) ?? host;
    if (domain && !out.includes(domain)) {
      out.push(domain);
    }
  }
  return out;
}

/** True when `host` (a host or registrable domain) is in `domains`. */
export function domainAllowed(
  host: string | null | undefined,
  domains: readonly string[]
): boolean {
  if (!host) {
    return false;
  }
  const domain = registrableDomain(host) ?? host.toLowerCase();
  return normalizeDomains(domains).includes(domain);
}

/** Per-company cap key: the company's registrable domain, else its name. */
export function companyKey(
  posting: Pick<JobPostingRecord, "company_domain" | "company_name">
): string | null {
  const domain = posting.company_domain
    ? registrableDomain(posting.company_domain)
    : null;
  if (domain) {
    return `d:${domain}`;
  }
  const name = normalizeText(posting.company_name);
  return name ? `n:${name}` : null;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** The adapter manifest of a posting's source kind, if it has one. */
export function adapterOf(
  posting: Pick<JobPostingRecord, "source_kind">
): AdapterManifest | null {
  return (ADAPTER_IDS as readonly string[]).includes(posting.source_kind)
    ? getAdapterManifest(posting.source_kind as AdapterId)
    : null;
}

/**
 * The domains an apply attempt may navigate (19 §7): the posting's apply
 * domain, the adapter's ATS hosts and (for rule tasks) the rule's domains.
 */
export function allowedDomainsFor(
  posting: Pick<JobPostingRecord, "apply_domain" | "source_kind">,
  ruleDomains: readonly string[]
): string[] {
  const out: string[] = [];
  const add = (value: string | null | undefined) => {
    const host = value ? (asciiHost(value) ?? value.toLowerCase()) : null;
    if (host && !out.includes(host)) {
      out.push(host);
    }
  };
  add(posting.apply_domain);
  for (const host of adapterOf(posting)?.automation.ats_hosts ?? []) {
    add(host);
  }
  for (const domain of ruleDomains) {
    add(domain);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface RuleProblem {
  field: string;
  message: string;
}

/** 19 §8.3 / D-35 problems of a rule that is (or becomes) `auto`. */
export function autoRuleProblems(
  rule: Pick<
    AutomationRuleRecord,
    "allowed_domains" | "criteria" | "limits" | "mode"
  >,
  now: number
): RuleProblem[] {
  if (rule.mode !== "auto") {
    return [];
  }
  const problems: RuleProblem[] = [];
  const { criteria, limits } = rule;
  if (criteria.min_score < AUTO_MIN_SCORE) {
    problems.push({
      field: "criteria.min_score",
      message: `auto rules need min_score ≥ ${AUTO_MIN_SCORE}.`,
    });
  }
  const narrowed = [
    criteria.keywords,
    criteria.title_patterns,
    criteria.companies,
    criteria.source_ids,
  ].some((list) => (list?.length ?? 0) > 0);
  if (!narrowed) {
    problems.push({
      field: "criteria",
      message:
        "auto rules need at least one of keywords, title_patterns, companies or source_ids.",
    });
  }
  if (rule.allowed_domains.length === 0) {
    problems.push({
      field: "allowed_domains",
      message: "auto rules need a non-empty list of allowed domains.",
    });
  }
  const expiresAt = limits.expires_at ?? null;
  if (expiresAt === null) {
    problems.push({
      field: "limits.expires_at",
      message: "auto rules need an expiry (at most 30 days).",
    });
  } else if (expiresAt <= now) {
    problems.push({
      field: "limits.expires_at",
      message: "The expiry must be in the future.",
    });
  } else if (expiresAt > now + AUTO_MAX_VALIDITY_MS) {
    problems.push({
      field: "limits.expires_at",
      message: "auto rules expire within 30 days; renew with a new activation.",
    });
  }
  return problems;
}

/** The D-35 ceilings, re-checked server-side (the schema enforces them too). */
export function limitProblems(limits: RuleLimits): RuleProblem[] {
  const problems: RuleProblem[] = [];
  if (limits.max_per_day > RULE_LIMIT_DEFAULTS.max_per_day_ceiling) {
    problems.push({
      field: "limits.max_per_day",
      message: `max_per_day is capped at ${RULE_LIMIT_DEFAULTS.max_per_day_ceiling}.`,
    });
  }
  if (
    limits.max_per_company_per_30d >
    RULE_LIMIT_DEFAULTS.max_per_company_per_30d_ceiling
  ) {
    problems.push({
      field: "limits.max_per_company_per_30d",
      message: `max_per_company_per_30d is capped at ${RULE_LIMIT_DEFAULTS.max_per_company_per_30d_ceiling}.`,
    });
  }
  return problems;
}

/** Throws 422 policy_violation listing the problems. */
export function assertNoProblems(problems: readonly RuleProblem[]): void {
  if (problems.length > 0) {
    throw apiError(
      "policy_violation",
      problems.map((p) => p.message).join(" "),
      { details: { problems } }
    );
  }
}

/** Fills the D-35 defaults for an `auto` rule's expiry (now + 30 d). */
export function withAutoDefaults(limits: RuleLimits, now: number): RuleLimits {
  if (limits.expires_at === undefined || limits.expires_at === null) {
    return { ...limits, expires_at: now + AUTO_MAX_VALIDITY_MS };
  }
  return limits;
}

/** The fields a `rule_activation` approval binds (19 §8.3, 03 §8). */
export function activationContent(
  rule: Pick<
    AutomationRuleRecord,
    "allowed_domains" | "criteria" | "id" | "limits" | "mode" | "name"
  >
) {
  return {
    rule_id: rule.id,
    mode: rule.mode,
    criteria: rule.criteria,
    limits: rule.limits,
    allowed_domains: rule.allowed_domains,
  };
}

/** JSON with object keys sorted at every level (stable hashing). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** sha256(canonical JSON) — the payload hash of server-created approvals. */
export async function payloadHash(payload: unknown): Promise<string> {
  return await sha256Hex(canonicalJson(payload));
}

/** True when the approved activation still describes the rule as it is. */
export function activationMatches(
  rule: AutomationRuleRecord,
  approval: ApprovalRecord
): boolean {
  if (approval.payload.type !== "rule_activation") {
    return false;
  }
  const payload = approval.payload;
  return (
    canonicalJson({
      rule_id: payload.rule_id,
      mode: payload.mode,
      criteria: payload.criteria,
      limits: payload.limits,
      allowed_domains: payload.allowed_domains,
    }) === canonicalJson(activationContent(rule))
  );
}

/** Plain-language summary shown in the activation dialog (12 §6.2). */
export function activationSummary(rule: AutomationRuleRecord): string {
  const limits = rule.limits;
  const until = limits.expires_at
    ? new Date(limits.expires_at).toISOString().slice(0, 10)
    : "no expiry";
  const hours = limits.active_hours
    ? ` between ${limits.active_hours.start} and ${limits.active_hours.end}`
    : "";
  return `Submit up to ${limits.max_per_day} applications a day (at most ${limits.max_per_company_per_30d} per company in 30 days)${hours} for jobs scoring ${rule.criteria.min_score} or more on ${rule.allowed_domains.join(", ")}, until ${until}.`.slice(
    0,
    1000
  );
}

export type RuleIneffective =
  | "disabled"
  | "auto_mode_disabled"
  | "not_activated"
  | "activation_mismatch"
  | "expired"
  | "outside_active_hours";

/**
 * Why a rule cannot act now, or null. `auto` rules need the
 * `JOBS_AUTO_MODE_ENABLED` flag, an APPROVED activation of exactly this
 * content and an unexpired limit window (19 §8.3).
 */
export function ruleIneffective(
  rule: AutomationRuleRecord,
  input: {
    activation: ApprovalRecord | null;
    autoModeEnabled: boolean;
    checkActiveHours?: boolean;
    now: number;
    timezone: string;
  }
): RuleIneffective | null {
  if (!rule.enabled) {
    return "disabled";
  }
  if (rule.mode === "auto") {
    if (!input.autoModeEnabled) {
      return "auto_mode_disabled";
    }
    const activation = input.activation;
    if (
      !(
        activation &&
        rule.activated_approval_id === activation.id &&
        activation.state === "approved"
      )
    ) {
      return "not_activated";
    }
    if (!activationMatches(rule, activation)) {
      return "activation_mismatch";
    }
    const expiresAt = rule.limits.expires_at ?? null;
    if (expiresAt === null || expiresAt <= input.now) {
      return "expired";
    }
  } else if (
    rule.limits.expires_at !== undefined &&
    rule.limits.expires_at !== null &&
    rule.limits.expires_at <= input.now
  ) {
    return "expired";
  }
  if (
    input.checkActiveHours !== false &&
    !withinActiveHours(
      rule.limits.active_hours ?? null,
      input.now,
      input.timezone
    )
  ) {
    return "outside_active_hours";
  }
  return null;
}

const HH_MM_RE = /^(\d{2}):(\d{2})$/;

function minutesOf(hhmm: string): number {
  const match = HH_MM_RE.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

/** Minutes after local midnight in an IANA zone (UTC when unknown). */
export function localMinutes(now: number, timezone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(now));
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(now));
  }
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hour % 24) * 60 + minute;
}

/** `active_hours` in the user's timezone; a window may wrap midnight. */
export function withinActiveHours(
  window: { end: string; start: string } | null,
  now: number,
  timezone: string
): boolean {
  if (!window) {
    return true;
  }
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  const current = localMinutes(now, timezone);
  if (start === end) {
    return true;
  }
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

// ---------------------------------------------------------------------------
// Coverage and criteria (19 §8.3, 21 §4, 07 §10)
// ---------------------------------------------------------------------------

export type CoverageProblem =
  | "domain_not_allowed"
  | "application_unsupported"
  | "adapter_not_auto"
  | "posting_closed";

/** Whether a rule may act on a posting (domain, support, adapter, open). */
export function coverageProblem(
  rule: Pick<AutomationRuleRecord, "allowed_domains" | "mode">,
  posting: JobPostingRecord
): CoverageProblem | null {
  if (posting.status === "closed") {
    return "posting_closed";
  }
  if (posting.application_support !== "browser_supported") {
    return "application_unsupported";
  }
  if (
    (rule.mode === "auto" || rule.allowed_domains.length > 0) &&
    !domainAllowed(posting.apply_domain, rule.allowed_domains)
  ) {
    return "domain_not_allowed";
  }
  if (rule.mode === "auto") {
    const adapter = adapterOf(posting);
    if (!adapter?.automation.auto_ok) {
      return "adapter_not_auto";
    }
  }
  return null;
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => {
    const n = normalizeText(needle);
    return n.length > 0 && haystack.includes(n);
  });
}

const WILDCARD_RE = /[.*+?^${}()|[\]\\]/g;

function titleMatches(title: string, pattern: string): boolean {
  const normalized = normalizeText(pattern);
  if (!normalized) {
    return false;
  }
  if (!normalized.includes("*")) {
    return title.includes(normalized);
  }
  const source = normalized
    .split("*")
    .map((part) => part.replace(WILDCARD_RE, "\\$&"))
    .join(".*");
  return new RegExp(source).test(title);
}

function textMatches(
  criteria: RuleCriteria,
  posting: JobPostingRecord
): boolean {
  const title = normalizeText(posting.title);
  if (criteria.keywords?.length) {
    const text = `${title} ${normalizeText(posting.description_text)} ${posting.requirements.map((r) => normalizeText(r)).join(" ")}`;
    if (!containsAny(text, criteria.keywords)) {
      return false;
    }
  }
  return !(
    criteria.title_patterns?.length &&
    !criteria.title_patterns.some((p) => titleMatches(title, p))
  );
}

function companyMatches(
  criteria: RuleCriteria,
  posting: JobPostingRecord
): boolean {
  const company = normalizeText(posting.company_name);
  if (
    criteria.companies?.length &&
    !criteria.companies.some((c) => normalizeText(c) === company)
  ) {
    return false;
  }
  return !criteria.exclude_companies?.some((c) => normalizeText(c) === company);
}

function placeMatches(
  criteria: RuleCriteria,
  posting: JobPostingRecord
): boolean {
  if (
    criteria.workplace_types?.length &&
    !criteria.workplace_types.includes(posting.workplace_type ?? "unknown")
  ) {
    return false;
  }
  if (!criteria.locations?.length) {
    return true;
  }
  const places = posting.locations
    .map((l) =>
      normalizeText(
        [l.raw, l.city, l.region, l.country_code].filter(Boolean).join(" ")
      )
    )
    .join(" | ");
  const remoteOk =
    posting.workplace_type === "remote" &&
    criteria.locations.some((l) => normalizeText(l) === "remote");
  return remoteOk || containsAny(places, criteria.locations);
}

function seniorityMatches(
  criteria: RuleCriteria,
  posting: JobPostingRecord
): boolean {
  if (!criteria.seniority?.length) {
    return true;
  }
  const seniority = posting.seniority ? normalizeText(posting.seniority) : "";
  return criteria.seniority.some((s) => normalizeText(s) === seniority);
}

/** The non-score criteria of 19 §8.3 (keywords, titles, companies, …). */
export function criteriaMatch(
  criteria: RuleCriteria,
  posting: JobPostingRecord,
  sourceId: string | null
): boolean {
  const sourceOk =
    !criteria.source_ids?.length ||
    (sourceId !== null && criteria.source_ids.includes(sourceId));
  return (
    sourceOk &&
    textMatches(criteria, posting) &&
    companyMatches(criteria, posting) &&
    placeMatches(criteria, posting) &&
    seniorityMatches(criteria, posting)
  );
}

export type ScoreVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing"
        | "pending"
        | "failed"
        | "below_min"
        | "stale"
        | "blocking_gate"
        | "possible_gate"
        | "no_ai_component";
    };

/**
 * 07 §10: only a `ready` score of the current profile version and rubric
 * counts; blocking gates always exclude; possible gates and
 * deterministic-only scores exclude when the rule says so.
 */
export function scoreVerdict(
  score: MatchScoreRecord | undefined,
  criteria: RuleCriteria,
  now: number
): ScoreVerdict {
  if (!score) {
    return { ok: false, reason: "missing" };
  }
  if (score.status === "queued") {
    return { ok: false, reason: "pending" };
  }
  if (score.status === "failed") {
    return { ok: false, reason: "failed" };
  }
  if (score.rubric_version !== RUBRIC_VERSION) {
    return { ok: false, reason: "stale" };
  }
  if (now - score.created_at > criteria.max_score_age_days * DAY_MS) {
    return { ok: false, reason: "stale" };
  }
  const components = "gates" in score.components ? score.components : null;
  const gates = components?.gates ?? [];
  if (gates.some((gate) => gate.level === "blocking")) {
    return { ok: false, reason: "blocking_gate" };
  }
  if (
    criteria.exclude_possible_gates &&
    gates.some((gate) => gate.level === "possible")
  ) {
    return { ok: false, reason: "possible_gate" };
  }
  if (criteria.require_ai_component && components?.ai.status !== "ok") {
    return { ok: false, reason: "no_ai_component" };
  }
  if (score.score < criteria.min_score) {
    return { ok: false, reason: "below_min" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Retry policy (21 §8, 19 §8.4)
// ---------------------------------------------------------------------------

/**
 * Whether a failed attempt goes back to `queued`. Never after submit_intent
 * (D-19); never past `max_attempts`; classes marked "no"/"n/a" never retry;
 * "once" classes retry only after the first attempt; unknown classes follow
 * the device's `retryable` flag.
 */
export function shouldRetry(input: {
  attemptCount: number;
  clientRetryable: boolean | undefined;
  errorClass: string | undefined;
  maxAttempts: number;
  submitIntentAt: number | null;
}): boolean {
  if (input.submitIntentAt !== null) {
    return false;
  }
  if (input.attemptCount >= input.maxAttempts) {
    return false;
  }
  const policy = input.errorClass
    ? TASK_ERROR_RETRY[input.errorClass as TaskErrorClass]
    : undefined;
  if (policy === "no" || policy === "n/a") {
    return false;
  }
  if (policy === "once" && input.attemptCount > 1) {
    return false;
  }
  if (policy === undefined) {
    return input.clientRetryable === true;
  }
  return input.clientRetryable !== false;
}
