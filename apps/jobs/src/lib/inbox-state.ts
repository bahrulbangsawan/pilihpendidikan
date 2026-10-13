// What the inbox says around its rows (12 §4): the empty state (no sources,
// no runs yet, all caught up), the import status strip of the last
// discovery run, whether a run is active (the inbox polls only then), and a
// posting's provenance and duplicate listings (15 §11
// `extraction.alternates`).

import type { InboxItem } from "@pilihpendidikan/jobs-contracts/api";
import type { DiscoveryErrorClass } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  DiscoveryRunRecord,
  JobPostingRecord,
} from "@pilihpendidikan/jobs-contracts/records";

const DAY_MS = 86_400_000;

export type InboxEmptyKind =
  | "no_sources"
  | "no_runs"
  | "caught_up"
  | "no_matches"
  | "empty_tab";

/**
 * The empty state for an empty list: filters first (they may hide rows),
 * then the other tabs, then the onboarding steps of the New tab.
 */
export function inboxEmptyKind(input: {
  filtered: boolean;
  runs: number;
  sources: number;
  tab: "new" | "seen" | "dismissed";
}): InboxEmptyKind {
  if (input.filtered) {
    return "no_matches";
  }
  if (input.tab !== "new") {
    return "empty_tab";
  }
  if (input.sources === 0) {
    return "no_sources";
  }
  if (input.runs === 0) {
    return "no_runs";
  }
  return "caught_up";
}

export function anyRunActive(
  runs: readonly DiscoveryRunRecord[] | undefined
): boolean {
  return (runs ?? []).some((run) => run.status === "running");
}

/** When the newest run ended (or started, while it runs); null if none. */
export function lastRunAt(
  runs: readonly DiscoveryRunRecord[] | undefined
): number | null {
  let latest: number | null = null;
  for (const run of runs ?? []) {
    const at = run.finished_at ?? run.started_at;
    if (latest === null || at > latest) {
      latest = at;
    }
  }
  return latest;
}

/** The strip's run: the newest one that finished in the last 24 h. */
export function importStripRun(
  runs: readonly DiscoveryRunRecord[] | undefined,
  nowMs: number
): DiscoveryRunRecord | null {
  let best: DiscoveryRunRecord | null = null;
  for (const run of runs ?? []) {
    if (run.status === "running" || run.finished_at === null) {
      continue;
    }
    if (nowMs - run.finished_at > DAY_MS) {
      continue;
    }
    if (!best || run.finished_at > (best.finished_at ?? 0)) {
      best = run;
    }
  }
  return best;
}

/** Error classes that stop a source for the run (15 §8): "blocked". */
const BLOCKING_CLASSES: ReadonlySet<DiscoveryErrorClass> = new Set([
  "access_denied",
  "challenge_detected",
  "rate_limited",
  "source_closed",
  "source_unavailable",
  "schema_invalid",
  "unsupported_content",
  "policy_blocked",
]);

export interface BlockedSource {
  errorClass: DiscoveryErrorClass;
  label: string;
}

/** One entry per stopped source: "Workday: access denied". */
export function blockedSources(run: DiscoveryRunRecord): BlockedSource[] {
  const seen = new Set<string>();
  const out: BlockedSource[] = [];
  for (const error of run.errors) {
    if (!BLOCKING_CLASSES.has(error.error_class)) {
      continue;
    }
    const named = error.source_id
      ? run.sources.find((source) => source.source_id === error.source_id)
      : undefined;
    const label = named?.label ?? error.source ?? error.source_id ?? "";
    const key = error.source_id ?? error.source ?? label;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ label, errorClass: error.error_class });
  }
  return out;
}

export interface Provenance {
  adapter: string | null;
  adapterVersion: string | null;
  confidence: number | null;
  fetchMode: string | null;
  method: string | null;
  runId: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unit(value: unknown): number | null {
  return typeof value === "number" && value >= 0 && value <= 1 ? value : null;
}

/** The provenance fields of `job_postings.extraction` (may be `{}`). */
export function provenanceOf(posting: JobPostingRecord): Provenance {
  const extraction = posting.extraction as Record<string, unknown>;
  return {
    adapter: text(extraction.adapter),
    adapterVersion: text(extraction.adapter_version),
    fetchMode: text(extraction.fetch_mode),
    method: text(extraction.method),
    confidence: unit(extraction.confidence),
    runId: text(extraction.run_id),
  };
}

export interface AlternateListing {
  adapter: string;
  fetchMode: string | null;
  observedAt: number | null;
  /** The listing or detail URL the other source used, if any. */
  url: string | null;
}

const MAX_ALTERNATES = 20;

/**
 * Other sources that produced the same fingerprint (`extraction.alternates`,
 * written by the api). The column is a loose JSON object, so every field is
 * checked; malformed entries are skipped.
 */
export function alternateListings(
  posting: JobPostingRecord
): AlternateListing[] {
  const raw = (posting.extraction as Record<string, unknown>).alternates;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AlternateListing[] = [];
  for (const entry of raw.slice(0, MAX_ALTERNATES)) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const adapter = text(record.adapter);
    if (!adapter) {
      continue;
    }
    const urls =
      typeof record.source_urls === "object" && record.source_urls !== null
        ? (record.source_urls as Record<string, unknown>)
        : {};
    out.push({
      adapter,
      fetchMode: text(record.fetch_mode),
      observedAt:
        typeof record.observed_at === "number" ? record.observed_at : null,
      url: text(urls.detail) ?? text(urls.listing),
    });
  }
  return out;
}

/**
 * How many listings this row stands for: itself, the other sources with the
 * same fingerprint and the other postings of its dedupe group.
 */
export function listingCount(item: InboxItem): number {
  return 1 + alternateListings(item.posting).length + item.duplicates;
}

/** A tracked job lives on as its application (12 §5): where to go, or null. */
export function trackedJobRedirect(detail: {
  application: { id: string } | null;
}): string | null {
  return detail.application
    ? `/applications/${encodeURIComponent(detail.application.id)}`
    : null;
}
