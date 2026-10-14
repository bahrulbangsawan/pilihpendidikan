// The Worker's `scheduled` handler (14 §7): dispatches by `controller.cron`.
//
//   "*/5 * * * *"  leases (leaf-2.7), cloud-reaper (24 §6.4)
//   "0 * * * *"    cloud-dispatch (24 §6.1)
//   "0 3 * * *"    request-log purge (existing), retention (leaf-2.8),
//                  file retention (leaf-2.6), analytics rollup (leaf-2.9)
//
// Jobs of one schedule run one after another; a failing job is logged and
// does not stop the others. A trigger with no `cron` (older test harnesses)
// runs the daily set, which is what the single pre-jobs cron did.

import type { Env } from "../../env";
import { systemClock } from "../core/clock";
import type { KernelDeps } from "../core/deps";
import { jobsDb } from "../repo/core/db";
import { runAnalyticsCron } from "./handlers/analytics";
import { runCloudDispatchCron, runCloudReaperCron } from "./handlers/cloud";
import { runFileRetentionCron } from "./handlers/file-retention";
import { runLeaseCron } from "./handlers/leases";
import { purgeRequestLog } from "./handlers/request-log";
import { runRetentionCron } from "./handlers/retention";
import type { CronContext, CronHandler } from "./types";

export const CRON_EVERY_FIVE_MINUTES = "*/5 * * * *";
export const CRON_DAILY = "0 3 * * *";
export const CRON_HOURLY = "0 * * * *";

export interface CronJob {
  handler: CronHandler;
  name: string;
}

/** Jobs per schedule (the triggers of wrangler.jsonc). */
export const CRON_JOBS: Readonly<Record<string, readonly CronJob[]>> = {
  [CRON_EVERY_FIVE_MINUTES]: [
    { name: "leases", handler: runLeaseCron },
    { name: "cloud-reaper", handler: runCloudReaperCron },
  ],
  [CRON_HOURLY]: [{ name: "cloud-dispatch", handler: runCloudDispatchCron }],
  [CRON_DAILY]: [
    { name: "request-log", handler: purgeRequestLog },
    { name: "retention", handler: runRetentionCron },
    { name: "file-retention", handler: runFileRetentionCron },
    { name: "analytics", handler: runAnalyticsCron },
  ],
};

export interface CronRunReport {
  cron: string;
  failed: string[];
  ran: string[];
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evt: event, ...fields }));
}

/** Runs every job registered for the controller's schedule. */
export async function runScheduled(
  controller: Pick<ScheduledController, "cron"> | undefined,
  env: Env,
  ctx: ExecutionContext,
  deps: KernelDeps = {}
): Promise<CronRunReport> {
  const cron = controller?.cron || CRON_DAILY;
  const jobs = CRON_JOBS[cron];
  const report: CronRunReport = { cron, ran: [], failed: [] };
  if (!jobs) {
    log("cron_unknown_schedule", { cron });
    return report;
  }
  const now = (deps.clock ?? systemClock).now();
  for (const job of jobs) {
    const cc: CronContext = {
      env,
      ctx,
      db: jobsDb(env),
      cron,
      now,
      log: (event, fields = {}) => log(event, { job: job.name, ...fields }),
    };
    try {
      await job.handler(cc);
      report.ran.push(job.name);
    } catch (err) {
      report.failed.push(job.name);
      console.error({
        evt: "cron_job_failed",
        cron,
        job: job.name,
        error:
          err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  }
  return report;
}
