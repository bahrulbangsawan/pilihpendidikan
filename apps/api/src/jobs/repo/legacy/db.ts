// The JOBS_DB handle of the two entry points that live outside /api/v1: the
// legacy REST facade (`/api/jobs`, src/documents/jobs.ts) and the MCP jobs
// tools (src/tools/jobs*.ts). Like the router, the queue consumer and the
// cron dispatcher, they hold only the opaque `JobsDb` and hand it to repo
// functions; this is where they get it (kernel rule 1, T11-JOBSDB).

import type { Env } from "../../../env";
import type { JobsDb } from "../core/db";
import { jobsDb } from "../core/db";

export function legacyFacadeDb(env: Pick<Env, "JOBS_DB">): JobsDb {
  return jobsDb(env);
}
