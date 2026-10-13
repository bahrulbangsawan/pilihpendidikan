// The automation rule editor's model (12 §6.2, 19 §8.3, D-35): the form
// state, its validation (the contract's bounds plus the `auto` constraints
// the API enforces), the request bodies, and the plain-language summaries
// shown in the table and the activation dialog.

import type {
  CreateRuleRequest,
  UpdateRuleRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  RuleMode,
  WorkplaceType,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  asciiHost,
  registrableDomain,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import type {
  AutomationRuleRecord,
  RuleCriteria,
  RuleLimits,
} from "@pilihpendidikan/jobs-contracts/records";
import { RULE_LIMIT_DEFAULTS } from "@pilihpendidikan/jobs-contracts/records";
import type { SeniorityLevel } from "@pilihpendidikan/jobs-contracts/scoring";
import type { Translate } from "@/i18n";

const DAY_MS = 86_400_000;
export const AUTO_MAX_VALIDITY_MS =
  RULE_LIMIT_DEFAULTS.auto_max_validity_days * DAY_MS;
export const MAX_SCORE_AGE_DAYS = { min: 1, default: 14, max: 365 } as const;
const NAME_MAX = 120;
/** How many chips each list of a rule holds (records.ts RuleCriteria). */
export const RULE_LIST_LIMITS = {
  keywords: 50,
  titlePatterns: 50,
  companies: 100,
  excludeCompanies: 100,
  locations: 50,
  sourceIds: 50,
  allowedDomains: 50,
} as const;
const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOMAIN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

export interface RuleForm {
  activeHours: { start: string; end: string } | null;
  allowedDomains: string[];
  baseCvId: string | null;
  companies: string[];
  enabled: boolean;
  excludeCompanies: string[];
  excludePossibleGates: boolean;
  /** `YYYY-MM-DD` in the browser's zone, or "" for none. */
  expiresOn: string;
  keywords: string[];
  locations: string[];
  maxPerCompany: number;
  maxPerDay: number;
  maxScoreAgeDays: number;
  minScore: number;
  mode: RuleMode;
  name: string;
  requireAi: boolean;
  requireCvApproval: boolean;
  seniority: SeniorityLevel[];
  sourceIds: string[];
  tailor: boolean;
  titlePatterns: string[];
  workplaceTypes: WorkplaceType[];
}

/** `YYYY-MM-DD` of `ms` in the browser's zone. */
export function dayOf(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The last minute of `day` in the browser's zone (epoch ms), or null. */
export function endOfDay(day: string): number | null {
  if (!DAY_RE.test(day)) {
    return null;
  }
  const ms = new Date(`${day}T23:59`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function emptyRuleForm(): RuleForm {
  return {
    name: "",
    mode: "approval",
    enabled: true,
    minScore: 80,
    requireAi: false,
    maxScoreAgeDays: MAX_SCORE_AGE_DAYS.default,
    excludePossibleGates: false,
    keywords: [],
    titlePatterns: [],
    companies: [],
    excludeCompanies: [],
    locations: [],
    sourceIds: [],
    workplaceTypes: [],
    seniority: [],
    maxPerDay: RULE_LIMIT_DEFAULTS.max_per_day,
    maxPerCompany: RULE_LIMIT_DEFAULTS.max_per_company_per_30d,
    activeHours: null,
    expiresOn: "",
    allowedDomains: [],
    baseCvId: null,
    tailor: true,
    requireCvApproval: true,
  };
}

export function ruleToForm(rule: AutomationRuleRecord): RuleForm {
  const { criteria, limits, cv_policy: cv } = rule;
  return {
    name: rule.name,
    mode: rule.mode,
    enabled: rule.enabled,
    minScore: criteria.min_score,
    requireAi: criteria.require_ai_component,
    maxScoreAgeDays: criteria.max_score_age_days,
    excludePossibleGates: criteria.exclude_possible_gates,
    keywords: [...(criteria.keywords ?? [])],
    titlePatterns: [...(criteria.title_patterns ?? [])],
    companies: [...(criteria.companies ?? [])],
    excludeCompanies: [...(criteria.exclude_companies ?? [])],
    locations: [...(criteria.locations ?? [])],
    sourceIds: [...(criteria.source_ids ?? [])],
    workplaceTypes: [...(criteria.workplace_types ?? [])],
    seniority: [...(criteria.seniority ?? [])],
    maxPerDay: limits.max_per_day,
    maxPerCompany: limits.max_per_company_per_30d,
    activeHours: limits.active_hours ? { ...limits.active_hours } : null,
    expiresOn: limits.expires_at ? dayOf(limits.expires_at) : "",
    allowedDomains: [...rule.allowed_domains],
    baseCvId: cv.base_cv_id ?? null,
    tailor: cv.tailor ?? true,
    requireCvApproval: cv.require_cv_approval ?? true,
  };
}

/** Switching to `auto` pre-fills the 30-day expiry the API would require. */
export function withMode(form: RuleForm, mode: RuleMode, nowMs: number) {
  if (mode === "auto" && form.expiresOn === "") {
    return { ...form, mode, expiresOn: dayOf(nowMs + AUTO_MAX_VALIDITY_MS) };
  }
  return { ...form, mode };
}

/**
 * A domain chip as the API stores it: the registrable domain of a host, URL
 * or domain ("https://boards.greenhouse.io/acme" → "greenhouse.io"), or
 * null when it is not a domain at all.
 */
export function normalizeDomain(raw: string): string | null {
  const host = asciiHost(raw);
  if (!host || host.includes(":") || !DOMAIN_RE.test(host)) {
    return null;
  }
  const domain = registrableDomain(host) ?? host;
  return DOMAIN_RE.test(domain) ? domain : null;
}

/** Splits a chip input ("react, typescript") into trimmed, unique values. */
export function addChips(
  current: readonly string[],
  raw: string,
  max: number
): string[] {
  const next = [...current];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value && !next.includes(value) && next.length < max) {
      next.push(value);
    }
  }
  return next;
}

export type RuleField =
  | "name"
  | "minScore"
  | "criteria"
  | "maxPerDay"
  | "maxPerCompany"
  | "activeHours"
  | "expiresOn"
  | "allowedDomains"
  | "maxScoreAgeDays";

/** Field → i18n key of the problem; empty when the form can be saved. */
export type RuleProblems = Partial<Record<RuleField, string>>;

function between(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** The contract's bounds (records.ts RuleCriteria / RuleLimits, D-35). */
function boundProblems(form: RuleForm, nowMs: number): RuleProblems {
  const problems: RuleProblems = {};
  const name = form.name.trim();
  if (name.length === 0 || name.length > NAME_MAX) {
    problems.name = "rules.errors.name";
  }
  if (!between(form.minScore, 0, 100)) {
    problems.minScore = "rules.errors.minScore";
  }
  if (
    !between(
      form.maxScoreAgeDays,
      MAX_SCORE_AGE_DAYS.min,
      MAX_SCORE_AGE_DAYS.max
    )
  ) {
    problems.maxScoreAgeDays = "rules.errors.maxScoreAgeDays";
  }
  if (!between(form.maxPerDay, 1, RULE_LIMIT_DEFAULTS.max_per_day_ceiling)) {
    problems.maxPerDay = "rules.errors.maxPerDay";
  }
  if (
    !between(
      form.maxPerCompany,
      1,
      RULE_LIMIT_DEFAULTS.max_per_company_per_30d_ceiling
    )
  ) {
    problems.maxPerCompany = "rules.errors.maxPerCompany";
  }
  if (form.activeHours && !validHours(form.activeHours)) {
    problems.activeHours = "rules.errors.activeHours";
  }
  const expiresAt = form.expiresOn ? endOfDay(form.expiresOn) : null;
  if (form.expiresOn && (expiresAt === null || expiresAt <= nowMs)) {
    problems.expiresOn = "rules.errors.expiresPast";
  }
  if (form.allowedDomains.some((domain) => normalizeDomain(domain) === null)) {
    problems.allowedDomains = "rules.errors.domainInvalid";
  }
  return problems;
}

function validHours(hours: { start: string; end: string }): boolean {
  return (
    HH_MM_RE.test(hours.start) &&
    HH_MM_RE.test(hours.end) &&
    hours.start !== hours.end
  );
}

/** 19 §8.3: what an `auto` rule needs on top of the bounds. */
function autoProblems(
  form: RuleForm,
  nowMs: number,
  bounds: RuleProblems
): RuleProblems {
  const problems: RuleProblems = {};
  if (form.minScore < RULE_LIMIT_DEFAULTS.auto_min_score) {
    problems.minScore = "rules.errors.autoMinScore";
  }
  const narrowed =
    form.keywords.length +
      form.titlePatterns.length +
      form.companies.length +
      form.sourceIds.length >
    0;
  if (!narrowed) {
    problems.criteria = "rules.errors.autoNarrow";
  }
  if (form.allowedDomains.length === 0) {
    problems.allowedDomains = "rules.errors.autoDomains";
  }
  const expiresAt = form.expiresOn ? endOfDay(form.expiresOn) : null;
  if (expiresAt === null && !bounds.expiresOn) {
    problems.expiresOn = "rules.errors.autoExpiry";
  } else if (
    expiresAt !== null &&
    expiresAt - nowMs > AUTO_MAX_VALIDITY_MS + DAY_MS
  ) {
    problems.expiresOn = "rules.errors.autoExpiryTooFar";
  }
  return problems;
}

/** The contract's bounds plus 19 §8.3 for `auto` rules. */
export function validateRuleForm(form: RuleForm, nowMs: number): RuleProblems {
  const bounds = boundProblems(form, nowMs);
  if (form.mode !== "auto") {
    return bounds;
  }
  return { ...bounds, ...autoProblems(form, nowMs, bounds) };
}

export function hasProblems(problems: RuleProblems): boolean {
  return Object.keys(problems).length > 0;
}

function list<T>(values: readonly T[]): T[] | undefined {
  return values.length > 0 ? [...values] : undefined;
}

export function formCriteria(form: RuleForm): RuleCriteria {
  const criteria: RuleCriteria = {
    min_score: form.minScore,
    require_ai_component: form.requireAi,
    max_score_age_days: form.maxScoreAgeDays,
    exclude_blocking_gates: true,
    exclude_possible_gates: form.excludePossibleGates,
  };
  const optional: [keyof RuleCriteria, unknown[] | undefined][] = [
    ["keywords", list(form.keywords)],
    ["title_patterns", list(form.titlePatterns)],
    ["companies", list(form.companies)],
    ["exclude_companies", list(form.excludeCompanies)],
    ["source_ids", list(form.sourceIds)],
    ["locations", list(form.locations)],
    ["workplace_types", list(form.workplaceTypes)],
    ["seniority", list(form.seniority)],
  ];
  for (const [key, value] of optional) {
    if (value) {
      (criteria as Record<string, unknown>)[key] = value;
    }
  }
  return criteria;
}

export function formLimits(form: RuleForm, nowMs: number): RuleLimits {
  const end = form.expiresOn ? endOfDay(form.expiresOn) : null;
  // An auto rule never outlives 30 days (D-35), even on the boundary day.
  const expiresAt =
    end !== null && form.mode === "auto"
      ? Math.min(end, nowMs + AUTO_MAX_VALIDITY_MS)
      : end;
  return {
    max_per_day: form.maxPerDay,
    max_per_company_per_30d: form.maxPerCompany,
    active_hours: form.activeHours ? { ...form.activeHours } : null,
    expires_at: expiresAt,
  };
}

function formDomains(form: RuleForm): string[] {
  const out: string[] = [];
  for (const raw of form.allowedDomains) {
    const domain = normalizeDomain(raw);
    if (domain && !out.includes(domain)) {
      out.push(domain);
    }
  }
  return out;
}

export function createRuleBody(
  form: RuleForm,
  nowMs: number
): CreateRuleRequest {
  return {
    name: form.name.trim(),
    mode: form.mode,
    enabled: form.enabled,
    criteria: formCriteria(form),
    limits: formLimits(form, nowMs),
    allowed_domains: formDomains(form),
    cv_policy: {
      base_cv_id: form.baseCvId,
      tailor: form.tailor,
      require_cv_approval: form.requireCvApproval,
    },
  };
}

/** JSON with object keys sorted, so key order never reads as a change. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) =>
    child && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(
          Object.entries(child as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : child
  );
}

/** The changed fields of an edit (PATCH sends only these, D-21). */
export function updateRuleChanges(
  rule: AutomationRuleRecord,
  form: RuleForm,
  nowMs: number
): Omit<UpdateRuleRequest, "base_revision"> {
  const next = createRuleBody(form, nowMs);
  const changes: Omit<UpdateRuleRequest, "base_revision"> = {};
  const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
  if (next.name !== rule.name) {
    changes.name = next.name;
  }
  if (next.mode !== rule.mode) {
    changes.mode = next.mode;
  }
  if (next.enabled !== rule.enabled) {
    changes.enabled = next.enabled;
  }
  if (!same(next.criteria, rule.criteria)) {
    changes.criteria = next.criteria;
  }
  if (
    !same(next.limits, {
      ...rule.limits,
      active_hours: rule.limits.active_hours ?? null,
      expires_at: rule.limits.expires_at ?? null,
    })
  ) {
    changes.limits = next.limits;
  }
  if (!same(next.allowed_domains, rule.allowed_domains)) {
    changes.allowed_domains = next.allowed_domains;
  }
  if (
    !same(next.cv_policy, {
      base_cv_id: rule.cv_policy.base_cv_id ?? null,
      tailor: rule.cv_policy.tailor ?? true,
      require_cv_approval: rule.cv_policy.require_cv_approval ?? true,
    })
  ) {
    changes.cv_policy = next.cv_policy;
  }
  return changes;
}

/** The writable fields of a rule (conflict merge, 12 §11). */
export const RULE_FIELDS = [
  "name",
  "mode",
  "enabled",
  "criteria",
  "limits",
  "allowed_domains",
  "cv_policy",
] as const;

type SummaryRule = Pick<
  AutomationRuleRecord,
  "allowed_domains" | "criteria" | "limits" | "mode"
>;

/** "React, frontend · score 80+ · Remote, Jakarta": the table's criteria. */
export function criteriaSummary(
  t: Translate,
  criteria: RuleCriteria,
  sourceLabel: (id: string) => string
): string {
  const parts: string[] = [];
  const words = [
    ...(criteria.keywords ?? []),
    ...(criteria.title_patterns ?? []),
    ...(criteria.companies ?? []),
  ];
  if (words.length > 0) {
    parts.push(words.join(", "));
  }
  parts.push(t("rules.summary.score", { score: criteria.min_score }));
  if ((criteria.source_ids?.length ?? 0) > 0) {
    parts.push((criteria.source_ids ?? []).map(sourceLabel).join(", "));
  }
  if ((criteria.locations?.length ?? 0) > 0) {
    parts.push((criteria.locations ?? []).join(", "));
  }
  if ((criteria.workplace_types?.length ?? 0) > 0) {
    parts.push(
      (criteria.workplace_types ?? [])
        .map((type) => t(`workplace.${type}`))
        .join(", ")
    );
  }
  return parts.join(" · ");
}

/** "5 a day · 2 per company in 30 days · 08:00–20:00". */
export function limitsSummary(t: Translate, limits: RuleLimits): string {
  const parts = [
    t("rules.summary.perDay", { count: limits.max_per_day }),
    t("rules.summary.perCompany", { count: limits.max_per_company_per_30d }),
  ];
  if (limits.active_hours) {
    parts.push(
      t("rules.summary.hours", {
        start: limits.active_hours.start,
        end: limits.active_hours.end,
      })
    );
  }
  return parts.join(" · ");
}

/**
 * The plain-language activation sentence of 12 §6.2: "Up to 5 applications
 * a day to Greenhouse and Lever jobs scoring 85+ …". Used when the approval
 * carries no server summary, and in the editor preview.
 */
export function activationSentence(
  t: Translate,
  rule: SummaryRule,
  options: { sources?: readonly string[]; until?: string | null } = {}
): string {
  const where =
    options.sources && options.sources.length > 0
      ? options.sources.join(", ")
      : rule.allowed_domains.join(", ");
  const base = t("rules.summary.sentence", {
    count: rule.limits.max_per_day,
    where: where || t("rules.summary.anywhere"),
    score: rule.criteria.min_score,
    company: rule.limits.max_per_company_per_30d,
  });
  const hours = rule.limits.active_hours
    ? ` ${t("rules.summary.sentenceHours", {
        start: rule.limits.active_hours.start,
        end: rule.limits.active_hours.end,
      })}`
    : "";
  const until = options.until
    ? ` ${t("rules.summary.sentenceUntil", { date: options.until })}`
    : "";
  return `${base}${hours}${until}`;
}

/** The typed confirmation matches the rule name (trimmed, case-sensitive). */
export function nameConfirmed(typed: string, name: string): boolean {
  return typed.trim().length > 0 && typed.trim() === name.trim();
}
