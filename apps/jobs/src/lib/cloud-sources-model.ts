// Cloud catalog rules (24 §5, 05 §15) as pure functions: status badges and
// groups, filters and sort order, the "next run" state, diagnostics per
// error class, the operator editor's change set and strategy-config check,
// and the "Add board" URL check.

import type {
  CloudRunView,
  CloudSourceView,
  UpdateCloudSourceRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import { parseStrategyConfig } from "@pilihpendidikan/jobs-contracts/cloud-config";
import type {
  CloudErrorClass,
  CloudRunStatus,
  CloudSourceOrigin,
  CloudSourceStatus,
  CloudStrategy,
} from "@pilihpendidikan/jobs-contracts/enums";

export type BadgeVariant = "secondary" | "destructive" | "outline" | "ghost";

/** Badge per status: cobalt is never spent here (DESIGN.md § Colour). */
export function statusBadgeVariant(status: CloudSourceStatus): BadgeVariant {
  switch (status) {
    case "ACTIVE":
      return "secondary";
    case "SCRAPING":
    case "RATE_LIMITED":
    case "AUTH_REQUIRED":
      return "outline";
    case "FAILED":
    case "BLOCKED":
      return "destructive";
    default:
      return "ghost";
  }
}

export const statusLabelKey = (status: CloudSourceStatus) =>
  `cloudSources.statuses.${status}`;
export const categoryLabelKey = (category: string) =>
  `cloudSources.categories.${category}`;
export const strategyLabelKey = (strategy: CloudStrategy) =>
  `cloudSources.strategies.${strategy}`;
export const originLabelKey = (origin: CloudSourceOrigin) =>
  `cloudSources.origins.${origin}`;
export const runStatusLabelKey = (status: CloudRunStatus) =>
  `cloudSources.runStatuses.${status}`;
export const errorClassLabelKey = (errorClass: CloudErrorClass) =>
  `cloudSources.errors.${errorClass}`;

export const STATUS_GROUPS = [
  "all",
  "active",
  "attention",
  "inactive",
] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

const ATTENTION: readonly CloudSourceStatus[] = [
  "FAILED",
  "BLOCKED",
  "AUTH_REQUIRED",
  "RATE_LIMITED",
];

export function statusGroupOf(
  status: CloudSourceStatus
): Exclude<StatusGroup, "all"> {
  if (status === "ACTIVE" || status === "SCRAPING") {
    return "active";
  }
  return ATTENTION.includes(status) ? "attention" : "inactive";
}

export interface CloudFilters {
  following: boolean;
  group: StatusGroup;
  q: string;
}

export const DEFAULT_CLOUD_FILTERS: CloudFilters = Object.freeze({
  group: "all",
  following: false,
  q: "",
});

function matchesQuery(source: CloudSourceView, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  return (
    source.name.toLowerCase().includes(needle) ||
    source.canonical_domain.toLowerCase().includes(needle)
  );
}

export function filterCloudSources(
  sources: readonly CloudSourceView[],
  filters: CloudFilters
): CloudSourceView[] {
  return sources.filter(
    (source) =>
      (filters.group === "all" ||
        statusGroupOf(source.status) === filters.group) &&
      (!filters.following || source.following) &&
      matchesQuery(source, filters.q)
  );
}

/** Usable sources first, problems next, retired ones last. */
const STATUS_RANK: Readonly<Record<CloudSourceStatus, number>> = {
  SCRAPING: 0,
  ACTIVE: 0,
  RATE_LIMITED: 1,
  FAILED: 2,
  AUTH_REQUIRED: 3,
  BLOCKED: 3,
  DISABLED: 4,
  UNSUPPORTED: 5,
};

/** Following first, then status, priority (high first) and name. */
export function sortCloudSources(
  sources: readonly CloudSourceView[]
): CloudSourceView[] {
  return [...sources].sort(
    (a, b) =>
      Number(b.following) - Number(a.following) ||
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      b.priority - a.priority ||
      a.name.localeCompare(b.name)
  );
}

export function countByGroup(
  sources: readonly CloudSourceView[]
): Record<StatusGroup, number> {
  const counts: Record<StatusGroup, number> = {
    all: sources.length,
    active: 0,
    attention: 0,
    inactive: 0,
  };
  for (const source of sources) {
    counts[statusGroupOf(source.status)] += 1;
  }
  return counts;
}

const SCHEDULABLE_HEALTH = new Set(["ACTIVE", "FAILED", "RATE_LIMITED"]);

export type NextRun =
  | { kind: "scraping" }
  | { kind: "due" }
  | { kind: "at"; at: number }
  | {
      kind: "paused";
      reason:
        | "pipeline_off"
        | "disabled"
        | "breaker"
        | "needs_retry"
        | "unsupported"
        | "no_strategy";
      until?: number;
    };

/**
 * When the next scheduled scrape happens (24 §6.1): paused when the pipeline
 * or the source is off, the breaker is open, the health needs an operator,
 * or the source has no strategy.
 */
export function nextRunOf(
  source: CloudSourceView,
  nowMs: number,
  pipelineEnabled: boolean
): NextRun {
  if (source.status === "SCRAPING") {
    return { kind: "scraping" };
  }
  if (!pipelineEnabled) {
    return { kind: "paused", reason: "pipeline_off" };
  }
  if (!source.enabled) {
    return { kind: "paused", reason: "disabled" };
  }
  if (source.health === "UNSUPPORTED") {
    return { kind: "paused", reason: "unsupported" };
  }
  if (!SCHEDULABLE_HEALTH.has(source.health)) {
    return { kind: "paused", reason: "needs_retry" };
  }
  if (source.strategy === "none") {
    return { kind: "paused", reason: "no_strategy" };
  }
  if (source.circuit_open_until !== null && source.circuit_open_until > nowMs) {
    return {
      kind: "paused",
      reason: "breaker",
      until: source.circuit_open_until,
    };
  }
  if (source.next_run_at === null || source.next_run_at <= nowMs) {
    return { kind: "due" };
  }
  return { kind: "at", at: source.next_run_at };
}

/** Statuses an operator can retry (closes the breaker, clears the stop). */
export function canRetry(status: CloudSourceStatus): boolean {
  return ATTENTION.includes(status);
}

/** True while the list should poll fast (24 §5: 5 s while something runs). */
export function hasLiveCloudWork(
  sources: readonly CloudSourceView[] | undefined,
  watchUntil: number,
  nowMs: number
): boolean {
  if (watchUntil > nowMs) {
    return true;
  }
  return (sources ?? []).some(
    (source) =>
      source.status === "SCRAPING" ||
      source.last_run_status === "queued" ||
      source.last_run_status === "running"
  );
}

export function isLiveRun(run: Pick<CloudRunView, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

// --- diagnostics ----------------------------------------------------------------

export type DiagnosticKind =
  | "challenge"
  | "denied"
  | "auth"
  | "robots"
  | "rate_limited"
  | "layout"
  | "engine"
  | "config"
  | "transient"
  | "gone"
  | "policy"
  | "other";

const DIAGNOSTIC_OF: Readonly<Record<CloudErrorClass, DiagnosticKind>> = {
  challenge_detected: "challenge",
  access_denied: "denied",
  auth_required: "auth",
  robots_disallowed: "robots",
  rate_limited: "rate_limited",
  parse_error: "layout",
  schema_invalid: "layout",
  selector_drift: "layout",
  unsupported_content: "layout",
  engine_unavailable: "engine",
  invalid_config: "config",
  network: "transient",
  timeout: "transient",
  http_5xx: "transient",
  source_unavailable: "transient",
  not_found: "gone",
  source_closed: "gone",
  policy_blocked: "policy",
  cancelled: "other",
};

export interface Diagnostic {
  errorClass: CloudErrorClass | null;
  /** i18n key of the actionable explanation (`cloudSources.diagnostics.*`). */
  key: string;
  kind: DiagnosticKind;
  message: string | null;
}

/**
 * What went wrong and what to do about it, from the last error class (or,
 * without one, from a health that needs explaining). Null when healthy.
 */
export function diagnosticOf(source: CloudSourceView): Diagnostic | null {
  const errorClass = source.last_error_class;
  let kind: DiagnosticKind | null = errorClass
    ? DIAGNOSTIC_OF[errorClass]
    : null;
  if (kind === null) {
    if (source.health === "AUTH_REQUIRED") {
      kind = "auth";
    } else if (source.health === "BLOCKED") {
      kind = "denied";
    } else if (source.health === "RATE_LIMITED") {
      kind = "rate_limited";
    } else if (source.health === "FAILED") {
      kind = "other";
    }
  }
  if (kind === null) {
    return null;
  }
  return {
    kind,
    errorClass,
    key: `cloudSources.diagnostics.${kind}`,
    message: source.last_error_message,
  };
}

// --- intervals ----------------------------------------------------------------------

export const INTERVAL_OPTIONS = [60, 120, 180, 360, 720, 1440, 10_080] as const;
export const intervalLabelKey = (minutes: number) =>
  (INTERVAL_OPTIONS as readonly number[]).includes(minutes)
    ? `cloudSources.intervals.m${minutes}`
    : "cloudSources.intervals.custom";

// --- operator editor -------------------------------------------------------------------

/** JSON with object keys sorted at every level (key order never counts). */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The writable catalog fields (conflicts compare only these, 12 §11). */
export const CLOUD_SOURCE_FIELDS = [
  "name",
  "listing_url",
  "category",
  "enabled",
  "priority",
  "interval_minutes",
  "strategy",
  "strategy_config",
  "rate_limit",
  "ai_enabled",
  "allow_browser",
  "health",
  "status_reason",
  "auth_required",
  "auth_note",
] as const;

export type CloudSourceChanges = Omit<
  UpdateCloudSourceRequest,
  "base_revision"
>;

export interface EditorForm {
  aiEnabled: boolean;
  allowBrowser: boolean;
  authNote: string;
  authRequired: boolean;
  configText: string;
  enabled: boolean;
  /** "" keeps the stored health. */
  health: "" | "ACTIVE" | "UNSUPPORTED";
  intervalMinutes: number;
  maxDetails: string;
  maxItems: string;
  maxPages: string;
  minDelayMs: string;
  priority: string;
  statusReason: string;
  strategy: CloudStrategy;
}

const numberText = (value: number | undefined) =>
  value === undefined ? "" : String(value);

export function editorFormOf(source: CloudSourceView): EditorForm {
  return {
    enabled: source.enabled,
    priority: String(source.priority),
    intervalMinutes: source.interval_minutes,
    strategy: source.strategy,
    configText: JSON.stringify(source.strategy_config, null, 2),
    minDelayMs: numberText(source.rate_limit.min_delay_ms),
    maxPages: numberText(source.rate_limit.max_pages),
    maxItems: numberText(source.rate_limit.max_items),
    maxDetails: numberText(source.rate_limit.max_details),
    aiEnabled: source.ai_enabled,
    allowBrowser: source.allow_browser,
    health: "",
    statusReason: source.status_reason ?? "",
    authRequired: source.auth_required,
    authNote: source.auth_note ?? "",
  };
}

export interface ConfigCheck {
  config: Record<string, unknown> | null;
  /** "path: message" lines; empty when valid. */
  issues: string[];
  /** The text is not JSON at all. */
  syntax: boolean;
}

/** Parses the editor's JSON and validates it for `strategy` (cloud-config.ts). */
export function checkStrategyConfig(
  strategy: CloudStrategy,
  text: string
): ConfigCheck {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      config: null,
      syntax: true,
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { config: null, syntax: true, issues: ["{…}"] };
  }
  const parsed = parseStrategyConfig(strategy, value);
  if (parsed.ok) {
    return { config: parsed.config, syntax: false, issues: [] };
  }
  return {
    config: null,
    syntax: false,
    issues: parsed.issues.map((issue) =>
      issue.path ? `${issue.path}: ${issue.message}` : issue.message
    ),
  };
}

type RateField = "minDelayMs" | "maxPages" | "maxItems" | "maxDetails";
const RATE_BOUNDS: Readonly<
  Record<RateField, { key: string; max: number; min: number }>
> = {
  minDelayMs: { key: "min_delay_ms", min: 1000, max: 60_000 },
  maxPages: { key: "max_pages", min: 1, max: 10 },
  maxItems: { key: "max_items", min: 1, max: 500 },
  maxDetails: { key: "max_details", min: 0, max: 50 },
};

export interface EditorErrors {
  config?: string[];
  priority?: boolean;
  rate?: RateField[];
}

interface ValidatedForm {
  config: Record<string, unknown> | null;
  priority: number;
  rate: Record<string, number>;
}

function parseRate(form: EditorForm): {
  bad: RateField[];
  rate: Record<string, number>;
} {
  const rate: Record<string, number> = {};
  const bad: RateField[] = [];
  for (const field of Object.keys(RATE_BOUNDS) as RateField[]) {
    const text = form[field].trim();
    if (text === "") {
      continue;
    }
    const value = Number(text);
    const bounds = RATE_BOUNDS[field];
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
      bad.push(field);
    } else {
      rate[bounds.key] = value;
    }
  }
  return { bad, rate };
}

function validateForm(
  form: EditorForm
): { ok: true; value: ValidatedForm } | { ok: false; errors: EditorErrors } {
  const errors: EditorErrors = {};
  const priority = Number(form.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
    errors.priority = true;
  }
  const check = checkStrategyConfig(form.strategy, form.configText);
  if (check.issues.length > 0) {
    errors.config = check.issues;
  }
  const { bad, rate } = parseRate(form);
  if (bad.length > 0) {
    errors.rate = bad;
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: { config: check.config, priority, rate } };
}

/** `next` when it differs from `current` (null for an empty note). */
function noteChange(
  text: string,
  current: string | null
): string | null | undefined {
  const value = text.trim();
  if (value === (current ?? "")) {
    return undefined;
  }
  return value === "" ? null : value;
}

function differs(a: unknown, b: unknown): boolean {
  return stableJson(a) !== stableJson(b);
}

/** The PATCH body (without base_revision) or the form's errors. */
export function editorChanges(
  source: CloudSourceView,
  form: EditorForm
):
  | { ok: true; changes: CloudSourceChanges }
  | { ok: false; errors: EditorErrors } {
  const validated = validateForm(form);
  if (!validated.ok) {
    return validated;
  }
  const { config, priority, rate } = validated.value;
  const candidate: CloudSourceChanges = {
    enabled: form.enabled,
    priority,
    interval_minutes: form.intervalMinutes,
    strategy: form.strategy,
    ai_enabled: form.aiEnabled,
    allow_browser: form.allowBrowser,
    auth_required: form.authRequired,
  };
  const changes: CloudSourceChanges = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (differs(value, source[key as keyof CloudSourceView])) {
      (changes as Record<string, unknown>)[key] = value;
    }
  }
  if (config && differs(config, source.strategy_config)) {
    changes.strategy_config = config;
  }
  if (differs(rate, source.rate_limit)) {
    changes.rate_limit = rate;
  }
  if (form.health !== "" && form.health !== source.health) {
    changes.health = form.health;
  }
  const reason = noteChange(form.statusReason, source.status_reason);
  if (reason !== undefined) {
    changes.status_reason = reason;
  }
  const authNote = noteChange(form.authNote, source.auth_note);
  if (authNote !== undefined) {
    changes.auth_note = authNote;
  }
  return { ok: true, changes };
}

// --- add board -------------------------------------------------------------------------

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const TRAILING_DOT_RE = /\.$/;
const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain"]);

export type BoardUrlProblem =
  | "empty"
  | "invalid"
  | "scheme"
  | "credentials"
  | "local";

/**
 * Client-side check of a board URL (the api re-validates and resolves DNS,
 * 24 §8): absolute http(s), no credentials, a public-looking host name.
 */
export function boardUrlProblem(raw: string): BoardUrlProblem | null {
  const text = raw.trim();
  if (text === "") {
    return "empty";
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "scheme";
  }
  if (url.username || url.password) {
    return "credentials";
  }
  const host = url.hostname.toLowerCase().replace(TRAILING_DOT_RE, "");
  if (
    LOCAL_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    IPV4_RE.test(host) ||
    host.startsWith("[") ||
    !host.includes(".")
  ) {
    return "local";
  }
  return null;
}
