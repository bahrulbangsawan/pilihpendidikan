// `score_postings` messages of the `jobs-ai` queue (07 §7.2, 14 §6): the
// scoring consumer lives in services/scoring/consumer.ts.
import { processScorePostings } from "../../services/scoring/consumer";
import type { QueueHandler } from "../types";

export const handleScorePostings: QueueHandler<"score_postings"> = (qc) =>
  processScorePostings(qc, "normal");
