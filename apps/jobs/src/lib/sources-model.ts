// Sources screen rules (12 §8, 15 §8, §14) as pure functions: the adapter
// registry split into usable / excluded entries, the one-line config
// summary, a default label, the dry-run test command, the "Run now" task
// body, and a discovery run's errors grouped by class.

import type { CreateTaskRequest } from "@pilihpendidikan/jobs-contracts/api";
import type {
  AdapterManifest,
  AdaptersFile,
  ExcludedSource,
} from "@pilihpendidikan/jobs-contracts/adapters";
import type { DiscoveryErrorClass } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  DiscoveryRunRecord,
  JobSourceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { displayUrl, safeHref } from "./safe-url";

/** Server-managed config keys the form never edits (15 §14.3 Workday). */
export const SERVER_MANAGED_KEYS = ["disabled_reason"] as const;

export interface AdapterRegistry {
  excluded: ExcludedSource[];
  manifests: AdapterManifest[];
}

export function splitRegistry(file: AdaptersFile | undefined): AdapterRegistry {
  const manifests: AdapterManifest[] = [];
  const excluded: ExcludedSource[] = [];
  for (const entry of file?.adapters ?? []) {
    if (entry.status === "excluded") {
      excluded.push(entry);
    } else {
      manifests.push(entry);
    }
  }
  return { manifests, excluded };
}

/** Workday-style adapters need an explicit opt-in before saving (C-11). */
export function requiresOptIn(manifest: AdapterManifest): boolean {
  return manifest.status === "opt_in" || manifest.restrictions.requires_opt_in;
}

/** The dry-run command "Test" shows; nothing runs server-side (11 T-08). */
export function testCommand(sourceId: string): string {
  return `pilih-jobs discover --source ${sourceId} --dry-run`;
}

/** The value of a config key when it is a non-empty string or number. */
function scalar(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return typeof value === "number" ? String(value) : null;
}

function urlSummary(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const href = safeHref(value);
  return href ? displayUrl(href) : value;
}

/** "acme", "globex (EU)", "nvidia.wd5 / External", "initech.example/careers". */
export function configSummary(
  adapter: string,
  config: Record<string, unknown>
): string {
  switch (adapter) {
    case "greenhouse":
      return scalar(config, "board_token") ?? "";
    case "lever": {
      const site = scalar(config, "site") ?? "";
      return config.region === "eu" ? `${site} (EU)` : site;
    }
    case "ashby":
      return scalar(config, "job_board_name") ?? "";
    case "smartrecruiters":
      return scalar(config, "company_identifier") ?? "";
    case "workable":
      return scalar(config, "subdomain") ?? "";
    case "workday": {
      const tenant = scalar(config, "tenant") ?? "";
      const host = scalar(config, "wd_host_number");
      const site = scalar(config, "site");
      return [host ? `${tenant}.wd${host}` : tenant, site]
        .filter(Boolean)
        .join(" / ");
    }
    case "career_page":
    case "custom_url":
      return urlSummary(scalar(config, "url")) ?? "";
    case "generic_listing":
      return urlSummary(scalar(config, "start_url")) ?? "";
    default:
      return "";
  }
}

/** A label for a new source when the user typed none: "acme (Greenhouse)". */
export function defaultLabel(
  manifest: Pick<AdapterManifest, "id" | "display_name">,
  config: Record<string, unknown>
): string {
  const summary = configSummary(manifest.id, config);
  return summary
    ? `${summary} (${manifest.display_name})`
    : manifest.display_name;
}

/** `disabled_reason` set by the CLI on a denial or challenge (15 §8). */
export function disabledReason(source: JobSourceRecord): string | null {
  return scalar(source.config, "disabled_reason");
}

export const ANY_DEVICE = "any";

/** `POST /api/v1/tasks` body of "Run now" (12 §8). */
export function runNowTask(
  sourceIds: readonly string[],
  device: string,
  idempotencyKey: string,
  hasEligibleDevice: boolean
): CreateTaskRequest {
  return {
    kind: "discover",
    payload: { source_ids: [...sourceIds] },
    target_device_id: device === ANY_DEVICE ? null : device,
    idempotency_key: idempotencyKey,
    queue_without_device: !hasEligibleDevice,
  };
}

export interface RunErrorGroup {
  count: number;
  errorClass: DiscoveryErrorClass;
  /** Hosts named by the errors (for "Access denied by <host>"). */
  hosts: string[];
}

function hostOf(
  url: string | undefined,
  source: string | undefined
): string | null {
  const href = safeHref(url ?? null);
  if (href) {
    try {
      return new URL(href).hostname;
    } catch {
      return null;
    }
  }
  return source && source.trim() !== "" ? source.trim() : null;
}

/**
 * A run's errors by class (15 §8): the stats counters when present (they
 * cover more than the 50 stored errors), else the stored errors counted.
 * Most frequent first.
 */
export function runErrorGroups(run: DiscoveryRunRecord): RunErrorGroup[] {
  const counts = new Map<DiscoveryErrorClass, number>();
  const hosts = new Map<DiscoveryErrorClass, Set<string>>();
  for (const error of run.errors) {
    counts.set(error.error_class, (counts.get(error.error_class) ?? 0) + 1);
    const host = hostOf(error.url, error.source);
    if (host) {
      const set = hosts.get(error.error_class) ?? new Set<string>();
      set.add(host);
      hosts.set(error.error_class, set);
    }
  }
  const byClass = run.stats.errors_by_class ?? {};
  for (const [errorClass, value] of Object.entries(byClass)) {
    if (typeof value === "number" && value > 0) {
      counts.set(errorClass as DiscoveryErrorClass, value);
    }
  }
  return [...counts.entries()]
    .map(([errorClass, count]) => ({
      errorClass,
      count,
      hosts: [...(hosts.get(errorClass) ?? [])],
    }))
    .sort(
      (a, b) => b.count - a.count || a.errorClass.localeCompare(b.errorClass)
    );
}

/** Duration in ms, or null while running. */
export function runDuration(run: DiscoveryRunRecord): number | null {
  return run.finished_at === null
    ? null
    : Math.max(0, run.finished_at - run.started_at);
}

/** "4 min", "1 h 05 min", "45 s". */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** True when some run is still running (the runs table polls). */
export function hasRunningRun(runs: readonly DiscoveryRunRecord[]): boolean {
  return runs.some((run) => run.status === "running");
}

/** `t(key)` when the catalogue has it, else `fallback` (manifest English). */
export function translateOr(
  t: (key: string) => string,
  key: string,
  fallback: string
): string {
  const text = t(key);
  return text === key ? fallback : text;
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortedJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          sortedJson((value as Record<string, unknown>)[key]),
        ])
    );
  }
  return value;
}

/** Deep equality of two JSON configs, ignoring key order. */
export function sameConfig(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortedJson(a)) === JSON.stringify(sortedJson(b));
}
