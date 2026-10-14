// `refresh_directory` handler (24 §7): re-read the directory page
// (`cloud-sources.json` › `directory`) and register platforms it lists that
// the catalog does not know yet.
//
//   - entries are matched by slug (registrable domain of the entry URL) and
//     by canonical domain, so a known board is never registered twice;
//   - a known entry only gets its directory anchor / name / description
//     refreshed, never fields an operator edited, and never `enabled`;
//   - the directory's own host is skipped (it lists boards, it is not one);
//   - each new entry starts disabled (`UNSUPPORTED`, "probing…") and gets a
//     probe run that classifies it (classify.ts); at most 20 per refresh.

import { SCRAPER_PROTOCOL_VERSION } from "@pilihpendidikan/jobs-contracts/cloud";
import type {
  CloudQueueMessage,
  DirectoryResponse,
} from "@pilihpendidikan/jobs-contracts/cloud";
import type { CloudLogEntry } from "@pilihpendidikan/jobs-contracts/cloud-config";
import { CLOUD_SOURCES_FILE } from "@pilihpendidikan/jobs-contracts/cloud-sources";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  CloudRunRecord,
  CloudSourceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { runCloudBatch } from "../repo/cloud/postings";
import {
  applyCloudRunUpdate,
  getCloudRun,
  updateCloudRunStatement,
} from "../repo/cloud/runs";
import {
  insertCloudSourceStatement,
  listCloudSources,
  systemUpdateStatement,
} from "../repo/cloud/sources";
import { STATE_KEYS, setStateStatement } from "../repo/cloud/state";
import { newRun, queueRuns } from "../services/cloud/dispatch";
import {
  MAX_DELIVERIES,
  PROBE_DEADLINE_MS,
  retryDelaySeconds,
} from "../services/cloud/health";
import {
  readDirectory,
  ScraperUnavailableError,
} from "../services/cloud/scraper-client";
import { ensureCatalogSeeded } from "../services/cloud/seed";
import { validateCloudUrl } from "../services/cloud/url";
import type { CloudContext, CloudOutcome } from "./types";
import { CLOUD_ACK, logLine } from "./types";

type DirectoryMessage = Extract<
  CloudQueueMessage,
  { type: "refresh_directory" }
>;

/** New platforms probed per refresh at most. */
export const MAX_NEW_PER_REFRESH = 20;

function newDirectorySource(
  entry: {
    anchor: string | null;
    description: string | null;
    name: string;
    url: string;
  },
  checked: { domain: string; url: string },
  now: number
): CloudSourceRecord {
  return {
    id: newId("csr", now),
    slug: checked.domain,
    name: entry.name.slice(0, 200),
    homepage_url: checked.url,
    listing_url: null,
    canonical_domain: checked.domain,
    category: "unknown",
    origin: "directory",
    directory_ref: entry.anchor,
    description: entry.description?.slice(0, 500) ?? null,
    strategy: "none",
    strategy_config: {},
    health: "UNSUPPORTED",
    status_reason:
      "Newly listed on the directory; a probe run is classifying it.",
    enabled: false,
    priority: 40,
    interval_minutes: 360,
    rate_limit: {},
    auth_required: false,
    auth_note: null,
    terms_url: null,
    terms_note: null,
    ai_enabled: false,
    allow_browser: false,
    next_run_at: null,
    lease_id: null,
    lease_expires_at: null,
    last_run_id: null,
    last_run_status: null,
    last_run_at: null,
    last_success_at: null,
    last_error_class: null,
    last_error_message: null,
    consecutive_failures: 0,
    circuit_open_until: null,
    cursor_state: {},
    stats: {},
    user_modified: [],
    revision: 1,
    created_at: now,
    updated_at: now,
  };
}

type DirectoryEntry = DirectoryResponse["entries"][number];
const LIVE_STATUSES: CloudRunRecord["status"][] = ["queued", "running"];

/** Directory fields a refresh may update on a known source. */
export function knownEntryPatch(
  known: CloudSourceRecord,
  entry: DirectoryEntry
): Partial<CloudSourceRecord> {
  const locked = new Set(known.user_modified);
  const patch: Partial<CloudSourceRecord> = {};
  if (
    entry.anchor &&
    known.directory_ref !== entry.anchor &&
    !locked.has("directory_ref")
  ) {
    patch.directory_ref = entry.anchor;
  }
  if (
    entry.description &&
    known.description !== entry.description &&
    !locked.has("description")
  ) {
    patch.description = entry.description.slice(0, 500);
  }
  return patch;
}

interface EntryPlan {
  created: CloudSourceRecord[];
  log: CloudLogEntry[];
  refreshed: number;
  skipped: number;
  statements: D1PreparedStatement[];
}

/** What a refresh writes: new sources, refreshed known ones, skips. */
function planEntries(
  qc: CloudContext,
  entries: readonly DirectoryEntry[],
  catalog: readonly CloudSourceRecord[],
  directoryDomain: string | null,
  now: number
): EntryPlan {
  const bySlug = new Map(catalog.map((s) => [s.slug, s]));
  const byDomain = new Map(catalog.map((s) => [s.canonical_domain, s]));
  const plan: EntryPlan = {
    created: [],
    log: [],
    refreshed: 0,
    skipped: 0,
    statements: [],
  };
  for (const entry of entries) {
    const checked = validateCloudUrl(entry.url);
    if (!checked.ok || checked.domain === directoryDomain) {
      plan.skipped += 1;
      if (!checked.ok) {
        plan.log.push(
          logLine(
            now,
            "info",
            "entry_skipped",
            `${entry.name}: ${checked.problem}`,
            {
              url: entry.url,
            }
          )
        );
      }
      continue;
    }
    const known = bySlug.get(checked.domain) ?? byDomain.get(checked.domain);
    if (known) {
      const patch = knownEntryPatch(known, entry);
      if (Object.keys(patch).length > 0) {
        plan.statements.push(
          systemUpdateStatement(qc.db, known.id, patch, now)
        );
        plan.refreshed += 1;
      }
      continue;
    }
    if (plan.created.length >= MAX_NEW_PER_REFRESH) {
      plan.skipped += 1;
      continue;
    }
    const source = newDirectorySource(entry, checked, now);
    plan.created.push(source);
    bySlug.set(source.slug, source);
    plan.statements.push(insertCloudSourceStatement(qc.db, source));
    plan.log.push(
      logLine(
        now,
        "info",
        "registered",
        `New platform ${entry.name} (${checked.domain}); probing it.`,
        { url: checked.url }
      )
    );
  }
  return plan;
}

/** Reads the directory; a retry outcome or a closed run on failure. */
async function readOrRetry(
  qc: CloudContext,
  run: CloudRunRecord
): Promise<DirectoryResponse | CloudOutcome> {
  try {
    return await readDirectory(
      qc.env,
      { v: SCRAPER_PROTOCOL_VERSION, directory: CLOUD_SOURCES_FILE.directory },
      PROBE_DEADLINE_MS
    );
  } catch (err) {
    const message =
      err instanceof ScraperUnavailableError
        ? err.message
        : "The scraper call failed.";
    const now = qc.now();
    if (qc.attempts < MAX_DELIVERIES) {
      await applyCloudRunUpdate(
        qc.db,
        run.id,
        { status: "queued", attempt: qc.attempts + 1, error_message: message },
        now,
        LIVE_STATUSES
      );
      return {
        action: "retry",
        delaySeconds: retryDelaySeconds(qc.attempts, qc.random),
      };
    }
    await applyCloudRunUpdate(
      qc.db,
      run.id,
      {
        status: "failed",
        finished_at: now,
        error_class: "engine_unavailable",
        error_message: message,
      },
      now,
      LIVE_STATUSES
    );
    return CLOUD_ACK;
  }
}

export async function handleDirectoryRefresh(
  qc: CloudContext<DirectoryMessage>
): Promise<CloudOutcome> {
  const run = await getCloudRun(qc.db, qc.message.run_id);
  if (!(run && LIVE_STATUSES.includes(run.status))) {
    return CLOUD_ACK;
  }
  const startedAt = qc.now();
  await applyCloudRunUpdate(
    qc.db,
    run.id,
    { status: "running", started_at: startedAt, attempt: qc.attempts },
    startedAt,
    LIVE_STATUSES
  );
  await ensureCatalogSeeded(qc.db, startedAt);
  const response = await readOrRetry(qc, run);
  if ("action" in response) {
    return response;
  }
  const now = qc.now();
  if (response.error) {
    await applyCloudRunUpdate(
      qc.db,
      run.id,
      {
        status: "failed",
        finished_at: now,
        duration_ms: now - startedAt,
        error_class: response.error.error_class,
        error_message: response.error.message.slice(0, 500),
        http_status: response.http_status,
        log: response.log.slice(-100),
      },
      now,
      LIVE_STATUSES
    );
    return CLOUD_ACK;
  }
  const directoryHost = validateCloudUrl(CLOUD_SOURCES_FILE.directory.url);
  const plan = planEntries(
    qc,
    response.entries,
    await listCloudSources(qc.db),
    directoryHost.ok ? directoryHost.domain : null,
    now
  );
  const summary = `${response.entries.length} entries: ${plan.created.length} new, ${plan.refreshed} refreshed, ${plan.skipped} skipped`;
  await runCloudBatch(qc.db, [
    ...plan.statements,
    setStateStatement(qc.db, STATE_KEYS.directoryRefreshedAt, String(now), now),
    updateCloudRunStatement(
      qc.db,
      run.id,
      {
        status: "succeeded",
        finished_at: now,
        duration_ms: now - startedAt,
        http_status: response.http_status,
        stats: {
          entries: response.entries.length,
          registered: plan.created.length,
          pages: 1,
        },
        log: [
          ...response.log,
          ...plan.log,
          logLine(now, "info", "finished", summary),
        ].slice(-100),
        engine_version: `pilih-scraper ${response.engine.scraper}`,
      },
      now,
      LIVE_STATUSES
    ),
  ]);
  if (plan.created.length > 0) {
    await queueRuns(
      qc.env,
      qc.db,
      plan.created.map((source) => newRun("probe", "schedule", source.id, now)),
      now
    );
  }
  qc.log("cloud_directory_refreshed", {
    run_id: run.id,
    entries: response.entries.length,
    registered: plan.created.length,
  });
  return CLOUD_ACK;
}
