// Owner: leaf-2.7 — `evaluate_rules` messages (07 §10, 19 §8.3, 21 §4, 14 §6):
// after scoring, match the user's enabled automation rules against the
// scored postings and create the apply tasks they call for. Idempotent under
// at-least-once delivery: each task is keyed `rule:<rule id>:<posting id>`
// (UNIQUE per user) and guarded by `ux_tasks_live_apply`; a posting without a
// `ready` score of the current profile version is re-queued for scoring and
// deferred, never matched on a stale score.

import { getFeatureFlags } from "../../core/flags";
import { evaluateRules } from "../../services/automation/rule-engine";
import type { QueueHandler } from "../types";
import { ACK } from "../types";

export const handleEvaluateRules: QueueHandler<"evaluate_rules"> = async (
  qc
) => {
  const flags = await getFeatureFlags(qc.env, qc.now);
  const result = await evaluateRules(qc.db, qc.scope, {
    env: qc.env,
    flags,
    now: qc.now,
    postingIds: qc.message.posting_ids,
  });
  qc.log("evaluate_rules_done", {
    postings: qc.message.posting_ids.length,
    created: result.created.length,
    deferred: result.deferred.length,
    skipped: Object.keys(result.skipped).length,
  });
  return ACK;
};
