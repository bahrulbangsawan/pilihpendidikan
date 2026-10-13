// Bulk actions on inbox rows (12 §4): Track, Dismiss, Score, Mark seen via
// `POST /api/v1/inbox:bulk` (05 §4). At most 200 ids per call, and the api
// tracks at most 100 per call, so selections are sent in chunks, one after
// the other, each with its own Idempotency-Key; a retry of a chunk reuses
// its key. The per-id results become one toast: "Tracked 3 · 1 already
// tracked".

import type {
  InboxBulkRequest,
  InboxBulkResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  InboxBulkAction,
  InboxState,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { Translate } from "@/i18n";
import { isApiError } from "./api-client";
import { newIdempotencyKey } from "./idempotency";

/** `inbox:bulk` accepts at most this many ids (05 §4). */
export const INBOX_BULK_MAX = 200;
/** The api creates at most this many applications per `track` call. */
export const TRACK_BULK_MAX = 100;
/** One quick retry per chunk for a transient failure (same key). */
const CHUNK_ATTEMPTS = 2;

export type InboxBulkResult = InboxBulkResponse["results"][number];

/** A row the call never answered (network down, 5xx after the retry). */
export interface LocalFailure {
  error?: string;
  status: "failed";
  user_job_id: string;
}

export type BulkRowResult = InboxBulkResult | LocalFailure;

export type BulkSender = (
  body: InboxBulkRequest,
  idempotencyKey: string
) => Promise<InboxBulkResponse>;

export function chunkSize(action: InboxBulkAction): number {
  return action === "track" ? TRACK_BULK_MAX : INBOX_BULK_MAX;
}

/** `items` in consecutive chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) {
    throw new Error("Chunk size must be positive.");
  }
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

async function sendChunk(
  send: BulkSender,
  body: InboxBulkRequest,
  key: string
): Promise<BulkRowResult[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt += 1) {
    try {
      const response = await send(body, key);
      return response.results;
    } catch (error) {
      lastError = error;
      if (!(isApiError(error) && error.isRetryable)) {
        break;
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : undefined;
  return body.user_job_ids.map((id) => ({
    user_job_id: id,
    status: "failed" as const,
    ...(message ? { error: message } : {}),
  }));
}

/**
 * Runs `action` on `ids` in chunks (deduplicated, order kept). Every chunk
 * gets a fresh Idempotency-Key from `newKey`; a chunk that fails after its
 * retry reports each of its rows as `failed` and the next chunk still runs.
 */
export async function runInboxBulk(
  action: InboxBulkAction,
  ids: readonly string[],
  send: BulkSender,
  newKey: () => string = newIdempotencyKey
): Promise<BulkRowResult[]> {
  const unique = [...new Set(ids)];
  const results: BulkRowResult[] = [];
  for (const part of chunk(unique, chunkSize(action))) {
    results.push(
      ...(await sendChunk(send, { action, user_job_ids: part }, newKey()))
    );
  }
  return results;
}

export interface InboxBulkSummary {
  action: InboxBulkAction;
  /** Already in the target state (tracked, dismissed, seen, scored). */
  already: number;
  /** Applications created or found by `track`, in request order. */
  applicationIds: string[];
  /** Tracked jobs a dismiss left alone (archive the application instead). */
  conflicts: number;
  /** Changed by this call. */
  done: number;
  /** Not found, refused or never answered. */
  failed: number;
}

const TARGET_STATE: Readonly<Partial<Record<InboxBulkAction, InboxState>>> = {
  track: "tracked",
  dismiss: "dismissed",
  seen: "seen",
};

/**
 * Counts per outcome. `previous` holds each row's state before the call:
 * a row that already was in the target state counts as "already", since the
 * api answers `ok` for it too.
 */
export function summarizeInboxBulk(
  action: InboxBulkAction,
  results: readonly BulkRowResult[],
  previous: ReadonlyMap<string, InboxState>
): InboxBulkSummary {
  const summary: InboxBulkSummary = {
    action,
    already: 0,
    applicationIds: [],
    conflicts: 0,
    done: 0,
    failed: 0,
  };
  for (const result of results) {
    if (result.status === "ok") {
      if (action === "track" && result.application_id) {
        summary.applicationIds.push(result.application_id);
      }
      const already =
        action === "score"
          ? result.score_status === "cached"
          : previous.get(result.user_job_id) === TARGET_STATE[action];
      if (already) {
        summary.already += 1;
      } else {
        summary.done += 1;
      }
    } else if (result.status === "conflict") {
      summary.conflicts += 1;
    } else {
      summary.failed += 1;
    }
  }
  return summary;
}

/** "Tracked 3 · 1 already tracked · 1 failed". */
export function bulkToastText(t: Translate, summary: InboxBulkSummary): string {
  const parts: string[] = [];
  if (summary.done > 0 || (summary.already === 0 && summary.failed === 0)) {
    parts.push(t(`inbox.bulk.done.${summary.action}`, { count: summary.done }));
  }
  if (summary.already > 0) {
    parts.push(
      t(`inbox.bulk.already.${summary.action}`, { count: summary.already })
    );
  }
  if (summary.conflicts > 0) {
    parts.push(t("inbox.bulk.conflicts", { count: summary.conflicts }));
  }
  if (summary.failed > 0) {
    parts.push(t("inbox.bulk.failed", { count: summary.failed }));
  }
  return parts.join(" · ");
}

/** True when the toast should read as an error (nothing went through). */
export function bulkFailedOutright(summary: InboxBulkSummary): boolean {
  return (
    summary.done === 0 &&
    summary.already === 0 &&
    summary.failed + summary.conflicts > 0
  );
}
