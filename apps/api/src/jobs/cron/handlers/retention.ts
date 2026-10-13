// Owner: leaf-2.8 — 14 §7 daily: idempotency purge, change_log trim,
// posting/user_job/run-item retention, telemetry and crash-report retention,
// export cleanup, account hard deletes, capacity check
// (services/sync/retention.ts).
import { runRetention } from "../../services/sync/retention";
import type { CronHandler } from "../types";

export const runRetentionCron: CronHandler = async (cc) => {
  await runRetention(cc);
};
