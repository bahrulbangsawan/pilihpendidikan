// The `jobs-scrape` queue consumer (24 §6, D-38). The Worker's `queue`
// export (src/app.ts) routes batches of `jobs-scrape` / `jobs-scrape-dlq`
// here and everything else to the `jobs-ai` consumer.
//
// Per message: validate against `CloudQueueMessageSchema` (a poison message
// is logged and acked), dispatch by `type`, apply the handler's outcome. A
// thrown error retries with the platform's backoff; after `max_retries: 3`
// the message reaches `jobs-scrape-dlq`, whose handler closes the run and
// releases the source's lease so one failing site never blocks the others.

import type { CloudQueueMessage } from "@pilihpendidikan/jobs-contracts/cloud";
import { CloudQueueMessageSchema } from "@pilihpendidikan/jobs-contracts/cloud";
import type { Env } from "../../env";
import { getAiProvider } from "../ai/provider";
import { systemClock } from "../core/clock";
import type { KernelDeps } from "../core/deps";
import { getFeatureFlags } from "../core/flags";
import { jobsDb } from "../repo/core/db";
import { applyCloudRunUpdate } from "../repo/cloud/runs";
import { applySystemUpdate } from "../repo/cloud/sources";
import { handleDirectoryRefresh } from "./directory";
import { handleProbe, handleScrape } from "./runner";
import type { CloudContext, CloudOutcome } from "./types";
import { CLOUD_ACK } from "./types";

export const JOBS_SCRAPE_QUEUE = "jobs-scrape";
export const JOBS_SCRAPE_DLQ = "jobs-scrape-dlq";

/** True for batches this consumer owns. */
export function isCloudQueue(queue: string): boolean {
  return queue === JOBS_SCRAPE_QUEUE || queue === JOBS_SCRAPE_DLQ;
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evt: event, ...fields }));
}

function dispatch(qc: CloudContext): Promise<CloudOutcome> {
  const message = qc.message;
  switch (message.type) {
    case "scrape_source":
      return handleScrape(qc as CloudContext<typeof message>);
    case "probe_source":
      return handleProbe(qc as CloudContext<typeof message>);
    case "refresh_directory":
      return handleDirectoryRefresh(qc as CloudContext<typeof message>);
    default:
      return Promise.resolve(CLOUD_ACK);
  }
}

/** DLQ: the run failed for good; close it and free the source. */
async function deadLetter(qc: CloudContext): Promise<CloudOutcome> {
  const now = qc.now();
  await applyCloudRunUpdate(
    qc.db,
    qc.message.run_id,
    {
      status: "failed",
      finished_at: now,
      error_class: "engine_unavailable",
      error_message:
        "The run failed repeatedly inside the pipeline and was abandoned; the next scheduled run starts fresh from the last checkpoint.",
    },
    now,
    ["queued", "running"]
  );
  if ("source_id" in qc.message) {
    await applySystemUpdate(
      qc.db,
      qc.message.source_id,
      { lease_id: null, lease_expires_at: null, last_run_status: "failed" },
      now,
      { leaseId: qc.message.run_id }
    );
  }
  qc.log("cloud_dead_letter", {
    run_id: qc.message.run_id,
    type: qc.message.type,
  });
  return CLOUD_ACK;
}

export interface CloudBatchReport {
  acked: number;
  dropped: number;
  retried: number;
}

/** Processes one `jobs-scrape` / `jobs-scrape-dlq` batch. */
export async function handleCloudBatch(
  batch: MessageBatch<unknown>,
  env: Env,
  ctx: ExecutionContext,
  deps: KernelDeps = {}
): Promise<CloudBatchReport> {
  const report: CloudBatchReport = { acked: 0, retried: 0, dropped: 0 };
  const clock = deps.clock ?? systemClock;
  const db = jobsDb(env);
  const flags = await getFeatureFlags(env, clock.now());
  const isDlq = batch.queue === JOBS_SCRAPE_DLQ;
  for (const message of batch.messages) {
    const parsed = CloudQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      log("cloud_queue_invalid_message", {
        queue: batch.queue,
        id: message.id,
      });
      message.ack();
      report.dropped += 1;
      continue;
    }
    const body: CloudQueueMessage = parsed.data;
    const qc: CloudContext = {
      env,
      ctx,
      db,
      flags,
      message: body,
      attempts: message.attempts,
      now: () => clock.now(),
      random: Math.random,
      ai: () => deps.ai?.(env) ?? getAiProvider(env),
      log: (event, fields = {}) =>
        log(event, { queue: batch.queue, run_id: body.run_id, ...fields }),
    };
    try {
      const outcome = isDlq ? await deadLetter(qc) : await dispatch(qc);
      if (outcome.action === "retry") {
        message.retry({ delaySeconds: outcome.delaySeconds });
        report.retried += 1;
      } else {
        message.ack();
        report.acked += 1;
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          evt: "cloud_queue_handler_failed",
          queue: batch.queue,
          type: body.type,
          run_id: body.run_id,
          attempts: message.attempts,
          error:
            err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
      );
      message.retry({
        delaySeconds: Math.min(
          900,
          60 * 2 ** Math.max(0, message.attempts - 1)
        ),
      });
      report.retried += 1;
    }
  }
  return report;
}
