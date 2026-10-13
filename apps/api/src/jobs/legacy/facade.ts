// The legacy jobs facade (06 §12.6, 05 §14, D-04): one interface behind
// `/api/jobs` (src/documents/jobs.ts) and the MCP `jobs_*` tools
// (src/tools/jobs*.ts), served from `JOBS_KV` or `JOBS_DB` by the
// `JOBS_LEGACY_BACKEND` flag (D-33, `DB.feature_flags`, 30 s cache):
//
//   kv  (P0/P1)  the KV blobs `job:{id}` + stamps `owner:job:{id}` (kv.ts)
//   d1  (P2/P3)  applications + postings + interviews in JOBS_DB (d1.ts); a
//                D1 miss for a legacy id falls back to a KV read and migrates
//                that one job on the fly (P3, 06 §12.5)
//
// Both backends answer not-found for not-owned ids, and neither honours the
// admin bypass (D-26, BREAKING: admins see only their own jobs; `?mine=0` is
// ignored; break-glass support access is scripts/support-access.ts).

import type { Env } from "../../env";
import { getFeatureFlags } from "../core/flags";
import { createD1Backend } from "./d1";
import { createKvBackend } from "./kv";
import type { LegacyBackendKind, LegacyContext, LegacyJobs } from "./types";

/** The backend the flag selects (default `kv`; 30 s isolate cache). */
export async function legacyBackendKind(
  env: Pick<Env, "DB">,
  now: number
): Promise<LegacyBackendKind> {
  return (await getFeatureFlags(env, now)).JOBS_LEGACY_BACKEND;
}

/** The facade for one call. */
export async function legacyJobs(ctx: LegacyContext): Promise<LegacyJobs> {
  const kind = await legacyBackendKind(ctx.env, ctx.now);
  return kind === "d1" ? createD1Backend(ctx) : createKvBackend(ctx);
}
