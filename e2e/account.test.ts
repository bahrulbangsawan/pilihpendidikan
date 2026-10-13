// Email applications and account deletion (13 §5 S-25, S-33): the local
// hand-off of an approved email through the CLI, and the deletion of an
// account with CLI devices, Job Tracker rows and R2 files.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { scratchDir } from "./harness/env";
import type { Device } from "./harness/lab";
import { Lab } from "./harness/lab";
import { poll } from "./harness/procs";
import type { ApprovalRecord } from "./harness/scenario";
import {
  createApplication,
  decide,
  getApplication,
  pendingApprovals,
} from "./harness/scenario";
import { newKey } from "./harness/users";
import { finishFile } from "./harness/cleanup";

const EMAIL_ID = /^eml_[0-9A-Z]{26}$/;

let lab: Lab;
let device: Device;

beforeAll(async () => {
  lab = await Lab.start({ name: "api-account", noAts: true });
  device = await lab.device("account-laptop");
}, 300_000);

afterAll(async () => {
  await lab?.close();
  finishFile();
});

/** A stand-in for the OS "open" handler: records the file instead of launching Mail. */
function fakeOpener(): { bin: string; log: string } {
  const bin = scratchDir("fake-open-bin");
  const log = join(bin, "opened.log");
  for (const name of ["open", "xdg-open"]) {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\nexit 0\n`);
    chmodSync(path, 0o755);
  }
  return { bin, log };
}

describe("email hand-off and account deletion", () => {
  test("S-25 email application, local hand-off: draft → approve → .eml opened → the user confirms it was sent", async () => {
    const app = await createApplication(lab.user.api, {
      title: "Data Analyst",
      company: "Mail Co",
      stage: "ready",
      mode: "manual",
    });
    // `--yes` ticks "this address belongs to the employer" (09 §1) in a script.
    const draft = await device.cli.ok([
      "--yes",
      "email",
      "draft",
      app.id,
      "--to",
      "careers@mail-co.example.com",
    ]);
    const record = draft.data.email_application as {
      id: string;
      status: string;
      delivery: string;
    };
    const emailId = String(record.id);
    expect(emailId).toMatch(EMAIL_ID);
    expect(record.delivery).toBe("local_handoff");

    // The user approves the exact content on the web (payload_hash bound).
    const approval = await poll(
      "the email approval",
      async () =>
        (
          await pendingApprovals(
            lab.user.api,
            (a: ApprovalRecord) => a.application_id === app.id
          )
        )[0] ?? null,
      { timeoutMs: 30_000 }
    );
    await decide(lab.user.api, approval);

    // `email send` writes the RFC 5322 file and opens it with the OS handler.
    const opener = fakeOpener();
    const sent = await device.cli.ok(["email", "send", emailId], {
      env: { PATH: `${opener.bin}:${process.env.PATH ?? ""}` },
    });
    const emlPath = String(sent.data.eml_path);
    expect(existsSync(emlPath)).toBe(true);
    expect(readFileSync(opener.log, "utf8").trim()).toBe(emlPath);
    const eml = readFileSync(emlPath, "utf8");
    expect(eml).toContain("To: careers@mail-co.example.com");
    expect(eml).toContain("X-Unsent: 1");
    // Non-interactive: nothing is reported as sent until the user says so.
    expect(sent.data.status).toBe("approved");

    const confirmed = await device.cli.ok([
      "email",
      "confirm",
      emailId,
      "--sent",
    ]);
    expect(confirmed.data.status).toBe("handed_off");
    const detail = await getApplication(lab.user.api, app.id);
    const email = detail.emails.find((e) => e.id === emailId) as {
      status: string;
      delivery: string;
    };
    // `handed_off` is final for local_handoff; `sent` is server_send only (09).
    expect(email.status).toBe("handed_off");
    expect(email.delivery).toBe("local_handoff");
    expect(detail.application.submission_status).toBe("submitted_unverified");
    const evidence = detail.evidence.find((e) => e.kind === "email_sent") as {
      verdict: string;
    };
    expect(evidence).toBeDefined();
    expect(evidence.verdict).toBe("unverified");
  }, 300_000);

  test("S-33 account deletion: grants revoked, Job Tracker rows and R2 objects gone, the CLI wipes its local state on the next call", async () => {
    const userId = lab.user.userId;
    // Some R2 content: a PDF attachment of an application.
    const app = await createApplication(lab.user.api, {
      title: "To delete",
      company: "Gone Co",
    });
    const pdf = new TextEncoder().encode(
      "%PDF-1.4\n% e2e attachment\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n"
    );
    const sha = createHash("sha256").update(pdf).digest("hex");
    const form = new FormData();
    form.append(
      "meta",
      new Blob(
        [
          JSON.stringify({
            kind: "attachment",
            sha256: sha,
            content_type: "application/pdf",
            size_bytes: pdf.byteLength,
            original_name: "portfolio.pdf",
            links: { application_id: app.id },
          }),
        ],
        { type: "application/json" }
      )
    );
    form.append(
      "file",
      new Blob([pdf], { type: "application/pdf" }),
      "portfolio.pdf"
    );
    const upload = await fetch(`${lab.api.origin}/api/v1/files`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${lab.user.session}`,
        "idempotency-key": newKey("file"),
      },
      body: form,
    });
    expect(upload.status).toBe(201);
    const owned = () =>
      lab.api.r2Keys().filter((k) => k.startsWith(`u/${userId}/`));
    expect(owned().length).toBeGreaterThan(0);
    // The CLI has synced the account (cache, cursor).
    await device.cli.ok(["sync"]);

    // Delete: request (browser session) → e-mailed link → confirm page → confirm.
    const requested = await lab.user.api.ok<{ status: string }>(
      "POST",
      "/api/v1/account/delete",
      { also_delete_cvs: true },
      { idempotencyKey: newKey("delete") }
    );
    expect(requested.status).toBe("confirmation_sent");
    const mail = await lab.api.waitForMail(lab.user.email);
    await lab.browser.goto(mail.link);
    await lab.browser.waitFor(
      'form[action="/api/v1/account/delete/confirm"] button',
      { timeout: 30_000 }
    );
    await lab.browser.click(
      'form[action="/api/v1/account/delete/confirm"] button'
    );
    await lab.browser.waitForText("deleted", 30_000);

    // Grants and credentials: revoked at once.
    const grants = lab.api.query<{
      revoked_at: number | null;
      revoked_reason: string | null;
    }>(
      "DB",
      "SELECT revoked_at, revoked_reason FROM oauth_grants WHERE user_id = ?",
      userId
    );
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      expect(g.revoked_at).not.toBeNull();
      expect(g.revoked_reason).toBe("account_deleted");
    }
    const me = await lab.user.api.get("/api/v1/me");
    expect(me.status).toBe(401);

    // The purge (queue) removes every JOBS_DB row of the user and the R2 objects.
    const tables = lab.api
      .query<{ name: string }>(
        "JOBS_DB",
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%'"
      )
      .map((t) => t.name)
      .filter((name) =>
        lab.api
          .query<{ name: string }>("JOBS_DB", `PRAGMA table_info(${name})`)
          .some((c) => c.name === "user_id")
      );
    expect(tables.length).toBeGreaterThan(10);
    const remaining = () => {
      const left: string[] = [];
      for (const table of tables) {
        const [row] = lab.api.query<{ n: number }>(
          "JOBS_DB",
          `SELECT count(*) AS n FROM ${table} WHERE user_id = ?`,
          userId
        );
        if (row.n > 0) {
          left.push(`${table}=${row.n}`);
        }
      }
      return left;
    };
    await poll(
      "the purge of the user's rows and files",
      () => Promise.resolve(remaining().length === 0 && owned().length === 0),
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
      }
    );
    expect(remaining()).toEqual([]);
    expect(owned()).toEqual([]);

    // The CLI's next call is refused and it wipes what it kept for the account.
    const whoami = await device.cli.run(["whoami"]);
    expect(whoami.code).toBe(3);
    await device.cli.run(["status"]);
    const state = new Database(join(device.cli.home, "data", "state.db"));
    try {
      state.exec("PRAGMA query_only = 1");
      const count = (table: string) =>
        (
          state.query(`SELECT count(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n;
      expect({
        entity_cache: count("entity_cache"),
        outbox: count("outbox"),
        seen_postings: count("seen_postings"),
      }).toEqual({ entity_cache: 0, outbox: 0, seen_postings: 0 });
    } finally {
      state.close();
    }
    const secrets = join(device.cli.home, "data", "credentials.enc");
    if (existsSync(secrets)) {
      // Only an empty secret map may remain (no refresh or access token).
      const still = await device.cli.run(["whoami"]);
      expect(still.code).toBe(3);
    }
  }, 300_000);
});
