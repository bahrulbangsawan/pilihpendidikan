// `GET /api/v1/applications/{app_id}` (05 §5).

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import { notFound } from "../../core/http";
import type { UserScope } from "../../core/scope";
import { readDetail } from "../../repo/applications/detail";
import type { JobsDb } from "../../repo/core/db";

export interface DetailOptions {
  /**
   * The caller's current profile_version (07 §2.1): the score shown is that
   * version's. Omitted: the newest score of any version.
   */
  profileVersion?: number | null;
}

/** The full detail; 404 when the application is not the caller's. */
export async function loadDetail(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  opts: DetailOptions
): Promise<ApplicationDetail> {
  const rows = await readDetail(
    db,
    scope,
    applicationId,
    opts.profileVersion ?? null
  );
  if (!(rows.application && rows.userJob && rows.posting)) {
    throw notFound("Application not found.");
  }
  return {
    application: rows.application,
    user_job: rows.userJob,
    posting: rows.posting,
    score: rows.score,
    cv_variants: rows.cvVariants,
    interviews: rows.interviews,
    offers: rows.offers,
    approvals: rows.approvals,
    tasks: rows.tasks,
    evidence: rows.evidence,
    emails: rows.emails,
  } as unknown as ApplicationDetail;
}
