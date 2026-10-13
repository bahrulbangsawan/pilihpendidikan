// Account export (05 §10a, 11 §10, 14 §6 `export_user`).
//
//   POST /api/v1/account/export   (browser session only) writes a `pending`
//        export record, its cleanup index entry, and sends `export_user`;
//        202 {export_id, status: "pending"}.
//   export_user (queue)           builds ONE ZIP at
//        `u/{user_id}/export/{export_id}.zip` with
//          README.txt, manifest.json, account.json (user, devices, grants,
//          token metadata — no secrets), data/<table>.json for every JOBS_DB
//          table of the user (+ data/job_postings.json: the postings the user
//          can see), cvs/<id>.json (CV documents, base and tailored),
//          legacy-jobs/<id>.json (the pre-D1 JOBS_KV documents) and
//          files/<kind>/<file> (every ready R2 file);
//        then marks the record `ready` (link valid 24 h) and emails the link
//        ONCE: `emailed_at` is claimed in the record before sending and
//        released when the send fails, so a redelivered message never mails
//        twice. A replay rebuilds nothing once the zip is ready.
//   GET  /api/v1/account/exports/{export_id}  (browser session only) streams
//        the zip while the link is valid; the dashboard serves it to the
//        signed-in person through its BFF (`/download/account/exports/…`),
//        which is what the email links to.

import type { JobsAiMessageOf } from "@pilihpendidikan/jobs-contracts/queue";
import type { Env } from "../../../env";
import { notFound, upstreamUnavailable } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { QueueContext, QueueOutcome } from "../../queue/types";
import { ACK } from "../../queue/types";
import type { ExportTable } from "../../repo/account/export";
import {
  EXPORT_TABLES,
  exportFiles,
  exportPostingsPage,
  exportTablePage,
} from "../../repo/account/export";
import { accountIdentity } from "../../repo/account/identity";
import type { JobsDb } from "../../repo/core/db";
import type { UserRow } from "../../repo/core/users";
import { findUserById } from "../../repo/core/users";
import { renderExportReadyEmail, sendAccountEmail } from "./email";
import type { ExportRecord } from "./records";
import {
  EXPORT_CLEANUP_AFTER_MS,
  EXPORT_LINK_TTL_MS,
  exportIndexKey,
  exportRecordKey,
  exportZipKey,
  isExportId,
  newExportId,
  readExportRecord,
  writeExportRecord,
} from "./records";
import {
  jobsAppOrigin,
  ownedDocumentIds,
  sendJobsMessage,
  userLocale,
} from "./shared";
import { R2ZipSink, ZipWriter } from "./zip";

type ExportContext = QueueContext<JobsAiMessageOf<"export_user">>;

/** Starts an export (the route checked the browser session). */
export async function requestAccountExport(
  env: Pick<Env, "JOBS_AI_QUEUE" | "JOBS_FILES">,
  scope: UserScope,
  now: number
): Promise<{ export_id: string; status: "pending" }> {
  const exportId = newExportId(now);
  const record: ExportRecord = {
    export_id: exportId,
    user_id: scope.userId,
    status: "pending",
    requested_at: now,
    ready_at: null,
    expires_at: null,
    emailed_at: null,
    size_bytes: null,
    entries: null,
    error: null,
  };
  await writeExportRecord(env.JOBS_FILES, record);
  const index = exportIndexKey(
    now + EXPORT_CLEANUP_AFTER_MS,
    scope.userId,
    exportId
  );
  await env.JOBS_FILES.put(index, "");
  try {
    await sendJobsMessage(env, {
      v: 1,
      type: "export_user",
      message_id: crypto.randomUUID(),
      user_id: scope.userId,
      export_id: exportId,
    });
  } catch {
    await env.JOBS_FILES.delete([
      exportRecordKey(scope.userId, exportId),
      index,
    ]);
    throw upstreamUnavailable("The export could not be queued. Retry.");
  }
  return { export_id: exportId, status: "pending" };
}

/** The download link of an export (the dashboard BFF route). */
export function exportDownloadLink(
  env: Pick<Env, "JOBS_APP_ORIGIN">,
  exportId: string
): string {
  return `${jobsAppOrigin(env)}/download/account/exports/${exportId}`;
}

const README = `pilihpendidikan — Job Tracker data export

manifest.json        what this archive holds (tables and row counts, files)
account.json         your account: user, devices, sign-in grants and token
                     metadata (no secrets)
data/<table>.json    every Job Tracker database row of your account, one
                     JSON array per table (timestamps are epoch milliseconds)
data/job_postings.json  the job postings you track or saved privately
cvs/<id>.json        your CV documents (base CVs and tailored variants)
legacy-jobs/<id>.json   job documents from the earlier tracker, if any
files/<kind>/<file>  your stored files (CV PDFs, letters, attachments,
                     evidence screenshots, run logs)
`;

async function addTable(
  zip: ZipWriter,
  db: JobsDb,
  scope: UserScope,
  table: ExportTable | "job_postings"
): Promise<number> {
  const parts: string[] = [];
  let after = 0;
  for (;;) {
    const page =
      table === "job_postings"
        ? await exportPostingsPage(db, scope, after)
        : await exportTablePage(db, scope, table, after);
    for (const row of page.rows) {
      parts.push(JSON.stringify(row));
    }
    if (page.next === null) {
      break;
    }
    after = page.next;
  }
  await zip.addFile(
    `data/${table}.json`,
    parts.length === 0 ? "[]\n" : `[\n${parts.join(",\n")}\n]\n`
  );
  return parts.length;
}

async function addDocuments(
  zip: ZipWriter,
  env: Env,
  kind: "cv" | "jobs",
  email: string
): Promise<number> {
  const namespace = kind === "cv" ? env.CV_KV : env.JOBS_KV;
  const prefix = kind === "cv" ? "cv:" : "job:";
  const folder = kind === "cv" ? "cvs" : "legacy-jobs";
  let count = 0;
  for (const id of await ownedDocumentIds(env, kind, email)) {
    const text = await namespace.get(`${prefix}${id}`);
    if (text !== null) {
      await zip.addFile(`${folder}/${encodeURIComponent(id)}.json`, text);
      count += 1;
    }
  }
  return count;
}

async function addFiles(
  zip: ZipWriter,
  env: Env,
  db: JobsDb,
  scope: UserScope
): Promise<{ files: number; missing: string[] }> {
  const missing: string[] = [];
  let files = 0;
  for (const file of await exportFiles(db, scope)) {
    const object = await env.JOBS_FILES.get(file.r2_key);
    if (!object) {
      missing.push(file.id);
      continue;
    }
    const base = file.r2_key.slice(file.r2_key.lastIndexOf("/") + 1);
    await zip.addFile(
      `files/${file.kind}/${base}`,
      new Uint8Array(await object.arrayBuffer())
    );
    files += 1;
  }
  return { files, missing };
}

async function writeZip(
  qc: ExportContext,
  user: UserRow,
  record: ExportRecord
): Promise<{ bytes: number; entries: number }> {
  const day = new Date(qc.now).toISOString().slice(0, 10);
  const sink = new R2ZipSink(
    qc.env.JOBS_FILES,
    exportZipKey(user.id, record.export_id),
    {
      httpMetadata: {
        contentType: "application/zip",
        contentDisposition: `attachment; filename="pilihpendidikan-export-${day}.zip"`,
      },
      customMetadata: { user_id: user.id, export_id: record.export_id },
    }
  );
  const zip = new ZipWriter(sink, new Date(qc.now));
  try {
    await zip.addFile("README.txt", README);
    const identity = await accountIdentity(qc.env.DB, user);
    await zip.addFile(
      "account.json",
      `${JSON.stringify(
        {
          user: { id: user.id, email: user.email, created_at: user.created_at },
          ...identity,
        },
        null,
        2
      )}\n`
    );
    const tables: Record<string, number> = {};
    for (const table of EXPORT_TABLES) {
      tables[table] = await addTable(zip, qc.db, qc.scope, table);
    }
    tables.job_postings = await addTable(zip, qc.db, qc.scope, "job_postings");
    const cvs = await addDocuments(zip, qc.env, "cv", user.email);
    const legacyJobs = await addDocuments(zip, qc.env, "jobs", user.email);
    const files = await addFiles(zip, qc.env, qc.db, qc.scope);
    await zip.addFile(
      "manifest.json",
      `${JSON.stringify(
        {
          export_id: record.export_id,
          user_id: user.id,
          generated_at: qc.now,
          tables,
          cvs,
          legacy_jobs: legacyJobs,
          files: files.files,
          missing_files: files.missing,
        },
        null,
        2
      )}\n`
    );
    const done = await zip.finish();
    await sink.close();
    return done;
  } catch (err) {
    await sink.abort();
    throw err;
  }
}

async function emailOnce(
  qc: ExportContext,
  user: UserRow,
  record: ExportRecord
): Promise<void> {
  if (record.emailed_at !== null) {
    return;
  }
  const claimed: ExportRecord = { ...record, emailed_at: qc.now };
  await writeExportRecord(qc.env.JOBS_FILES, claimed);
  const locale = await userLocale(qc.db, qc.scope, qc.now);
  try {
    await sendAccountEmail(
      qc.env,
      user.email,
      renderExportReadyEmail({
        link: exportDownloadLink(qc.env, record.export_id),
        locale,
      })
    );
  } catch (err) {
    await writeExportRecord(qc.env.JOBS_FILES, record);
    throw err;
  }
}

/** The `export_user` consumer (idempotent per export id, 14 §6). */
export async function runAccountExport(
  qc: ExportContext
): Promise<QueueOutcome> {
  const exportId = qc.message.export_id;
  if (!isExportId(exportId)) {
    qc.log("export_user_invalid_id");
    return ACK;
  }
  let record = await readExportRecord(
    qc.env.JOBS_FILES,
    qc.scope.userId,
    exportId
  );
  if (!record || record.user_id !== qc.scope.userId) {
    qc.log("export_user_missing", { export_id: exportId });
    return ACK;
  }
  if (record.status === "failed" || record.emailed_at !== null) {
    return ACK;
  }
  const user = await findUserById(qc.env.DB, qc.scope.userId);
  if (!user || user.deleted_at !== null) {
    await writeExportRecord(qc.env.JOBS_FILES, {
      ...record,
      status: "failed",
      error: "account_deleted",
    });
    return ACK;
  }
  if (record.status === "pending") {
    const built = await writeZip(qc, user, record);
    record = {
      ...record,
      status: "ready",
      ready_at: qc.now,
      expires_at: qc.now + EXPORT_LINK_TTL_MS,
      size_bytes: built.bytes,
      entries: built.entries,
    };
    await writeExportRecord(qc.env.JOBS_FILES, record);
    qc.log("export_user_ready", {
      export_id: exportId,
      bytes: built.bytes,
      entries: built.entries,
    });
  }
  await emailOnce(qc, user, record);
  return ACK;
}

/** The ready, unexpired export of the caller, or 404. */
export async function openAccountExport(
  env: Pick<Env, "JOBS_FILES">,
  scope: UserScope,
  exportId: string,
  now: number
): Promise<{ object: R2ObjectBody; record: ExportRecord }> {
  if (!isExportId(exportId)) {
    throw notFound("Export not found.");
  }
  const record = await readExportRecord(env.JOBS_FILES, scope.userId, exportId);
  if (
    !record ||
    record.user_id !== scope.userId ||
    record.status !== "ready" ||
    record.expires_at === null ||
    record.expires_at <= now
  ) {
    throw notFound("Export not found or expired.");
  }
  const object = await env.JOBS_FILES.get(exportZipKey(scope.userId, exportId));
  if (!object) {
    throw notFound("Export not found or expired.");
  }
  return { object, record };
}
