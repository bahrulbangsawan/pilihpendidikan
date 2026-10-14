// Types shared by the `jobs-scrape` consumer (consumer.ts) and its handlers
// (runner.ts, directory.ts).

import type { CloudQueueMessage } from "@pilihpendidikan/jobs-contracts/cloud";
import type { CloudLogEntry } from "@pilihpendidikan/jobs-contracts/cloud-config";
import type { Env } from "../../env";
import type { AiProvider } from "../ai/provider";
import type { FeatureFlags } from "../core/flags";
import type { JobsDb } from "../repo/core/db";

export interface CloudContext<M extends CloudQueueMessage = CloudQueueMessage> {
  ai(): AiProvider;
  /** Delivery attempt, 1-based (Workers `message.attempts`). */
  readonly attempts: number;
  readonly ctx: ExecutionContext;
  readonly db: JobsDb;
  readonly env: Env;
  readonly flags: FeatureFlags;
  /** Structured log line (ids and counts only, never page text). */
  log(event: string, fields?: Record<string, unknown>): void;
  readonly message: M;
  /** Clock read per call (a scrape takes minutes). */
  now(): number;
  /** Jitter source (tests pin it). */
  random(): number;
}

export type CloudOutcome =
  | { action: "ack" }
  | { action: "retry"; delaySeconds: number };

export const CLOUD_ACK: CloudOutcome = Object.freeze({ action: "ack" });

/** An api-side line for a run's log. */
export function logLine(
  now: number,
  level: CloudLogEntry["level"],
  event: string,
  message: string,
  extra: Partial<Pick<CloudLogEntry, "http_status" | "ms" | "url">> = {}
): CloudLogEntry {
  return {
    at: now,
    level,
    event: event.slice(0, 64),
    message: message.slice(0, 500),
    ...extra,
  };
}
