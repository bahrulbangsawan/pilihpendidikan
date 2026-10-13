// Owner: leaf-2.1 — the existing daily purge of `request_log` rows past their
// retention window (LOG_RETENTION_DAYS, src/request-log.ts).
import { purgeExpiredLogs } from "../../../request-log";
import type { CronHandler } from "../types";

export const purgeRequestLog: CronHandler = async (cc) => {
  const deleted = await purgeExpiredLogs(cc.env.DB);
  if (deleted > 0) {
    cc.log("request_log_purge", { deleted });
  }
};
