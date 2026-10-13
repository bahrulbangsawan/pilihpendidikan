import { describe, expect, it } from "bun:test";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import {
  createCtx,
  createFakeClock,
  createTestEnv,
} from "../../../../test/fakes";
import { seedApplication } from "../../../../test/seed-jobs";
import { runScheduled } from "../../cron/index";

const DAY = 86_400_000;
const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0D";

interface Seed {
  kind?: string;
  status?: string;
  retention_until?: number | null;
  created_at?: number;
}

function setup() {
  const t = createTestEnv();
  const clock = createFakeClock();
  const now = clock.now();
  function seedFile(seed: Seed = {}): { id: string; key: string } {
    const id = newId("fil", now);
    const kind = seed.kind ?? "attachment";
    const key = `u/${USER}/${kind}/${id}.bin`;
    t.jobsSqlite
      .query(
        "INSERT INTO files (id, user_id, kind, r2_key, content_type, size_bytes, sha256, original_name, status, retention_until, created_at) VALUES (?, ?, ?, ?, 'application/pdf', 4, ?, NULL, ?, ?, ?)"
      )
      .run(
        id,
        USER,
        kind,
        key,
        "0".repeat(64),
        seed.status ?? "ready",
        seed.retention_until ?? null,
        seed.created_at ?? now - DAY * 2
      );
    t.r2.objects.set(key, {
      key,
      body: new Uint8Array([1, 2, 3, 4]),
      customMetadata: {},
      etag: "e",
      httpMetadata: {},
      sha256: "0".repeat(64),
      uploaded: new Date(),
      version: "v",
    });
    return { id, key };
  }
  function status(
    id: string
  ): { retention_until: number | null; status: string } | null {
    return t.jobsSqlite
      .query("SELECT status, retention_until FROM files WHERE id = ?")
      .get(id) as { retention_until: number | null; status: string } | null;
  }
  async function run() {
    return await runScheduled({ cron: "0 3 * * *" }, t.env, createCtx(), {
      clock,
    });
  }
  return { t, now, seedFile, status, run };
}

describe("TF-RETENTION daily file retention (14 §5.4)", () => {
  it("TF-RETENTION removes abandoned pending uploads older than 24 h, keeps recent ones", async () => {
    const s = setup();
    const old = s.seedFile({ status: "pending", created_at: s.now - DAY - 1 });
    const fresh = s.seedFile({ status: "pending", created_at: s.now - 1000 });
    const report = await s.run();
    expect(report.failed).toEqual([]);
    expect(s.status(old.id)).toBeNull();
    expect(s.t.r2.objects.has(old.key)).toBe(false);
    expect(s.status(fresh.id)?.status).toBe("pending");
    expect(s.t.r2.objects.has(fresh.key)).toBe(true);
  });

  it("TF-RETENTION deletes expired screenshots and run logs, even when evidence points at them", async () => {
    const s = setup();
    const shot = s.seedFile({
      kind: "evidence_screenshot",
      retention_until: s.now - 1,
    });
    const log = s.seedFile({ kind: "run_log", retention_until: s.now - 1 });
    const live = s.seedFile({ kind: "run_log", retention_until: s.now + DAY });
    const app = seedApplication(s.t.jobsSqlite, USER);
    s.t.jobsSqlite
      .query(
        "INSERT INTO submission_evidence (id, user_id, application_id, kind, verdict, signals, screenshot_file_id, captured_at, recorded_at) VALUES (?, ?, ?, 'browser_confirmation', 'verified', '{}', ?, 0, 0)"
      )
      .run(newId("evd"), USER, app.id, shot.id);
    await s.run();
    // The evidence row keeps pointing at the (now byte-less) record.
    expect(s.status(shot.id)?.status).toBe("deleted");
    expect(s.t.r2.objects.has(shot.key)).toBe(false);
    expect(s.status(log.id)).toBeNull();
    expect(s.status(live.id)?.status).toBe("ready");
    expect(s.t.r2.objects.has(live.key)).toBe(true);
    const ops = s.t.jobsSqlite
      .query("SELECT op FROM change_log WHERE entity_id = ?")
      .all(shot.id) as Array<{ op: string }>;
    expect(ops.map((o) => o.op)).toEqual(["delete"]);
  });

  it("TF-RETENTION starts the 30-day clock of unreferenced PDFs and keeps referenced ones", async () => {
    const s = setup();
    const orphan = s.seedFile({ kind: "cv_pdf" });
    const used = s.seedFile({ kind: "cv_pdf" });
    const emailed = s.seedFile({ kind: "attachment" });
    const app = seedApplication(s.t.jobsSqlite, USER);
    s.t.jobsSqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, application_id, base_cv_id, template, status, file_id, created_at, updated_at) VALUES (?, ?, ?, 'cv', 'basic', 'draft', ?, 0, 0)"
      )
      .run(newId("cvv"), USER, app.id, used.id);
    s.t.jobsSqlite
      .query(
        "INSERT INTO email_applications (id, user_id, application_id, to_address, subject, body_text, attachment_file_ids, delivery, status, created_at, updated_at) VALUES (?, ?, ?, 'hr@example.com', 'Hi', 'Body', ?, 'local_handoff', 'draft', 0, 0)"
      )
      .run(newId("eml"), USER, app.id, JSON.stringify([emailed.id]));
    await s.run();
    expect(s.status(orphan.id)).toEqual({
      status: "ready",
      retention_until: s.now + 30 * DAY,
    });
    expect(s.status(used.id)).toEqual({
      status: "ready",
      retention_until: null,
    });
    expect(s.status(emailed.id)).toEqual({
      status: "ready",
      retention_until: null,
    });
  });

  it("TF-RETENTION an expired PDF referenced again keeps its bytes; an unreferenced one goes", async () => {
    const s = setup();
    const back = s.seedFile({ kind: "cv_pdf", retention_until: s.now - 1 });
    const gone = s.seedFile({ kind: "cv_pdf", retention_until: s.now - 1 });
    const app = seedApplication(s.t.jobsSqlite, USER);
    s.t.jobsSqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, application_id, base_cv_id, template, status, file_id, created_at, updated_at) VALUES (?, ?, ?, 'cv', 'basic', 'approved', ?, 0, 0)"
      )
      .run(newId("cvv"), USER, app.id, back.id);
    await s.run();
    expect(s.status(back.id)).toEqual({
      status: "ready",
      retention_until: null,
    });
    expect(s.t.r2.objects.has(back.key)).toBe(true);
    expect(s.status(gone.id)).toBeNull();
    expect(s.t.r2.objects.has(gone.key)).toBe(false);
  });

  it("TF-RETENTION purges deleted files once nothing references them", async () => {
    const s = setup();
    const free = s.seedFile({ status: "deleted" });
    const held = s.seedFile({ kind: "cv_pdf", status: "deleted" });
    const app = seedApplication(s.t.jobsSqlite, USER);
    s.t.jobsSqlite
      .query(
        "INSERT INTO cv_variants (id, user_id, application_id, base_cv_id, template, status, file_id, created_at, updated_at) VALUES (?, ?, ?, 'cv', 'basic', 'draft', ?, 0, 0)"
      )
      .run(newId("cvv"), USER, app.id, held.id);
    await s.run();
    expect(s.status(free.id)).toBeNull();
    expect(s.t.r2.objects.has(free.key)).toBe(false);
    expect(s.status(held.id)?.status).toBe("deleted");
    expect(s.t.r2.objects.has(held.key)).toBe(true);
  });
});
