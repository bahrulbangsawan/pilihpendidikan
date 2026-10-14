// Queueing cloud work (24 §6.1): every scrape, probe and directory refresh is
// a `cloud_runs` row (`queued`) plus one `jobs-scrape` message. The row is
// written first; a failed send marks it `failed` so nothing stays queued
// forever. Scheduled scrapes also move `next_run_at` forward in the same
// batch, so overlapping cron ticks never enqueue a source twice.

import type { CloudQueueMessage } from "@pilihpendidikan/jobs-contracts/cloud";
import type { CloudRunTrigger } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  CloudRunRecord,
  CloudSourceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type { Env } from "../../../env";
import type { JobsDb } from "../../repo/core/db";
import { runCloudBatch } from "../../repo/cloud/postings";
import {
  applyCloudRunUpdate,
  insertCloudRunStatement,
} from "../../repo/cloud/runs";
import {
  listDueSources,
  systemUpdateStatement,
} from "../../repo/cloud/sources";

/** Sources enqueued per hourly tick at most (24 §6.1). */
export const DISPATCH_LIMIT = 50;

type QueueEnv = Pick<Env, "JOBS_SCRAPE_QUEUE">;

export class CloudQueueUnavailableError extends Error {
  constructor() {
    super("The jobs-scrape queue is not bound.");
    this.name = "CloudQueueUnavailableError";
  }
}

export function newRun(
  kind: CloudRunRecord["kind"],
  trigger: CloudRunTrigger,
  sourceId: string | null,
  now: number,
  options: {
    requestedBy?: string | null;
    strategy?: CloudRunRecord["strategy"];
  } = {}
): CloudRunRecord {
  return {
    id: newId("crn", now),
    source_id: sourceId,
    kind,
    trigger,
    status: "queued",
    attempt: 1,
    requested_by: options.requestedBy ?? null,
    queued_at: now,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    strategy: options.strategy ?? null,
    stats: {},
    error_class: null,
    error_message: null,
    http_status: null,
    warnings: [],
    log: [],
    engine_version: null,
    updated_at: now,
  };
}

function messageFor(run: CloudRunRecord): CloudQueueMessage {
  if (run.kind === "directory") {
    return { type: "refresh_directory", v: 1, run_id: run.id };
  }
  if (run.kind === "probe") {
    return {
      type: "probe_source",
      v: 1,
      run_id: run.id,
      source_id: run.source_id as string,
    };
  }
  return {
    type: "scrape_source",
    v: 1,
    run_id: run.id,
    source_id: run.source_id as string,
    trigger: run.trigger,
  };
}

async function failUnsent(
  db: JobsDb,
  runs: readonly CloudRunRecord[],
  now: number
): Promise<void> {
  for (const run of runs) {
    await applyCloudRunUpdate(
      db,
      run.id,
      {
        status: "failed",
        finished_at: now,
        error_class: "engine_unavailable",
        error_message:
          "The run could not be queued; it will be picked up by the next hourly tick.",
      },
      now,
      ["queued"]
    );
  }
}

/** Stores runs (+ extra statements) then sends their messages (≤ 100 per send). */
export async function queueRuns(
  env: QueueEnv,
  db: JobsDb,
  runs: readonly CloudRunRecord[],
  now: number,
  extra: readonly D1PreparedStatement[] = []
): Promise<void> {
  if (runs.length === 0) {
    return;
  }
  if (!env.JOBS_SCRAPE_QUEUE) {
    throw new CloudQueueUnavailableError();
  }
  await runCloudBatch(db, [
    ...runs.map((run) => insertCloudRunStatement(db, run)),
    ...extra,
  ]);
  for (let i = 0; i < runs.length; i += 100) {
    const group = runs.slice(i, i + 100);
    try {
      await env.JOBS_SCRAPE_QUEUE.sendBatch(
        group.map((run) => ({ body: messageFor(run) }))
      );
    } catch (err) {
      await failUnsent(db, group, now);
      throw err;
    }
  }
}

/** One manual / retry scrape of a source. */
export async function queueScrape(
  env: QueueEnv,
  db: JobsDb,
  source: CloudSourceRecord,
  trigger: CloudRunTrigger,
  now: number,
  requestedBy: string | null,
  extra: readonly D1PreparedStatement[] = []
): Promise<CloudRunRecord> {
  const run = newRun("scrape", trigger, source.id, now, {
    requestedBy,
    strategy: source.strategy,
  });
  await queueRuns(env, db, [run], now, extra);
  return run;
}

export async function queueProbe(
  env: QueueEnv,
  db: JobsDb,
  sourceId: string,
  trigger: CloudRunTrigger,
  now: number,
  requestedBy: string | null
): Promise<CloudRunRecord> {
  const run = newRun("probe", trigger, sourceId, now, { requestedBy });
  await queueRuns(env, db, [run], now);
  return run;
}

export async function queueDirectoryRefresh(
  env: QueueEnv,
  db: JobsDb,
  trigger: CloudRunTrigger,
  now: number,
  requestedBy: string | null
): Promise<CloudRunRecord> {
  const run = newRun("directory", trigger, null, now, { requestedBy });
  await queueRuns(env, db, [run], now);
  return run;
}

/** The hourly tick: due sources → queued runs, schedule moved forward. */
export async function dispatchDueSources(
  env: QueueEnv,
  db: JobsDb,
  now: number,
  limit = DISPATCH_LIMIT
): Promise<CloudRunRecord[]> {
  const due = await listDueSources(db, now, limit);
  const runs = due.map((source) =>
    newRun("scrape", "schedule", source.id, now, { strategy: source.strategy })
  );
  const schedule = due.map((source) =>
    systemUpdateStatement(
      db,
      source.id,
      { next_run_at: now + source.interval_minutes * 60_000 },
      now
    )
  );
  await queueRuns(env, db, runs, now, schedule);
  return runs;
}
