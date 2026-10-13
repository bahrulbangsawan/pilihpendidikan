// The `jobs-ai-dlq` consumer (14 §6, 07 §7.2): a message that exhausted its
// retries never leaves a record stuck.
//
//   score_postings  deterministic-only scores (`components.ai.status =
//                   "dlq"`, status `ready`) for every posting still unscored
//   tailor_cv       the variant ends `failed` (from `generating` only) through
//                   the CV area's `failCvVariant`, plus a `conflict_recorded`
//                   notice on the application's timeline in the same batch
//   other types     their records belong to other areas and carry their own
//                   state; the dead letter is logged for the operator
// Every dead letter emits `{"evt":"dlq","type":…,"user_id_hash":…}` (the
// operator metric, 22 §7). Messages carry ids only, never content (11 §4.4).
// Nothing is replayed automatically; users retry from the UI.

import type { JobsAiMessageOf } from "@pilihpendidikan/jobs-contracts/queue";
import {
  findTailorVariant,
  tailorDeadLetterEventStatements,
} from "../../repo/scoring";
import { failCvVariant } from "../../services/cv/index";
import type { ScoreMessageContext } from "../../services/scoring/consumer";
import { processScorePostings } from "../../services/scoring/consumer";
import type { DeadLetterHandler, QueueContext, QueueOutcome } from "../types";
import { ACK } from "../types";

async function userIdHash(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId)
  );
  let hex = "";
  for (const byte of new Uint8Array(digest).slice(0, 8)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * `tailor_cv`: the variant ends `failed` through the CV area's
 * `failCvVariant` (only from `generating`; a replay changes nothing), with
 * the application notice in the same batch.
 */
async function failDeadTailoring(
  qc: QueueContext<JobsAiMessageOf<"tailor_cv">>
): Promise<QueueOutcome> {
  const cvvId = qc.message.cv_variant_id;
  const variant = await findTailorVariant(qc.db, qc.scope, cvvId);
  if (variant?.status !== "generating") {
    qc.log("dlq_tailor_cv", { cv_variant_id: cvvId, failed: false });
    return ACK;
  }
  const failed = await failCvVariant(qc.db, qc.scope, {
    cvvId,
    now: qc.now,
    extra: variant.application_id
      ? tailorDeadLetterEventStatements(qc.db, qc.scope, {
          applicationId: variant.application_id,
          cvVariantId: cvvId,
          now: qc.now,
        })
      : [],
  });
  qc.log("dlq_tailor_cv", { cv_variant_id: cvvId, failed });
  return ACK;
}

export const handleDeadLetter: DeadLetterHandler = async (qc) => {
  const message = qc.message;
  // qc.log adds the message type and id: {"evt":"dlq","type":…,…}
  qc.log("dlq", {
    user_id_hash: await userIdHash(message.user_id),
    attempts: qc.attempts,
  });
  switch (message.type) {
    case "score_postings":
      return await processScorePostings(qc as ScoreMessageContext, "dlq");
    case "tailor_cv":
      return await failDeadTailoring(
        qc as QueueContext<JobsAiMessageOf<"tailor_cv">>
      );
    default:
      return ACK;
  }
};
