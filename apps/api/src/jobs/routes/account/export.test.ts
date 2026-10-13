// 05 §10a / 11 §10 account export: TP-EXPORT (browser session only, one ZIP
// of every JOBS_DB row + CV documents + R2 files, the link emailed once,
// the download behind a session and valid 24 h, nothing of other users).

import { describe, expect, it } from "bun:test";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { TestEnv } from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import { seedApplication } from "../../../../test/seed-jobs";
import { EXPORT_TABLES } from "../../repo/account/export";
import { crc32 } from "../../services/account/zip";

const decoder = new TextDecoder();
const EXPORT_ID_RE = /^exp_[0-9A-Z]{26}$/;

/** Minimal STORED-zip reader (central directory first, CRC checked). */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06_05_4b_50) {
    end -= 1;
  }
  expect(end).toBeGreaterThanOrEqual(0);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02_01_4b_50);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength)
    );
    expect(view.getUint32(local, true)).toBe(0x04_03_4b_50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.slice(start, start + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    offset += 46 + nameLength;
  }
  return out;
}

function json<T = unknown>(entries: Map<string, Uint8Array>, name: string): T {
  const data = entries.get(name);
  if (!data) {
    throw new Error(`missing ${name}`);
  }
  return JSON.parse(decoder.decode(data)) as T;
}

async function putDoc(
  t: TestEnv,
  kind: "cv" | "job",
  id: string,
  owner: string,
  doc: Record<string, unknown>
): Promise<void> {
  const ns = kind === "cv" ? t.env.CV_KV : t.env.JOBS_KV;
  await ns.put(`${kind}:${id}`, JSON.stringify(doc));
  await ns.put(`owner:${kind}:${id}`, owner);
}

const PDF = new TextEncoder().encode("%PDF-1.7\nalice cv\n%%EOF\n");

async function seedFile(t: TestEnv, userId: string): Promise<string> {
  const id = newId("fil");
  const key = `u/${userId}/cv_pdf/${id}.pdf`;
  await t.env.JOBS_FILES.put(key, PDF);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", PDF));
  const sha = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  t.jobsSqlite
    .query(
      "INSERT INTO files (id, user_id, kind, r2_key, content_type, size_bytes, sha256, status, created_at) VALUES (?, ?, 'cv_pdf', ?, 'application/pdf', ?, ?, 'ready', ?)"
    )
    .run(id, userId, key, PDF.length, sha, Date.UTC(2026, 9, 1));
  return id;
}

async function setup() {
  const t = createTestEnv();
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const alice = await client.browserSession("alice@example.com");
  const bob = await client.browserSession("bob@example.com");
  const aliceId = alice.userId as string;
  const bobId = bob.userId as string;
  const app = seedApplication(t.jobsSqlite, aliceId, { stage: "applied" });
  const bobApp = seedApplication(t.jobsSqlite, bobId);
  await alice.put("/api/v1/profile/facts", {
    facts: [{ key: "contact.phone", value: "+62 811 000 111" }],
  });
  await bob.put("/api/v1/profile/facts", {
    facts: [{ key: "contact.phone", value: "+62 899 999 999" }],
  });
  const fileId = await seedFile(t, aliceId);
  await putDoc(t, "cv", "alice-cv", "alice@example.com", { personalInfo: {} });
  await putDoc(t, "cv", "alice-cv-t-0123456789", "alice@example.com", {
    personalInfo: {},
    visibility: "private",
  });
  await putDoc(t, "cv", "bob-cv", "bob@example.com", { personalInfo: {} });
  await putDoc(t, "job", "legacy-1", "alice@example.com", { title: "Old" });
  return { t, clock, client, alice, bob, aliceId, bobId, app, bobApp, fileId };
}

async function startExport(fx: Awaited<ReturnType<typeof setup>>) {
  const res = await fx.alice.post<{ export_id: string; status: string }>(
    "/api/v1/account/export"
  );
  expect(res.status).toBe(202);
  await fx.t.queue.drain(fx.t.env, { deps: { clock: fx.clock } });
  return res.body.export_id;
}

function zipOf(t: TestEnv, userId: string, exportId: string): Uint8Array {
  const stored = t.r2.objects.get(`u/${userId}/export/${exportId}.zip`);
  if (!stored) {
    throw new Error("export zip missing");
  }
  return stored.body;
}

describe("TP-EXPORT account export (05 §10a, 11 §10)", () => {
  it("TP-EXPORT is refused to CLI, MCP and personal tokens (browser session only)", async () => {
    const fx = await setup();
    const cli = await fx.client.cliSession("alice@example.com");
    const personal = await fx.client.personalToken("alice@example.com");
    const mcp = await fx.client.mcpOAuthToken("alice@example.com");
    for (const session of [cli, personal, mcp]) {
      const res = await session.post("/api/v1/account/export");
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        error: "insufficient_scope",
        details: { required_credential: "browser_session" },
      });
    }
    expect(
      fx.t.queue.sent.filter((m) => m.body.type === "export_user")
    ).toEqual([]);
  });

  it("TP-EXPORT builds one zip with every JOBS_DB table, the CVs, legacy jobs and R2 files", async () => {
    const fx = await setup();
    const exportId = await startExport(fx);
    expect(exportId).toMatch(EXPORT_ID_RE);
    const entries = readZip(zipOf(fx.t, fx.aliceId, exportId));
    for (const table of [...EXPORT_TABLES, "job_postings"]) {
      expect(entries.has(`data/${table}.json`)).toBe(true);
    }
    expect(entries.has("README.txt")).toBe(true);
    const apps = json<Array<{ id: string; user_id: string }>>(
      entries,
      "data/applications.json"
    );
    expect(apps.map((a) => a.id)).toEqual([fx.app.id]);
    const facts = json<Array<{ key: string; value: unknown }>>(
      entries,
      "data/applicant_facts.json"
    );
    expect(facts).toEqual([
      expect.objectContaining({
        key: "contact.phone",
        value: "+62 811 000 111",
      }),
    ]);
    const postings = json<Array<{ id: string }>>(
      entries,
      "data/job_postings.json"
    );
    expect(postings.map((p) => p.id)).toEqual([fx.app.posting_id]);
    expect(entries.has("cvs/alice-cv.json")).toBe(true);
    expect(entries.has("cvs/alice-cv-t-0123456789.json")).toBe(true);
    expect(entries.has("cvs/bob-cv.json")).toBe(false);
    expect(entries.has("legacy-jobs/legacy-1.json")).toBe(true);
    expect(entries.get(`files/cv_pdf/${fx.fileId}.pdf`)).toEqual(PDF);
    const account = json<{
      devices: unknown[];
      tokens: Record<string, unknown>[];
      user: { email: string; id: string };
    }>(entries, "account.json");
    expect(account.user).toMatchObject({
      id: fx.aliceId,
      email: "alice@example.com",
    });
    for (const token of account.tokens) {
      expect(Object.keys(token)).not.toContain("token_hash");
    }
    const manifest = json<{ files: number; tables: Record<string, number> }>(
      entries,
      "manifest.json"
    );
    expect(manifest.tables.applications).toBe(1);
    expect(manifest.files).toBe(1);
    const everything = decoder.decode(zipOf(fx.t, fx.aliceId, exportId));
    expect(everything).not.toContain(fx.bobId);
    expect(everything).not.toContain("bob@example.com");
    expect(everything).not.toContain(fx.bobApp.id);
  });

  it("TP-EXPORT emails the download link once, even when the message is redelivered", async () => {
    const fx = await setup();
    const exportId = await startExport(fx);
    const mails = fx.t.sent.filter((m) => m.subject.includes("export"));
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe("alice@example.com");
    const link = `http://localhost:4007/download/account/exports/${exportId}`;
    expect(mails[0]?.text).toContain(link);
    expect(mails[0]?.html).toContain(link);
    await fx.t.env.JOBS_AI_QUEUE.send({
      v: 1,
      type: "export_user",
      message_id: "redelivery",
      user_id: fx.aliceId,
      export_id: exportId,
    });
    await fx.t.queue.drain(fx.t.env, { deps: { clock: fx.clock } });
    expect(fx.t.sent.filter((m) => m.subject.includes("export"))).toHaveLength(
      1
    );
    const record = JSON.parse(
      decoder.decode(
        fx.t.r2.objects.get(`u/${fx.aliceId}/export/${exportId}.json`)?.body
      )
    );
    expect(record).toMatchObject({
      status: "ready",
      ready_at: fx.clock.now(),
      expires_at: fx.clock.now() + 86_400_000,
      emailed_at: fx.clock.now(),
    });
  });

  it("TP-EXPORT a failed email send is retried and then sent once", async () => {
    const fx = await setup();
    let failures = 1;
    const send = fx.t.env.EMAIL.send.bind(fx.t.env.EMAIL);
    fx.t.env.EMAIL = {
      send: (message: Parameters<SendEmail["send"]>[0]) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error("smtp down"));
        }
        return send(message);
      },
    } as unknown as SendEmail;
    const res = await fx.alice.post<{ export_id: string }>(
      "/api/v1/account/export"
    );
    const report = await fx.t.queue.drain(fx.t.env, {
      deps: { clock: fx.clock },
    });
    expect(report.retried).toBe(1);
    expect(fx.t.sent.filter((m) => m.subject.includes("export"))).toHaveLength(
      1
    );
    expect(
      fx.t.r2.objects.has(`u/${fx.aliceId}/export/${res.body.export_id}.zip`)
    ).toBe(true);
  });

  it("TP-EXPORT the download needs the owner's browser session and expires after 24 h", async () => {
    const fx = await setup();
    const exportId = await startExport(fx);
    const path = `/api/v1/account/exports/${exportId}`;
    const ok = await fx.alice.get(path);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("application/zip");
    expect(ok.headers.get("Content-Disposition")).toContain("attachment");
    const bytes = new Uint8Array(await ok.response.arrayBuffer());
    expect(Buffer.from(bytes).equals(zipOf(fx.t, fx.aliceId, exportId))).toBe(
      true
    );
    const cli = await fx.client.cliSession("alice@example.com");
    expect((await cli.get(path)).status).toBe(403);
    expect((await fx.bob.get(path)).status).toBe(404);
    expect(
      (await fx.alice.get("/api/v1/account/exports/exp_nope")).status
    ).toBe(404);
    fx.clock.advance(86_400_001);
    const expired = await fx.alice.get(path);
    expect(expired.status).toBe(404);
  });

  it("TP-EXPORT a pending export cannot be downloaded and a tombstoned account's export fails", async () => {
    const fx = await setup();
    const res = await fx.alice.post<{ export_id: string }>(
      "/api/v1/account/export"
    );
    const path = `/api/v1/account/exports/${res.body.export_id}`;
    expect((await fx.alice.get(path)).status).toBe(404);
    fx.t.sqlite
      .query("UPDATE users SET deleted_at = ? WHERE id = ?")
      .run(fx.clock.now(), fx.aliceId);
    await fx.t.queue.drain(fx.t.env, { deps: { clock: fx.clock } });
    const record = JSON.parse(
      decoder.decode(
        fx.t.r2.objects.get(`u/${fx.aliceId}/export/${res.body.export_id}.json`)
          ?.body
      )
    );
    expect(record).toMatchObject({
      status: "failed",
      error: "account_deleted",
    });
    expect(
      fx.t.r2.objects.has(`u/${fx.aliceId}/export/${res.body.export_id}.zip`)
    ).toBe(false);
    expect(fx.t.sent.filter((m) => m.subject.includes("export"))).toEqual([]);
  });

  it("TP-EXPORT a forged message for another user's export id does nothing", async () => {
    const fx = await setup();
    const res = await fx.alice.post<{ export_id: string }>(
      "/api/v1/account/export"
    );
    // A message naming Bob with Alice's export id finds no record of Bob's.
    await fx.t.env.JOBS_AI_QUEUE.send({
      v: 1,
      type: "export_user",
      message_id: "forged",
      user_id: fx.bobId,
      export_id: res.body.export_id,
    });
    await fx.t.queue.drain(fx.t.env, { deps: { clock: fx.clock } });
    expect(
      [...fx.t.r2.objects.keys()].some((k) => k.startsWith(`u/${fx.bobId}/`))
    ).toBe(false);
    expect(fx.t.sent.filter((m) => m.to === "bob@example.com")).toEqual([]);
  });
});
