// Owner: leaf-2.8 — `export_user` messages, 11 §10 account export: one ZIP
// per export id at `u/{user_id}/export/{export_id}.zip`, the link emailed
// once. The logic lives in services/account/export.ts.
import { runAccountExport } from "../../services/account/export";
import type { QueueHandler } from "../types";

export const handleExportUser: QueueHandler<"export_user"> = (qc) =>
  runAccountExport(qc);
