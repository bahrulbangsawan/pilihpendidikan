// Owner: leaf-2.9 — the daily analytics rollup (14 §7, 10 §4): enqueue one
// `rollup_user` message per user with activity in the last 48 h (yesterday +
// today in the user's timezone); the jobs-ai consumer recomputes the rows.
import { enqueueDailyRollups } from "../../services/analytics/cron";
import type { CronHandler } from "../types";

export const runAnalyticsCron: CronHandler = async (cc) => {
  const report = await enqueueDailyRollups({
    db: cc.db,
    env: cc.env,
    now: cc.now,
  });
  cc.log("analytics_cron_done", {
    users: report.users,
    messages: report.messages,
  });
};
