// 05 §10a / 11 §10 account deletion: S-33 end to end and TP-DELETE
// (browser session only, emailed confirmation, revocation + tombstone,
// restartable purge phases over every user-scoped JOBS_DB table, R2 and the
// CV documents, other users untouched).

import { describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { TestEnv, V1Client } from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
  TEST_API_ORIGIN,
} from "../../../../test/fakes";
import {
  seedApplication,
  seedAttempt,
  seedPosting,
  seedTask,
  seedUserJob,
} from "../../../../test/seed-jobs";
import { trustedScope } from "../../core/scope";
import { PURGE_TABLES, purgeUserRows } from "../../repo/account/purge";
import { jobsDb } from "../../repo/core/db";

const T0 = Date.UTC(2026, 9, 1);
const TOKEN_RE = /[?&]token=([A-Za-z0-9_-]+)/;

function insert(
  sqlite: Database,
  table: string,
  row: Record<string, string | number | null>
): void {
  const columns = Object.keys(row);
  sqlite
    .query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    )
    .run(...columns.map((c) => row[c] ?? null));
}

/** One row (or more) in every user-scoped JOBS_DB table, plus R2 objects. */
async function seedEverything(
  t: TestEnv,
  userId: string,
  deviceId: string
): Promise<void> {
  const sqlite = t.jobsSqlite;
  const priv = newId("pst");
  seedPosting(sqlite, {
    id: priv,
    visibility: "private",
    owner_user_id: userId,
    source_kind: "manual",
  });
  const privateJob = seedUserJob(sqlite, userId, { posting_id: priv });
  const app = seedApplication(sqlite, userId, { user_job_id: privateJob.id });
  const publicApp = seedApplication(sqlite, userId);
  const common = { user_id: userId, created_at: T0 };
  insert(sqlite, "application_events", {
    id: newId("evt"),
    user_id: userId,
    application_id: app.id,
    type: "stage_changed",
    actor_kind: "user",
    occurred_at: T0,
    recorded_at: T0,
    idempotency_key: `evt:${userId}`,
  });
  insert(sqlite, "interviews", {
    ...common,
    id: newId("ivw"),
    application_id: app.id,
    kind: "phone_screen",
    updated_at: T0,
  });
  insert(sqlite, "offers", {
    ...common,
    id: newId("ofr"),
    application_id: app.id,
    received_at: T0,
    updated_at: T0,
  });
  insert(sqlite, "email_applications", {
    ...common,
    id: newId("eml"),
    application_id: publicApp.id,
    to_address: "hr@acme.example",
    subject: "Application",
    body_text: "Hello",
    delivery: "local_handoff",
    status: "draft",
    updated_at: T0,
  });
  insert(sqlite, "submission_evidence", {
    id: newId("evd"),
    user_id: userId,
    application_id: app.id,
    kind: "user_attestation",
    verdict: "verified",
    signals: "{}",
    captured_at: T0,
    recorded_at: T0,
  });
  const task = seedTask(sqlite, userId, { application_id: app.id });
  seedAttempt(sqlite, userId, {
    task_id: task.id,
    lease_id: newId("lse"),
    device_id: deviceId,
  });
  insert(sqlite, "approvals", {
    ...common,
    id: newId("apr"),
    kind: "submit",
    task_id: task.id,
    payload: "{}",
    payload_hash: "h",
    expires_at: T0 + 86_400_000,
  });
  insert(sqlite, "cv_variants", {
    ...common,
    id: newId("cvv"),
    application_id: app.id,
    base_cv_id: `${userId.toLowerCase()}-cv`,
    template: "basic",
    status: "draft",
    updated_at: T0,
  });
  insert(sqlite, "match_scores", {
    ...common,
    id: newId("scr"),
    posting_id: priv,
    profile_version: 1,
    rubric_version: "r1",
    model: "deterministic-only",
    score: 50,
    components: "{}",
  });
  insert(sqlite, "automation_rules", {
    ...common,
    id: newId("rul"),
    name: "Rule",
    mode: "approval",
    criteria: "{}",
    limits: "{}",
    updated_at: T0,
  });
  insert(sqlite, "job_sources", {
    ...common,
    id: newId("src"),
    adapter: "greenhouse",
    label: "Acme",
    config: "{}",
    updated_at: T0,
  });
  const runId = newId("run");
  insert(sqlite, "discovery_runs", {
    id: runId,
    user_id: userId,
    device_id: deviceId,
    sources: "[]",
    status: "completed",
    started_at: T0,
    engine_version: "0.1.0",
  });
  insert(sqlite, "discovery_run_items", {
    run_id: runId,
    posting_id: priv,
    user_id: userId,
    outcome: "new",
  });
  insert(sqlite, "ai_usage", {
    user_id: userId,
    month: "2026-10",
    purpose: "score",
  });
  insert(sqlite, "analytics_daily", {
    user_id: userId,
    day: "2026-10-01",
    metrics: "{}",
  });
  const fileId = newId("fil");
  const key = `u/${userId}/cv_pdf/${fileId}.pdf`;
  await t.env.JOBS_FILES.put(key, "%PDF-1.7");
  insert(sqlite, "files", {
    ...common,
    id: fileId,
    kind: "cv_pdf",
    r2_key: key,
    content_type: "application/pdf",
    size_bytes: 8,
    sha256: "0".repeat(64),
    status: "ready",
  });
  await t.env.JOBS_FILES.put(`u/${userId}/evidence_screenshot/x.png`, "png");
}

async function seedViaApi(
  session: Awaited<ReturnType<V1Client["browserSession"]>>
): Promise<void> {
  await session.get("/api/v1/settings");
  await session.put(
    "/api/v1/profile/facts",
    { facts: [{ key: "contact.phone", value: "+62 811 000 111" }] },
    { idempotencyKey: "seed-facts" }
  );
  await session.post("/api/v1/profile/answers", {
    question_key: "notice_period",
    answer: "1 month",
    answer_kind: "text",
    sensitivity: "none",
    auto_use: "always",
  });
}

async function putDoc(
  t: TestEnv,
  kind: "cv" | "job",
  id: string,
  owner: string
): Promise<void> {
  const ns = kind === "cv" ? t.env.CV_KV : t.env.JOBS_KV;
  await ns.put(`${kind}:${id}`, JSON.stringify({ id }));
  await ns.put(`owner:${kind}:${id}`, owner);
}

function count(t: TestEnv, table: string, userId: string): number {
  const column = table === "job_postings" ? "owner_user_id" : "user_id";
  return (
    t.jobsSqlite
      .query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
      .get(userId) as { n: number }
  ).n;
}

async function setup() {
  const t = createTestEnv({}, { flags: { JOBS_AUTOMATION_ENABLED: true } });
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const web = await client.browserSession("alice@example.com");
  const cli = await client.cliSession("alice@example.com");
  const personal = await client.personalToken("alice@example.com");
  const bobWeb = await client.browserSession("bob@example.com");
  const bobCli = await client.cliSession("bob@example.com");
  const aliceId = web.userId as string;
  const bobId = bobWeb.userId as string;
  await seedEverything(t, aliceId, cli.deviceId as string);
  await seedEverything(t, bobId, bobCli.deviceId as string);
  await seedViaApi(web);
  await seedViaApi(bobWeb);
  await putDoc(t, "cv", "alice-cv", "alice@example.com");
  await putDoc(t, "cv", "alice-cv-t-0123456789", "alice@example.com");
  await putDoc(t, "cv", "bob-cv", "bob@example.com");
  await putDoc(t, "job", "alice-legacy", "alice@example.com");
  await putDoc(t, "job", "bob-legacy", "bob@example.com");
  return {
    t,
    clock,
    client,
    web,
    cli,
    personal,
    bobWeb,
    bobCli,
    aliceId,
    bobId,
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function requestDeletion(
  fx: Fixture,
  body: Record<string, unknown> = {}
): Promise<string> {
  const res = await fx.web.post<{
    confirmation_expires_at: number;
    status: string;
  }>("/api/v1/account/delete", body);
  expect(res.status).toBe(202);
  expect(res.body).toEqual({
    status: "confirmation_sent",
    confirmation_expires_at: fx.clock.now() + 3_600_000,
  });
  const mail = fx.t.sent.at(-1);
  expect(mail?.to).toBe("alice@example.com");
  const token = TOKEN_RE.exec(mail?.text ?? "")?.[1];
  if (!token) {
    throw new Error("no confirmation token in the email");
  }
  return token;
}

async function confirm(fx: Fixture, token: string): Promise<Response> {
  return await fx.client.fetch(
    new Request(`${TEST_API_ORIGIN}/api/v1/account/delete/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(token)}`,
    })
  );
}

describe("S-33 account deletion end to end (11 §10)", () => {
  it("S-33 grants revoked, JOBS_DB rows and R2 objects gone, the next CLI call answers 401 revoked_token", async () => {
    const fx = await setup();
    const token = await requestDeletion(fx, { also_delete_cvs: true });
    expect(count(fx.t, "applications", fx.aliceId)).toBe(2);
    const page = await confirm(fx, token);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("being deleted");

    // Every credential of the account is dead at once.
    for (const session of [fx.cli, fx.web, fx.personal]) {
      const res = await session.get("/api/v1/me");
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        error: "invalid_token",
        reason: "revoked_token",
      });
    }
    const grants = fx.t.sqlite
      .query(
        "SELECT revoked_at, revoked_reason FROM oauth_grants WHERE user_id = ?"
      )
      .all(fx.aliceId) as Array<{
      revoked_at: number | null;
      revoked_reason: string;
    }>;
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.every((g) => g.revoked_reason === "account_deleted")).toBe(
      true
    );
    expect(
      fx.t.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM devices WHERE user_id = ? AND revoked_at IS NULL"
        )
        .get(fx.aliceId)
    ).toEqual({ n: 0 });
    expect(
      fx.t.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM mcp_tokens WHERE (user_id = ? OR user_email = ?) AND status = 'active'"
        )
        .get(fx.aliceId, "alice@example.com")
    ).toEqual({ n: 0 });
    expect(
      [...fx.t.kv.AUTH_KV.store.values()].filter((e) =>
        e.value.includes("alice@example.com")
      )
    ).toEqual([]);

    // The purge phases: jobs_db → r2 → cv_kv.
    await fx.t.queue.drain(fx.t.env, { deps: { clock: fx.clock } });
    const phases = fx.t.queue.sent
      .filter((m) => m.body.type === "purge_user")
      .map((m) => (m.body.type === "purge_user" ? m.body.phase : null));
    expect(phases).toEqual(["jobs_db", "r2", "cv_kv"]);
    for (const table of PURGE_TABLES) {
      expect({ table, n: count(fx.t, table, fx.aliceId) }).toEqual({
        table,
        n: 0,
      });
    }
    expect(
      [...fx.t.r2.objects.keys()].filter((k) =>
        k.startsWith(`u/${fx.aliceId}/`)
      )
    ).toEqual([]);
    for (const key of [
      "cv:alice-cv",
      "cv:alice-cv-t-0123456789",
      "job:alice-legacy",
    ]) {
      expect(
        await (key.startsWith("cv:") ? fx.t.env.CV_KV : fx.t.env.JOBS_KV).get(
          key
        )
      ).toBeNull();
    }

    // Bob is untouched.
    for (const table of PURGE_TABLES) {
      expect(count(fx.t, table, fx.bobId)).toBeGreaterThan(0);
    }
    expect(
      [...fx.t.r2.objects.keys()].filter((k) => k.startsWith(`u/${fx.bobId}/`))
    ).toHaveLength(2);
    expect(await fx.t.env.CV_KV.get("cv:bob-cv")).not.toBeNull();
    expect(await fx.t.env.JOBS_KV.get("job:bob-legacy")).not.toBeNull();
    expect((await fx.bobCli.get("/api/v1/me")).status).toBe(200);

    // The tombstone stays until the 30-day hard delete; the record is complete.
    const user = fx.t.sqlite
      .query("SELECT deleted_at FROM users WHERE id = ?")
      .get(fx.aliceId) as { deleted_at: number };
    expect(user.deleted_at).toBe(fx.clock.now());
    const record = JSON.parse(
      new TextDecoder().decode(
        fx.t.r2.objects.get(`account-deletions/${fx.aliceId}.json`)?.body
      )
    );
    expect(record).toMatchObject({
      phases_done: ["jobs_db", "r2", "cv_kv"],
      completed_at: fx.clock.now(),
      also_delete_cvs: true,
    });
  });
});

describe("TP-DELETE account deletion (05 §10a, 11 §10)", () => {
  it("TP-DELETE the request needs a browser session and deletes nothing before the confirmation", async () => {
    const fx = await setup();
    const fromCli = await fx.cli.post("/api/v1/account/delete", {});
    expect(fromCli.status).toBe(403);
    expect(fromCli.body).toMatchObject({ error: "insufficient_scope" });
    const token = await requestDeletion(fx);
    expect(fx.t.sent.at(-1)?.subject).toBe(
      "Confirm deleting your pilihpendidikan account"
    );
    const get = await fx.client.fetch(
      new Request(
        `${TEST_API_ORIGIN}/api/v1/account/delete/confirm?token=${token}`
      )
    );
    expect(get.status).toBe(200);
    const html = await get.text();
    expect(html).toContain('method="post"');
    expect(html).toContain("al••");
    expect(html).not.toContain("alice@example.com");
    expect(get.headers.get("Content-Security-Policy")).toContain("form-action");
    expect((await fx.cli.get("/api/v1/me")).status).toBe(200);
    expect(count(fx.t, "applications", fx.aliceId)).toBe(2);
    expect(fx.t.queue.sent.filter((m) => m.body.type === "purge_user")).toEqual(
      []
    );
  });

  it("TP-DELETE an unknown or used token is refused; a token cannot be replayed", async () => {
    const fx = await setup();
    const bogus = await confirm(fx, "x".repeat(43));
    expect(bogus.status).toBe(410);
    const token = await requestDeletion(fx);
    expect((await confirm(fx, token)).status).toBe(200);
    const replay = await confirm(fx, token);
    expect(replay.status).toBe(410);
    const json = await fx.client.fetch(
      new Request(`${TEST_API_ORIGIN}/api/v1/account/delete/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );
    expect(json.status).toBe(404);
    expect(
      fx.t.queue.sent.filter((m) => m.body.type === "purge_user")
    ).toHaveLength(1);
  });

  it("TP-DELETE base CVs stay unless the user ticked them; tailored variants always go", async () => {
    const fx = await setup();
    const token = await requestDeletion(fx, { also_delete_cvs: false });
    await confirm(fx, token);
    await fx.t.queue.drain(fx.t.env, { deps: { clock: fx.clock } });
    expect(await fx.t.env.CV_KV.get("cv:alice-cv")).not.toBeNull();
    expect(await fx.t.env.CV_KV.get("cv:alice-cv-t-0123456789")).toBeNull();
    expect(
      await fx.t.env.CV_KV.get("owner:cv:alice-cv-t-0123456789")
    ).toBeNull();
    expect(await fx.t.env.JOBS_KV.get("job:alice-legacy")).toBeNull();
  });

  it("TP-DELETE a purge message for a live account does nothing", async () => {
    const fx = await setup();
    await fx.t.env.JOBS_AI_QUEUE.send({
      v: 1,
      type: "purge_user",
      message_id: "forged",
      user_id: fx.aliceId,
      phase: "jobs_db",
    });
    await fx.t.queue.drain(fx.t.env, { deps: { clock: fx.clock } });
    expect(count(fx.t, "applications", fx.aliceId)).toBe(2);
    expect((await fx.cli.get("/api/v1/me")).status).toBe(200);
    expect(
      [...fx.t.r2.objects.keys()].filter((k) =>
        k.startsWith(`u/${fx.aliceId}/`)
      )
    ).toHaveLength(2);
  });

  it("TP-DELETE the JOBS_DB purge is chunked, restartable and FK-safe", async () => {
    const fx = await setup();
    fx.t.jobsSqlite.exec("PRAGMA foreign_keys = ON");
    const scope = trustedScope(fx.aliceId, "script");
    const db = jobsDb(fx.t.env);
    const first = await purgeUserRows(db, scope, {
      chunk: 1,
      maxStatements: 4,
    });
    expect(first.done).toBe(false);
    expect(first.statements).toBe(4);
    let progress = first;
    let rounds = 0;
    while (!progress.done) {
      progress = await purgeUserRows(db, scope, { chunk: 1, maxStatements: 4 });
      rounds += 1;
      expect(rounds).toBeLessThan(50);
    }
    for (const table of PURGE_TABLES) {
      expect(count(fx.t, table, fx.aliceId)).toBe(0);
    }
    expect(count(fx.t, "applications", fx.bobId)).toBe(2);
    const shared = fx.t.jobsSqlite
      .query(
        "SELECT COUNT(*) AS n FROM job_postings WHERE visibility = 'public'"
      )
      .get() as { n: number };
    expect(shared.n).toBeGreaterThan(0);
  });

  it("TP-DELETE the confirmation email follows the user's locale", async () => {
    const fx = await setup();
    await fx.web.patch("/api/v1/settings", { base_revision: 1, locale: "id" });
    await requestDeletion(fx);
    expect(fx.t.sent.at(-1)?.subject).toBe(
      "Konfirmasi penghapusan akun pilihpendidikan Anda"
    );
  });
});
