// Owner: leaf-2.8 — `purge_user` messages, 11 §10 account deletion phases
// (jobs_db → r2 → cv_kv; restartable, each re-sends itself while work
// remains). The logic lives in services/account/purge.ts.
import { runPurgePhase } from "../../services/account/purge";
import type { QueueHandler } from "../types";

export const handlePurgeUser: QueueHandler<"purge_user"> = (qc) =>
  runPurgePhase(qc);
