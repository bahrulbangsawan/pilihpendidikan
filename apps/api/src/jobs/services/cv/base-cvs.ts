// `GET /api/v1/cvs` (05 §7): the caller's CV documents, from the CV_KV owner
// stamps (`owner:cv:{id}` = the caller's email, no admin bypass — D-26 spirit
// for Job Tracker surfaces). Sorted by id, keyset-paginated on it. Each page
// reads only its own documents (visibility, name, title).

import type { BaseCvSummary } from "@pilihpendidikan/jobs-contracts/api";
import { cvVisibilityOf, isTailoredCvId } from "../../../documents/cv-create";
import type { Env } from "../../../env";
import type { CVData } from "../../../types";
import { idsOwnedBy, listAllKeys } from "../../../ownership";
import type { Page, PageRequest } from "../../core/pagination";
import { pageOf } from "../../core/pagination";

const PREFIX = "cv:";

/** One page of the caller's CVs (base and tailored, `is_tailored` marks the latter). */
export async function listOwnedCvs(
  env: Env,
  email: string,
  page: PageRequest
): Promise<Page<BaseCvSummary>> {
  const keys = await listAllKeys<Record<string, string>>(env.CV_KV, PREFIX);
  const ids = keys.map((key) => key.name.slice(PREFIX.length)).sort();
  const owned = await idsOwnedBy(env, "cv", email, ids);
  const after = page.cursor ? String(page.cursor[0]) : null;
  const window = ids
    .filter((id) => owned.has(id) && (after === null || id > after))
    .slice(0, page.limit + 1);
  const rows: BaseCvSummary[] = [];
  for (const id of window) {
    const doc = await env.CV_KV.get<CVData>(`${PREFIX}${id}`, "json");
    if (doc === null) {
      continue;
    }
    rows.push({
      id,
      full_name: doc.personalInfo?.fullName ?? "",
      job_title: doc.personalInfo?.jobTitle ?? "",
      visibility: cvVisibilityOf(doc),
      is_tailored: isTailoredCvId(id),
    });
  }
  return pageOf(rows, page.limit, (row) => [row.id]);
}
