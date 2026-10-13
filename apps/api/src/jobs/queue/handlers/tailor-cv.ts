// Owner: leaf-2.6 — `tailor_cv` messages, the 08 §4 CV tailoring consumer
// (and the delayed render check of 08 §4.1 step 8). See
// services/cv/tailoring/run.ts.
import { runTailorCv } from "../../services/cv";
import type { QueueHandler } from "../types";

export const handleTailorCv: QueueHandler<"tailor_cv"> = (qc) =>
  runTailorCv(qc);
