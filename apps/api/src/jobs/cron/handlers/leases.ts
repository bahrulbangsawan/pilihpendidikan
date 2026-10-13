// Owner: leaf-2.7 — the `*/5 * * * *` automation job (21 §7.1, §15; 14 §7):
// expired leases (outcome_unknown after submit_intent, never re-queued —
// D-19), released approval waits, approval expiry (task cancelled), queued
// task expiry, pending cancels of queued tasks, and the alert checks
// (outcome_unknown bursts, submission bursts, lease-loss bursts), all
// chunked and resumable. Logs one `lease_reaper` line with the counts.

import { runReaper } from "../../services/automation/reaper";
import type { CronHandler } from "../types";

export const runLeaseCron: CronHandler = async (cc) => {
  const report = await runReaper(cc.db, cc.now);
  cc.log("lease_cron_done", {
    expired_leases: report.expiredLeases,
    requeued: report.requeued,
    outcome_unknown: report.outcomeUnknown,
    approvals_expired: report.approvalsExpired,
    tasks_expired: report.tasksExpired,
  });
};
