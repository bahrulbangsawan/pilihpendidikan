// Fixtures of the email-application route tests.

import { createHash } from "node:crypto";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { TestEnv, V1Client, V1Session } from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";

export const NOW = Date.UTC(2026, 9, 12, 9);
export const DAY = 86_400_000;

export interface EmailFixture {
  alice: V1Session;
  app: { id: string; postingId: string };
  client: V1Client;
  cvFile: { id: string; sha256: string };
  t: TestEnv;
}

type Row = Record<string, string | number | null>;

export function insert(t: TestEnv, table: string, row: Row): void {
  const columns = Object.keys(row);
  t.jobsSqlite
    .query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    )
    .run(...columns.map((column) => row[column] ?? null));
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A ready file of the user, stored in the fake R2. */
export async function seedFile(
  t: TestEnv,
  userId: string,
  options: {
    contentType?: string;
    kind?: string;
    name?: string;
    size?: number;
  } = {}
): Promise<{ id: string; r2Key: string; sha256: string }> {
  const id = newId("fil", NOW);
  const bytes = new Uint8Array(options.size ?? 2048);
  bytes.set(new TextEncoder().encode("%PDF-1.7 "), 0);
  bytes[bytes.length - 1] = id.charCodeAt(id.length - 1);
  const digest = sha256(bytes);
  const r2Key = `u/${userId}/${options.kind ?? "cv_pdf"}/${id}.pdf`;
  await t.env.JOBS_FILES.put(r2Key, bytes);
  insert(t, "files", {
    id,
    user_id: userId,
    kind: options.kind ?? "cv_pdf",
    r2_key: r2Key,
    content_type: options.contentType ?? "application/pdf",
    size_bytes: bytes.byteLength,
    sha256: digest,
    original_name: options.name ?? "Rina CV.pdf",
    status: "ready",
    created_at: NOW - DAY,
  });
  return { id, r2Key, sha256: digest };
}

export function seedFact(
  t: TestEnv,
  userId: string,
  key: string,
  value: unknown
): void {
  insert(t, "applicant_facts", {
    id: newId("fct", NOW),
    user_id: userId,
    key,
    value: JSON.stringify(value),
    source: "user_entered",
    created_at: NOW,
    updated_at: NOW,
  });
}

/** An application (stage ready) for a posting at acme.co.id. */
export function seedEmailApplication(
  t: TestEnv,
  userId: string,
  posting: Row = {}
): { id: string; postingId: string } {
  const postingId = newId("pst", NOW);
  insert(t, "job_postings", {
    id: postingId,
    fingerprint: `fp1:${sha256(new TextEncoder().encode(postingId))}`,
    visibility: "public",
    source_kind: "email",
    company_name: "Acme Indonesia",
    company_domain: "acme.co.id",
    title: "Backend Engineer",
    source_job_ref: "BE-42",
    application_support: "email",
    content_hash: "0".repeat(64),
    first_seen_at: NOW - DAY,
    last_seen_at: NOW - DAY,
    created_at: NOW - DAY,
    updated_at: NOW - DAY,
    ...posting,
  });
  const userJobId = newId("ujb", NOW);
  insert(t, "user_jobs", {
    id: userJobId,
    user_id: userId,
    posting_id: postingId,
    origin: "manual",
    inbox_state: "tracked",
    created_at: NOW - DAY,
    updated_at: NOW - DAY,
  });
  const id = newId("app", NOW);
  insert(t, "applications", {
    id,
    user_id: userId,
    user_job_id: userJobId,
    stage: "ready",
    stage_changed_at: NOW - DAY,
    submission_status: "not_started",
    mode: "manual",
    board_rank: "i",
    last_change_source: "web",
    created_at: NOW - DAY,
    updated_at: NOW - DAY,
  });
  return { id, postingId };
}

export async function setupEmail(
  options: { serverSend?: boolean } = {}
): Promise<EmailFixture> {
  const t = createTestEnv(
    {},
    { flags: { JOBS_EMAIL_SERVER_SEND_ENABLED: options.serverSend ?? false } }
  );
  const client = createV1Client(t, { clock: createFakeClock(NOW) });
  const alice = await client.browserSession("rina@example.com");
  const userId = alice.userId as string;
  // An account older than the 7-day server_send block.
  t.sqlite
    .query("UPDATE users SET created_at = ? WHERE id = ?")
    .run(NOW - 30 * DAY, userId);
  seedFact(t, userId, "contact.full_name", "Rina Wijaya");
  seedFact(t, userId, "contact.phone", "+62 812 0000 0000");
  const app = seedEmailApplication(t, userId);
  const cvFile = await seedFile(t, userId);
  return { t, client, alice, app, cvFile };
}

export interface DraftBody {
  approval: Record<string, unknown>;
  email: Record<string, unknown> & { id: string; status: string };
  review: Record<string, unknown> & { payload_hash: string };
}

export function draft(
  session: V1Session,
  appId: string,
  body: Record<string, unknown>
) {
  return session.post<DraftBody>(`/api/v1/applications/${appId}/emails`, body, {
    idempotencyKey: crypto.randomUUID(),
  });
}

export function approve(
  session: V1Session,
  emailId: string,
  body: Record<string, unknown>
) {
  return session.post<Record<string, unknown>>(
    `/api/v1/emails/${emailId}/approve`,
    body,
    { idempotencyKey: crypto.randomUUID() }
  );
}

export function handOff(
  session: V1Session,
  emailId: string,
  body: Record<string, unknown>
) {
  return session.post<Record<string, unknown>>(
    `/api/v1/emails/${emailId}/handed-off`,
    body,
    { idempotencyKey: crypto.randomUUID() }
  );
}

export function rows(t: TestEnv, sql: string, ...binds: string[]) {
  return t.jobsSqlite.query(sql).all(...binds) as Record<string, unknown>[];
}
