// The CV safety net (08 §4.1 step 8, 14 §6), run by the daily file-retention
// cron and safe on any schedule:
//   - tailored variants still without a PDF 2 min after tailoring and without
//     a render task get their `render_cv` task (when the delayed check message
//     was lost);
//   - variants `generating` for over an hour without a tailored document get
//     their `tailor_cv` message again (a lost send; the consumer is
//     idempotent per variant).

import type { CronContext } from "../../cron/types";
import { HOUR_MS } from "../../core/clock";
import { trustedScope } from "../../core/scope";
import {
  listRenderFallbackCandidates,
  listStalledTailoring,
} from "../../repo/cv";
import {
  ensureRenderFallbackTask,
  RENDER_FALLBACK_DELAY_MS,
  tailorCvMessage,
} from "./variants";

/** Rows per sweep (chunked, resumable: the next run continues). */
export const SWEEP_LIMIT = 500;
const SEND_BATCH = 100;
const STALLED_AFTER_MS = HOUR_MS;

export interface CvSweepReport {
  renderTasks: number;
  requeued: number;
}

export async function sweepCvVariants(cc: CronContext): Promise<CvSweepReport> {
  const report: CvSweepReport = { renderTasks: 0, requeued: 0 };
  const unrendered = await listRenderFallbackCandidates(cc.db, {
    before: cc.now - RENDER_FALLBACK_DELAY_MS,
    limit: SWEEP_LIMIT,
  });
  for (const variant of unrendered) {
    const created = await ensureRenderFallbackTask(
      cc.db,
      trustedScope(variant.user_id, "cron"),
      { cvvId: variant.id, applicationId: variant.application_id, now: cc.now }
    );
    if (created) {
      report.renderTasks += 1;
    }
  }
  const stalled = await listStalledTailoring(cc.db, {
    before: cc.now - STALLED_AFTER_MS,
    limit: SWEEP_LIMIT,
  });
  for (let i = 0; i < stalled.length; i += SEND_BATCH) {
    const chunk = stalled.slice(i, i + SEND_BATCH);
    await cc.env.JOBS_AI_QUEUE.sendBatch(
      chunk.map((v) => ({ body: tailorCvMessage(v.user_id, v.id) }))
    );
    report.requeued += chunk.length;
  }
  cc.log("cv_sweep", { ...report });
  return report;
}
