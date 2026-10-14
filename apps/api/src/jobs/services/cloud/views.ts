// API views of the cloud catalog (05 §15): the row without lease and cursor,
// plus the computed status (24 §5), follow state and derived rates.

import type { CloudSourceView } from "@pilihpendidikan/jobs-contracts/api";
import type { CloudSourceStatus } from "@pilihpendidikan/jobs-contracts/enums";
import type { CloudSourceRecord } from "@pilihpendidikan/jobs-contracts/records";

/** DISABLED when switched off, SCRAPING while a run holds the lease, else health. */
export function statusOf(
  source: Pick<CloudSourceRecord, "enabled" | "health" | "lease_expires_at">,
  now: number
): CloudSourceStatus {
  if (!source.enabled) {
    return "DISABLED";
  }
  if (source.lease_expires_at !== null && source.lease_expires_at > now) {
    return "SCRAPING";
  }
  return source.health;
}

export interface ViewExtras {
  followers: number;
  following: boolean;
  jobs: { open: number; total: number };
}

export function toCloudSourceView(
  source: CloudSourceRecord,
  extras: ViewExtras,
  now: number
): CloudSourceView {
  const {
    lease_id: _leaseId,
    lease_expires_at: _leaseExpiresAt,
    cursor_state: _cursorState,
    ...rest
  } = source;
  const runs = source.stats?.runs ?? 0;
  const successes = source.stats?.successes ?? 0;
  const duration = source.stats?.total_duration_ms ?? 0;
  return {
    ...rest,
    status: statusOf(source, now),
    following: extras.following,
    followers: extras.followers,
    jobs_total: extras.jobs.total,
    jobs_open: extras.jobs.open,
    success_rate: runs > 0 ? Math.min(1, successes / runs) : null,
    avg_duration_ms: runs > 0 ? Math.round(duration / runs) : null,
  };
}
