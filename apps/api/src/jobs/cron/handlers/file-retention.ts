// Owner: leaf-2.6 — the daily file retention job (14 §5.4) plus the CV
// variant safety net (render fallback tasks, stalled tailoring, 08 §4.1).
import { sweepCvVariants } from "../../services/cv";
import { runFileRetention } from "../../services/files/retention";
import type { CronHandler } from "../types";

export const runFileRetentionCron: CronHandler = async (cc) => {
  await runFileRetention(cc);
  await sweepCvVariants(cc);
};
