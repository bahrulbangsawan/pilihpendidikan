// File retention (14 §5.4), run daily by cron/handlers/file-retention.ts.
// R2 lifecycle rules are prefix-based and our prefixes are per user, so
// retention is enforced from `files`:
//
//   pending older than 24 h         abandoned upload → R2 delete + row removed
//   ready, retention_until passed   evidence screenshots / run logs → deleted;
//                                   cv_pdf / cover_letter / attachment →
//                                   deleted unless referenced again (then
//                                   the clock is cleared)
//   ready, NULL, unreferenced       cv_pdf / cover_letter / attachment → the
//                                   30-day orphan clock starts
//   deleted, unreferenced           R2 object deleted, row removed
//
// Each step scans at most `limit` rows in id order with system statements
// and acts per row with the owner's trusted scope; what is left waits for
// the next run (resumable).

import type { CronContext } from "../../cron/types";
import { trustedScope } from "../../core/scope";
import type { RetentionRow } from "../../repo/files";
import {
  commitFileStatements,
  discardPendingFile,
  fileReferenced,
  listAbandonedUploads,
  listDeletedFiles,
  listExpiredFiles,
  listOrphanCandidates,
  markFileDeletedStatements,
  removeFileRowStatement,
  setFileRetentionStatement,
} from "../../repo/files";
import { PENDING_UPLOAD_TTL_MS, UNREFERENCED_RETENTION_MS } from "./policy";

/** Rows per step and run (14 §7: chunk work, ≤ 5,000 rows). */
export const RETENTION_STEP_LIMIT = 5000;
const PAGE = 500;

export interface FileRetentionReport {
  abandoned: number;
  clockStarted: number;
  expired: number;
  kept: number;
  purged: number;
}

type Lister = (afterId: string, limit: number) => Promise<RetentionRow[]>;

// Pages through one scan; the handler may change rows it has seen, so the
// next page starts after the last id instead of an offset.
async function forEachRow(
  list: Lister,
  limit: number,
  handle: (row: RetentionRow) => Promise<void>
): Promise<void> {
  let afterId = "";
  let seen = 0;
  while (seen < limit) {
    const rows = await list(afterId, Math.min(PAGE, limit - seen));
    for (const row of rows) {
      await handle(row);
    }
    seen += rows.length;
    if (rows.length === 0) {
      return;
    }
    afterId = rows.at(-1)?.id ?? afterId;
  }
}

const KEEP_WHILE_REFERENCED = new Set(["cv_pdf", "cover_letter", "attachment"]);

export async function runFileRetention(
  cc: CronContext,
  limit: number = RETENTION_STEP_LIMIT
): Promise<FileRetentionReport> {
  const { db, env, now } = cc;
  const report: FileRetentionReport = {
    abandoned: 0,
    expired: 0,
    kept: 0,
    clockStarted: 0,
    purged: 0,
  };
  await forEachRow(
    (afterId, max) =>
      listAbandonedUploads(db, {
        afterId,
        before: now - PENDING_UPLOAD_TTL_MS,
        limit: max,
      }),
    limit,
    async (row) => {
      await env.JOBS_FILES.delete(row.r2_key);
      await discardPendingFile(db, trustedScope(row.user_id, "cron"), row.id);
      report.abandoned += 1;
    }
  );
  await forEachRow(
    (afterId, max) => listExpiredFiles(db, { afterId, now, limit: max }),
    limit,
    async (row) => {
      const scope = trustedScope(row.user_id, "cron");
      if (
        KEEP_WHILE_REFERENCED.has(row.kind) &&
        (await fileReferenced(db, scope, row.id))
      ) {
        await commitFileStatements(db, [
          setFileRetentionStatement(db, scope, row.id, null),
        ]);
        report.kept += 1;
        return;
      }
      await env.JOBS_FILES.delete(row.r2_key);
      await commitFileStatements(
        db,
        markFileDeletedStatements(db, scope, row.id, now)
      );
      report.expired += 1;
    }
  );
  await forEachRow(
    (afterId, max) => listOrphanCandidates(db, { afterId, limit: max }),
    limit,
    async (row) => {
      const scope = trustedScope(row.user_id, "cron");
      await commitFileStatements(db, [
        setFileRetentionStatement(
          db,
          scope,
          row.id,
          now + UNREFERENCED_RETENTION_MS
        ),
      ]);
      report.clockStarted += 1;
    }
  );
  await forEachRow(
    (afterId, max) => listDeletedFiles(db, { afterId, limit: max }),
    limit,
    async (row) => {
      const scope = trustedScope(row.user_id, "cron");
      if (await fileReferenced(db, scope, row.id)) {
        return;
      }
      await env.JOBS_FILES.delete(row.r2_key);
      await commitFileStatements(db, [
        removeFileRowStatement(db, scope, row.id),
      ]);
      report.purged += 1;
    }
  );
  cc.log("file_retention", { ...report });
  return report;
}
