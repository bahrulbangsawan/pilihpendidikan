// Account export and deletion state, kept as small JSON objects in R2
// (`JOBS_FILES`): R2 reads are strongly consistent, unlike KV, and JOBS_DB
// has no table for either (04 §2 is fixed).
//
//   u/{user_id}/export/{export_id}.json   export record (pending → ready)
//   u/{user_id}/export/{export_id}.zip    the export itself (11 §10)
//   account-exports/{deadline}/{user_id}/{export_id}
//                                         cleanup index, zero-padded deadline
//                                         so a prefix listing is time-ordered
//   account-deletions/{user_id}.json      deletion record: who, which
//                                         options, which purge phases ran
//
// Records hold ids, timestamps and the options the user chose; the deletion
// record also keeps the email until the hard delete (it is still in
// `users.email` for those 30 days anyway, 11 §10 step 5).

import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { PurgePhaseSchema } from "@pilihpendidikan/jobs-contracts/queue";
import type { z } from "zod";
import { DAY_MS } from "../../core/clock";

type PurgePhase = z.infer<typeof PurgePhaseSchema>;

/** The emailed export link works for 24 h (11 §10). */
export const EXPORT_LINK_TTL_MS = DAY_MS;
/** Export objects are swept this long after the request (pending or not). */
export const EXPORT_CLEANUP_AFTER_MS = 2 * DAY_MS;

export type ExportStatus = "pending" | "ready" | "failed";

export interface ExportRecord {
  emailed_at: number | null;
  entries: number | null;
  error: string | null;
  expires_at: number | null;
  export_id: string;
  ready_at: number | null;
  requested_at: number;
  size_bytes: number | null;
  status: ExportStatus;
  user_id: string;
}

export interface DeletionRecord {
  also_delete_cvs: boolean;
  completed_at: number | null;
  confirmed_at: number;
  email: string;
  phases_done: PurgePhase[];
  redrives: number;
  requested_at: number;
  user_id: string;
}

const EXPORT_ID_RE = /^exp_[0-9A-HJKMNP-TV-Z]{26}$/;
const INDEX_KEY_RE =
  /^account-exports\/(\d{15})\/(usr_[0-9A-Z]{26})\/(exp_[0-9A-Z]{26})$/;
const JSON_TYPE = { contentType: "application/json; charset=utf-8" };

/** `exp_<ULID>` (the export id is not a table id, so it has its own prefix). */
export function newExportId(now: number): string {
  return `exp_${newId("evt", now).slice("evt_".length)}`;
}

export function isExportId(value: string): boolean {
  return EXPORT_ID_RE.test(value);
}

export function exportRecordKey(userId: string, exportId: string): string {
  return `u/${userId}/export/${exportId}.json`;
}

export function exportZipKey(userId: string, exportId: string): string {
  return `u/${userId}/export/${exportId}.zip`;
}

export const EXPORT_INDEX_PREFIX = "account-exports/";

export function exportIndexKey(
  deadline: number,
  userId: string,
  exportId: string
): string {
  return `${EXPORT_INDEX_PREFIX}${String(Math.max(0, Math.floor(deadline))).padStart(15, "0")}/${userId}/${exportId}`;
}

/** `{deadline, userId, exportId}` of an index key, or null. */
export function parseExportIndexKey(
  key: string
): { deadline: number; exportId: string; userId: string } | null {
  const match = INDEX_KEY_RE.exec(key);
  if (!match) {
    return null;
  }
  return { deadline: Number(match[1]), userId: match[2], exportId: match[3] };
}

export const DELETION_PREFIX = "account-deletions/";

export function deletionRecordKey(userId: string): string {
  return `${DELETION_PREFIX}${userId}.json`;
}

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  try {
    return JSON.parse(await object.text()) as T;
  } catch {
    return null;
  }
}

async function writeJson(
  bucket: R2Bucket,
  key: string,
  value: unknown
): Promise<void> {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: JSON_TYPE });
}

export function readExportRecord(
  bucket: R2Bucket,
  userId: string,
  exportId: string
): Promise<ExportRecord | null> {
  return readJson<ExportRecord>(bucket, exportRecordKey(userId, exportId));
}

export async function writeExportRecord(
  bucket: R2Bucket,
  record: ExportRecord
): Promise<void> {
  await writeJson(
    bucket,
    exportRecordKey(record.user_id, record.export_id),
    record
  );
}

export function readDeletionRecord(
  bucket: R2Bucket,
  userId: string
): Promise<DeletionRecord | null> {
  return readJson<DeletionRecord>(bucket, deletionRecordKey(userId));
}

export async function writeDeletionRecord(
  bucket: R2Bucket,
  record: DeletionRecord
): Promise<void> {
  await writeJson(bucket, deletionRecordKey(record.user_id), record);
}
