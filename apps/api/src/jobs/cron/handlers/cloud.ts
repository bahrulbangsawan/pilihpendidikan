// Cloud discovery cron jobs (24 §6.1, §6.4):
//
//   "0 * * * *"    cloud-dispatch: sync the seed catalog, enqueue every due
//                  source (one `jobs-scrape` message each, never a scrape in
//                  the cron itself), a weekly directory refresh, and the 90 d
//                  run retention. Off while JOBS_CLOUD_DISCOVERY_ENABLED is.
//   "*/5 * * * *"  cloud-reaper: clear leases past their expiry and fail runs
//                  stuck in queued / running, so the next tick resumes from
//                  the stored checkpoint.

import { getFeatureFlags } from "../../core/flags";
import {
  deleteRunsBefore,
  failStaleRuns,
  liveDirectoryRun,
} from "../../repo/cloud/runs";
import { reapExpiredLeases } from "../../repo/cloud/sources";
import { getState, STATE_KEYS } from "../../repo/cloud/state";
import {
  dispatchDueSources,
  queueDirectoryRefresh,
} from "../../services/cloud/dispatch";
import { ensureCatalogSeeded } from "../../services/cloud/seed";
import type { CronHandler } from "../types";

const DAY = 86_400_000;
/** Directory refresh cadence (24 §7). */
export const DIRECTORY_REFRESH_MS = 7 * DAY;
export const RUN_RETENTION_MS = 90 * DAY;
/** A run not updated for this long is considered dead. */
export const STALE_RUN_MS = 30 * 60_000;

export const runCloudDispatchCron: CronHandler = async (cc) => {
  const flags = await getFeatureFlags(cc.env, cc.now);
  if (!flags.JOBS_CLOUD_DISCOVERY_ENABLED) {
    cc.log("cloud_dispatch_off");
    return;
  }
  if (!cc.env.JOBS_SCRAPE_QUEUE) {
    cc.log("cloud_dispatch_no_queue");
    return;
  }
  const seed = await ensureCatalogSeeded(cc.db, cc.now);
  const runs = await dispatchDueSources(cc.env, cc.db, cc.now);
  let directory = false;
  const refreshed = Number(
    (await getState(cc.db, STATE_KEYS.directoryRefreshedAt)) ?? 0
  );
  if (
    cc.now - refreshed >= DIRECTORY_REFRESH_MS &&
    !(await liveDirectoryRun(cc.db))
  ) {
    await queueDirectoryRefresh(cc.env, cc.db, "schedule", cc.now, null);
    directory = true;
  }
  const purged = await deleteRunsBefore(cc.db, cc.now - RUN_RETENTION_MS, 1000);
  cc.log("cloud_dispatch_done", {
    queued: runs.length,
    seed_inserted: seed.inserted,
    seed_updated: seed.updated,
    directory_refresh: directory,
    runs_purged: purged,
  });
};

export const runCloudReaperCron: CronHandler = async (cc) => {
  const leases = await reapExpiredLeases(cc.db, cc.now, 200);
  const stale = await failStaleRuns(cc.db, cc.now - STALE_RUN_MS, cc.now, 200);
  if (leases.length > 0 || stale.length > 0) {
    cc.log("cloud_reaper_done", {
      leases: leases.length,
      runs_failed: stale.length,
    });
  }
};
