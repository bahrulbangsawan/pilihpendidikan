// The audited seed catalog of cloud discovery (24 §7.1): `cloud-sources.json`,
// parsed once. Every entry was checked against the live site (robots.txt,
// feeds, JSON-LD, protection, login walls, terms) before it was written; the
// evidence lines are kept in `audit`. apps/api syncs it into
// `JOBS_DB.cloud_sources` without overwriting operator edits.
import cloudSourcesJson from "../cloud-sources.json" with { type: "json" };
import type { CloudSourcesFile } from "./cloud";
import { CloudSourcesFileSchema } from "./cloud";

export const CLOUD_SOURCES_FILE: CloudSourcesFile =
  CloudSourcesFileSchema.parse(cloudSourcesJson);
