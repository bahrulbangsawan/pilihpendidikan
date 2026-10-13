// Owner: leaf-2.9 — `rebuild_analytics` messages (14 §6, 10 §5): after a
// timezone change, delete and recompute the user's `analytics_daily` rows
// from the events in the new zone (AI spend per day is kept). A replay
// recomputes the same values.
import { rebuildUserAnalytics } from "../../services/analytics/rollup";
import type { QueueHandler } from "../types";
import { ACK } from "../types";

export const handleRebuildAnalytics: QueueHandler<"rebuild_analytics"> = async (
  qc
) => {
  const result = await rebuildUserAnalytics(qc.db, qc.scope, { now: qc.now });
  qc.log("analytics_rebuild", {
    reason: qc.message.reason,
    days: result.written.length,
  });
  return ACK;
};
