// Owner: leaf-2.9 — `rollup_user` messages (14 §6, 10 §4): recompute the
// given local days of one user from the events and upsert them. A pure
// function of the events, so a redelivered message writes the same rows; AI
// spend in the rows is kept. A user without data (e.g. purged) gets nothing
// written back.
import { rollupUserDays } from "../../services/analytics/rollup";
import type { QueueHandler } from "../types";
import { ACK } from "../types";

export const handleRollupUser: QueueHandler<"rollup_user"> = async (qc) => {
  const result = await rollupUserDays(qc.db, qc.scope, {
    days: qc.message.days,
    now: qc.now,
  });
  qc.log("analytics_rollup", {
    days: qc.message.days.length,
    written: result.written.length,
    cleared: result.cleared.length,
  });
  return ACK;
};
