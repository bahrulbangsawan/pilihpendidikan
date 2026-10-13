// Shared fixtures of the board-area tests (leaf-2.3). A `.test.ts` file so
// the bun-only fakes never enter the Worker's type program.

import { expect } from "bun:test";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import type {
  FakeClock,
  TestEnv,
  V1Client,
  V1Response,
  V1Session,
} from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import { seedPosting, seedUserJob } from "../../../../test/seed-jobs";
import { trustedScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { decodeRow, jobsDb } from "../../repo/core/db";
import { computeProfileVersion } from "../../repo/core/profile-version";

export interface Fixture {
  alice: V1Session;
  bob: V1Session;
  client: V1Client;
  clock: FakeClock;
  db: JobsDb;
  t: TestEnv;
}

/** A fresh env with two signed-in web users. */
export async function setup(): Promise<Fixture> {
  const t = createTestEnv();
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const alice = await client.browserSession("alice@example.com");
  const bob = await client.browserSession("bob@example.com");
  return { t, clock, client, alice, bob, db: jobsDb(t.env) };
}

export function userIdOf(session: V1Session): string {
  if (!session.userId) {
    throw new Error("session without a user");
  }
  return session.userId;
}

function randomHex(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

/** A user_job in the inbox (state `new`) on a fresh public posting. */
export function inboxJob(
  t: TestEnv,
  session: V1Session,
  posting: Record<string, string | number | null> = {},
  userJob: Record<string, string | number | null> = {}
): { postingId: string; userJobId: string } {
  const p = seedPosting(t.jobsSqlite, {
    fingerprint: `fp1:${randomHex()}`,
    content_hash: randomHex(),
    ...posting,
  });
  const u = seedUserJob(t.jobsSqlite, userIdOf(session), {
    posting_id: p.id,
    inbox_state: "new",
    ...userJob,
  });
  return { postingId: p.id, userJobId: u.id };
}

/** Tracks a fresh inbox job through the route; returns the application. */
export async function trackNew(
  t: TestEnv,
  session: V1Session,
  body: Record<string, unknown> = {},
  posting: Record<string, string | number | null> = {}
): Promise<ApplicationRecord & { posting_id: string }> {
  const job = inboxJob(t, session, posting);
  const res = await session.post<{ application: ApplicationRecord }>(
    "/api/v1/applications",
    { user_job_id: job.userJobId, ...body }
  );
  if (res.status !== 201) {
    throw new Error(`track failed: ${res.status} ${res.text}`);
  }
  return { ...res.body.application, posting_id: job.postingId };
}

/** Moves a card through the route (expects success). */
export async function moveTo(
  session: V1Session,
  app: { id: string; revision: number },
  stage: string,
  neighbours: { after_id?: string; before_id?: string } = {}
): Promise<ApplicationRecord> {
  const res = await session.post<{ application: ApplicationRecord }>(
    `/api/v1/applications/${app.id}/move`,
    { base_revision: app.revision, stage, ...neighbours }
  );
  if (res.status !== 200) {
    throw new Error(`move failed: ${res.status} ${res.text}`);
  }
  return res.body.application;
}

/** The stored application row (API representation). */
export function appRow(t: TestEnv, id: string): ApplicationRecord {
  const row = t.jobsSqlite
    .query("SELECT * FROM applications WHERE id = ?")
    .get(id) as Record<string, unknown> | null;
  if (!row) {
    throw new Error(`no application ${id}`);
  }
  return decodeRow<ApplicationRecord>("applications", row);
}

/** Events of an application in recorded order. */
export function eventRows(
  t: TestEnv,
  applicationId: string
): Record<string, unknown>[] {
  return (
    t.jobsSqlite
      .query(
        "SELECT * FROM application_events WHERE application_id = ? ORDER BY rowid"
      )
      .all(applicationId) as Record<string, unknown>[]
  ).map((row) => decodeRow<Record<string, unknown>>("application_events", row));
}

/** change_log rows of a user in seq order. */
export function changeRows(
  t: TestEnv,
  userId: string
): Array<{
  entity: string;
  entity_id: string;
  op: string;
  revision: number;
  seq: number;
}> {
  return t.jobsSqlite
    .query("SELECT * FROM change_log WHERE user_id = ? ORDER BY seq")
    .all(userId) as Array<{
    entity: string;
    entity_id: string;
    op: string;
    revision: number;
    seq: number;
  }>;
}

/** The caller's current profile_version (what the board's score uses). */
export async function profileVersionOf(
  f: Fixture,
  session: V1Session
): Promise<number> {
  return await computeProfileVersion(
    f.t.env,
    f.db,
    trustedScope(userIdOf(session), "script"),
    { email: session.email }
  );
}

/** Asserts a 409 revision_conflict whose details.current is the record. */
export function expectConflict(
  res: V1Response<Record<string, unknown>>,
  current: { id: string; revision?: number }
): Record<string, unknown> {
  expect(res.status).toBe(409);
  expect(res.body.error).toBe("revision_conflict");
  const details = res.body.details as { current: Record<string, unknown> };
  expect(details.current.id).toBe(current.id);
  if (current.revision !== undefined) {
    expect(details.current.revision).toBe(current.revision);
  }
  return details.current;
}
