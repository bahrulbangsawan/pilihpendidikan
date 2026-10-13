// Types shared by the cron dispatcher (index.ts) and its handlers.

import type { Env } from "../../env";
import type { JobsDb } from "../repo/core/db";

export interface CronContext {
  /** The schedule that fired, e.g. "*\/5 * * * *". */
  readonly cron: string;
  readonly ctx: ExecutionContext;
  /** JOBS_DB handle for repo functions (system statements carry `sql-allow`). */
  readonly db: JobsDb;
  readonly env: Env;
  /** Structured log line (counts and ids only). */
  log(event: string, fields?: Record<string, unknown>): void;
  /** One clock read for the whole run. */
  readonly now: number;
}

/** One cron job. Chunk work (≤ 5,000 rows per batch) and stay resumable (14 §7). */
export type CronHandler = (cc: CronContext) => Promise<void>;
