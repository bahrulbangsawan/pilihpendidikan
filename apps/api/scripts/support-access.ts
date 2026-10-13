// Break-glass support access to one user's Job Tracker data (11 §6.2, D-26).
//
// Admins have no bypass on JOBS_DB. When a user asks for help (a support
// ticket), an operator with Cloudflare account credentials runs this script:
//
//   - it is READ-ONLY on JOBS_DB (every statement must be a SELECT; anything
//     else throws before it is sent);
//   - it requires `--ticket <id>`, `--reason <text>` and `--operator <email>`;
//   - with `--execute` it FIRST writes a `support_access_log` row in DB
//     (operator, subject user, reason, ticket, scope), then reads, and prints
//     exactly what was read plus the notice to send to the user;
//   - without `--execute` (dry run) it resolves the user and prints what it
//     would read and log — no log row, no JOBS_DB read.
//
//   bun scripts/support-access.ts --email user@example.com --ticket SUP-123 \
//     --reason "User cannot see job acme" --operator ops@example.com \
//     [--scope applications | --scope application:<legacy id or app_ id>] [--execute]
//
// Remote: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN, database ids from
// wrangler.jsonc (or --db-id / --jobs-db-id). Running it against production
// is itself an access to personal data: only for a real ticket.

import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { LegacyInterviewView } from "../src/jobs/legacy/mapping";
import { toJobData } from "../src/jobs/legacy/mapping";
import type { LegacyViewRow } from "../src/jobs/repo/legacy/read";
import {
  LEGACY_VIEW_SELECT,
  legacyViewOf,
  PENDING_INTERVIEWS_SQL,
} from "../src/jobs/repo/legacy/read";
import { credentialsFromEnv, readArgs } from "./cloudflare";
import type { SqlTarget } from "./migrate-jobs-kv-to-d1";
import { d1RestTarget, wranglerIds } from "./migrate-jobs-kv-to-d1";

export interface SupportAccessOptions {
  execute: boolean;
  identity: SqlTarget;
  jobs: SqlTarget;
  log?: (line: string) => void;
  now?: () => number;
  operator: string;
  reason: string;
  /** `applications` (the list) or `application:<legacy id | app_ id>`. */
  scope: string;
  subject: { email?: string; userId?: string };
  ticket: string;
}

export interface SupportAccessReport {
  logId: string | null;
  mode: "dry run" | "execute";
  notice: string | null;
  read: unknown;
  scope: string;
  userId: string | null;
}

const SELECT_RE = /^\s*SELECT\b/i;
// One statement only: D1 REST would run every statement of a `;` list.
const STATEMENT_SEPARATOR_RE = /;\s*\S/;
const SCOPE_RE = /^(applications|application:.+)$/;
const MIN_REASON_LENGTH = 10;

/** A SqlTarget that only runs SELECTs (11 §6.2: break-glass is read-only). */
export function readOnly(target: SqlTarget): SqlTarget {
  return {
    query<T>(sql: string, params?: unknown[]) {
      if (!SELECT_RE.test(sql) || STATEMENT_SEPARATOR_RE.test(sql)) {
        return Promise.reject(
          new Error("support-access is read-only: only SELECT may run")
        );
      }
      return target.query<T>(sql, params);
    },
    batch() {
      return Promise.reject(
        new Error("support-access is read-only: no batches")
      );
    },
  };
}

function validate(options: SupportAccessOptions): void {
  if (!options.ticket.trim()) {
    throw new Error("--ticket <support ticket id> is required.");
  }
  if (options.reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error(
      `--reason is required (at least ${MIN_REASON_LENGTH} characters).`
    );
  }
  if (!options.operator.includes("@")) {
    throw new Error("--operator <your email> is required.");
  }
  if (!SCOPE_RE.test(options.scope)) {
    throw new Error(
      "--scope must be `applications` or `application:<legacy id or app_ id>`."
    );
  }
  if (!(options.subject.email || options.subject.userId)) {
    throw new Error("Pass --email <user email> or --user <usr_ id>.");
  }
}

async function resolveUser(
  identity: SqlTarget,
  subject: SupportAccessOptions["subject"]
): Promise<{ email: string; id: string } | null> {
  const [row] = subject.userId
    ? await identity.query<{ email: string; id: string }>(
        "SELECT id, email FROM users WHERE id = ?",
        [subject.userId]
      )
    : await identity.query<{ email: string; id: string }>(
        "SELECT id, email FROM users WHERE email = ?",
        [(subject.email ?? "").trim().toLowerCase()]
      );
  return row ?? null;
}

async function readApplications(jobs: SqlTarget, userId: string) {
  return await jobs.query(
    "SELECT a.id, a.legacy_job_id, a.stage, a.submission_status, a.archived, a.updated_at, p.title, p.company_name FROM applications a JOIN user_jobs u ON u.id = a.user_job_id AND u.user_id = a.user_id JOIN job_postings p ON p.id = u.posting_id WHERE a.user_id = ? ORDER BY a.updated_at DESC",
    [userId]
  );
}

async function readApplication(jobs: SqlTarget, userId: string, key: string) {
  const [row] = await jobs.query<LegacyViewRow>(
    `${LEGACY_VIEW_SELECT} WHERE a.user_id = ? AND (a.legacy_job_id = ? OR a.id = ?)`,
    [userId, key, key]
  );
  if (!row) {
    return null;
  }
  const interviews = await jobs.query<LegacyInterviewView>(
    PENDING_INTERVIEWS_SQL,
    [userId, row.a_id]
  );
  const events = await jobs.query(
    "SELECT id, type, from_value, to_value, actor_kind, applied_to_state, recorded_at FROM application_events WHERE user_id = ? AND application_id = ? ORDER BY recorded_at, id",
    [userId, row.a_id]
  );
  return {
    application_id: row.a_id,
    job: toJobData(legacyViewOf(row, interviews)),
    events,
  };
}

function noticeText(options: SupportAccessOptions, at: number): string {
  return [
    "Subject: Support accessed your Job Tracker data",
    "",
    `For your support request ${options.ticket}, our support team viewed your Job Tracker data (${options.scope}) on ${new Date(at).toISOString()}.`,
    `Reason: ${options.reason}`,
    "Nothing was changed. Reply to this email if you did not expect this.",
  ].join("\n");
}

export async function supportAccess(
  options: SupportAccessOptions
): Promise<SupportAccessReport> {
  validate(options);
  const log = options.log ?? (() => undefined);
  const now = options.now?.() ?? Date.now();
  const jobs = readOnly(options.jobs);
  const mode = options.execute ? "execute" : "dry run";
  log(
    mode === "dry run"
      ? "Mode: dry run — no access is logged and no Job Tracker data is read. Pass --execute."
      : "Mode: execute (read-only; the access is logged first)"
  );
  const user = await resolveUser(options.identity, options.subject);
  const report: SupportAccessReport = {
    mode,
    scope: options.scope,
    userId: user?.id ?? null,
    logId: null,
    read: null,
    notice: null,
  };
  if (!user) {
    log("No such user: nothing to read, nothing logged.");
    return report;
  }
  const row = {
    id: newId("sal", now),
    operator_email: options.operator.trim().toLowerCase(),
    subject_user_id: user.id,
    reason: options.reason.trim(),
    ticket_ref: options.ticket.trim(),
    scope: `read:${options.scope}`,
    created_at: now,
  };
  if (!options.execute) {
    log(`Would log support_access_log ${JSON.stringify(row)}`);
    log(`Would read: ${options.scope} of ${user.id}`);
    return report;
  }
  await options.identity.batch([
    {
      sql: "INSERT INTO support_access_log (id, operator_email, subject_user_id, reason, ticket_ref, scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [
        row.id,
        row.operator_email,
        row.subject_user_id,
        row.reason,
        row.ticket_ref,
        row.scope,
        row.created_at,
      ],
    },
  ]);
  report.logId = row.id;
  log(`Logged support access ${row.id} (ticket ${row.ticket_ref}).`);
  report.read =
    options.scope === "applications"
      ? await readApplications(jobs, user.id)
      : await readApplication(
          jobs,
          user.id,
          options.scope.slice("application:".length)
        );
  log("Read (exactly what this run accessed):");
  log(JSON.stringify(report.read, null, 2));
  report.notice = noticeText(options, now);
  log("Send this notice to the user (11 §6.2):");
  log(report.notice);
  return report;
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const ids = wranglerIds();
  const creds = credentialsFromEnv();
  const dbId = args.value("--db-id") ?? ids.db;
  const jobsDbId = args.value("--jobs-db-id") ?? ids.jobsDb;
  if (!(dbId && jobsDbId) || jobsDbId.startsWith("REPLACE_WITH_")) {
    throw new Error("Pass --db-id and --jobs-db-id.");
  }
  await supportAccess({
    execute: args.has("--execute"),
    identity: d1RestTarget(creds, dbId),
    jobs: d1RestTarget(creds, jobsDbId),
    subject: { email: args.value("--email"), userId: args.value("--user") },
    ticket: args.value("--ticket") ?? "",
    reason: args.value("--reason") ?? "",
    operator: args.value("--operator") ?? "",
    scope: args.value("--scope") ?? "applications",
    log: (line) => console.log(line),
  });
}

if (import.meta.main) {
  await main();
}
