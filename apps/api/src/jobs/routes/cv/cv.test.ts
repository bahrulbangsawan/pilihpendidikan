import { describe, expect, it } from "bun:test";
import type { CvVariantRecord } from "@pilihpendidikan/jobs-contracts/records";
import { rowsOf } from "../../../../test/seed-jobs";
import {
  createCvDocument,
  cvCanonicalSha256,
} from "../../../documents/cv-create";
import type { UserScope } from "../../core/scope";
import { runScheduled } from "../../cron/index";
import { jobsDb } from "../../repo/core/db";
import { createCtx } from "../../../../test/fakes";
import {
  cvVariantPayloadHash,
  failCvVariant,
  planCvVariantApprovalDecision,
  planPurgeApplicationCvVariants,
  tailorCvMessage,
} from "../../services/cv";
import { tailoredCvSlug } from "../../services/cv/slug";
import {
  baitedPatch,
  BASE_CV_ID,
  honestPatch,
  keepPatch,
  pdfBytes,
  sampleCv,
  sha256Of,
} from "../../services/cv/tailoring/fixtures";
import type { Harness } from "./harness.test";
import {
  createVariant,
  EMAIL,
  harness,
  OTHER_EMAIL,
  renderVariant,
  uploadFile,
  variantRow,
} from "./harness.test";

const SLUG_RE = /^rahma-cv-t-[0-9a-hjkmnp-tv-z]{10}$/;
const TWO_MINUTES = 120_000;

function variantPath(id: string): string {
  return `/api/v1/cv-variants/${id}`;
}

function kvJson(h: Harness, key: string): Record<string, unknown> | null {
  const value = h.t.kv.CV_KV.store.get(key)?.value;
  return value ? (JSON.parse(value) as Record<string, unknown>) : null;
}

function appRow(h: Harness): Record<string, unknown> {
  return h.t.jobsSqlite
    .query("SELECT * FROM applications WHERE id = ?")
    .get(h.app.id) as Record<string, unknown>;
}

function eventTypes(h: Harness): string[] {
  return (
    h.t.jobsSqlite
      .query(
        "SELECT type FROM application_events WHERE application_id = ? ORDER BY recorded_at, rowid"
      )
      .all(h.app.id) as Array<{ type: string }>
  ).map((r) => r.type);
}

function approvals(h: Harness): Record<string, unknown>[] {
  return rowsOf(h.t.jobsSqlite, "approvals", h.userId);
}

async function issueTicket(
  h: Harness,
  cvvId: string
): Promise<{ ticket: string; url: string; expires_in: number }> {
  const res = await h.web.post<{
    ticket: string;
    url: string;
    expires_in: number;
  }>(`${variantPath(cvvId)}/render-ticket`);
  expect(res.status).toBe(200);
  return res.body;
}

function seedAutoRule(
  h: Harness,
  cvPolicy: Record<string, unknown>,
  mode = "auto"
): string {
  const id = "rul_01JA6V8M3W8Z1T6Q4Y2B7K9C0D";
  h.t.jobsSqlite
    .query(
      "INSERT INTO automation_rules (id, user_id, name, enabled, mode, criteria, limits, allowed_domains, cv_policy, activated_approval_id, revision, created_at, updated_at) VALUES (?, ?, 'Auto', 1, ?, '{}', '{}', '[\"globex.com\"]', ?, 'apr_01JA6V8M3W8Z1T6Q4Y2B7K9C0D', 1, 0, 0)"
    )
    .run(id, h.userId, mode, JSON.stringify(cvPolicy));
  h.t.jobsSqlite
    .query("UPDATE applications SET automation_rule_id = ? WHERE id = ?")
    .run(id, h.app.id);
  return id;
}

describe("TCV-LIST GET /api/v1/cvs", () => {
  it("TCV-LIST lists the caller's own CVs from the owner stamps, tailored ones marked", async () => {
    const h = await harness();
    const tailored = { ...sampleCv(), visibility: "private" as const };
    await createCvDocument(
      h.t.env,
      { email: EMAIL },
      "rahma-cv-t-abcdefghjk",
      tailored
    );
    await createCvDocument(
      h.t.env,
      { email: OTHER_EMAIL },
      "budi-cv",
      sampleCv()
    );
    const res = await h.web.get<{
      items: Record<string, unknown>[];
      next_cursor: string | null;
    }>("/api/v1/cvs");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        id: "rahma-cv",
        full_name: "Rahma Putri",
        job_title: "Backend Engineer",
        visibility: "public",
        is_tailored: false,
      },
      {
        id: "rahma-cv-t-abcdefghjk",
        full_name: "Rahma Putri",
        job_title: "Backend Engineer",
        visibility: "private",
        is_tailored: true,
      },
    ]);
    expect(res.body.next_cursor).toBeNull();
    const budi = await h.client.browserSession(OTHER_EMAIL);
    const theirs = await budi.get<{ items: Array<{ id: string }> }>(
      "/api/v1/cvs"
    );
    expect(theirs.body.items.map((i) => i.id)).toEqual(["budi-cv"]);
  });

  it("TCV-LIST paginates by id and accepts read tokens; no admin bypass", async () => {
    const h = await harness();
    await createCvDocument(h.t.env, { email: EMAIL }, "rahma-cv-2", sampleCv());
    const first = await h.web.get<{
      items: Array<{ id: string }>;
      next_cursor: string;
    }>("/api/v1/cvs", {
      query: { limit: 1 },
    });
    expect(first.body.items.map((i) => i.id)).toEqual(["rahma-cv"]);
    const second = await h.web.get<{
      items: Array<{ id: string }>;
      next_cursor: string | null;
    }>("/api/v1/cvs", {
      query: { limit: 1, cursor: first.body.next_cursor },
    });
    expect(second.body.items.map((i) => i.id)).toEqual(["rahma-cv-2"]);
    expect(second.body.next_cursor).toBeNull();
    const reader = await h.client.personalToken(EMAIL, "read");
    expect((await reader.get("/api/v1/cvs")).status).toBe(200);
    const admin = await h.client.browserSession("admin@example.com");
    expect(
      (await admin.get<{ items: unknown[] }>("/api/v1/cvs")).body.items
    ).toEqual([]);
    expect((await h.client.anonymous().get("/api/v1/cvs")).status).toBe(401);
  });
});

describe("POST /api/v1/applications/{app_id}/cv-variants", () => {
  it("creates a generating variant, moves saved → preparing (system) and enqueues tailor_cv", async () => {
    const h = await harness();
    const res = await h.web.post<{ cv_variant: CvVariantRecord }>(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      { base_cv_id: BASE_CV_ID, template: "harvard", tailor: true },
      { idempotencyKey: "create-1" }
    );
    expect(res.status).toBe(202);
    expect(res.body.cv_variant).toMatchObject({
      status: "generating",
      application_id: h.app.id,
      base_cv_id: BASE_CV_ID,
      template: "harvard",
      tailored_cv_id: null,
      revision: 1,
    });
    const app = appRow(h);
    expect(app.stage).toBe("preparing");
    expect(app.base_cv_id).toBe(BASE_CV_ID);
    const stage = h.t.jobsSqlite
      .query(
        "SELECT actor_kind, payload FROM application_events WHERE application_id = ? AND type = 'stage_changed'"
      )
      .get(h.app.id) as { actor_kind: string; payload: string };
    expect(stage.actor_kind).toBe("system");
    expect(h.t.queue.sent.map((m) => m.body)).toEqual([
      tailorCvMessage(h.userId, res.body.cv_variant.id),
    ]);
    // A replay answers the stored 202 without a second message.
    const replay = await h.web.post(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      { base_cv_id: BASE_CV_ID, template: "harvard", tailor: true },
      { idempotencyKey: "create-1" }
    );
    expect(replay.status).toBe(202);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(h.t.queue.sent).toHaveLength(1);
  });

  it("needs ai:invoke only when tailoring (copy-only variants make no AI call)", async () => {
    const h = await harness();
    const token = await h.client.personalToken(EMAIL, "write");
    const tailored = await token.post(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      {
        base_cv_id: BASE_CV_ID,
        template: "basic",
        tailor: true,
      }
    );
    expect(tailored.status).toBe(403);
    expect(tailored.body).toMatchObject({
      error: "insufficient_scope",
      scope: "ai:invoke",
    });
    const copy = await token.post(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      {
        base_cv_id: BASE_CV_ID,
        template: "basic",
        tailor: false,
      }
    );
    expect(copy.status).toBe(202);
    const reader = await h.client.personalToken(EMAIL, "read");
    expect(
      (
        await reader.post(`/api/v1/applications/${h.app.id}/cv-variants`, {
          base_cv_id: BASE_CV_ID,
          template: "basic",
          tailor: false,
        })
      ).status
    ).toBe(403);
  });

  it("refuses another user's base CV or application (404), missing consent (422) and a spent budget (429)", async () => {
    const h = await harness();
    await createCvDocument(
      h.t.env,
      { email: OTHER_EMAIL },
      "budi-cv",
      sampleCv()
    );
    const foreignCv = await h.web.post(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      {
        base_cv_id: "budi-cv",
        template: "basic",
        tailor: true,
      }
    );
    expect(foreignCv.status).toBe(404);
    const budi = await h.client.browserSession(OTHER_EMAIL);
    const foreignApp = await budi.post(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      {
        base_cv_id: "budi-cv",
        template: "basic",
        tailor: false,
      }
    );
    expect(foreignApp.status).toBe(404);
    h.t.jobsSqlite
      .query("UPDATE user_settings SET ai_consent_at = NULL WHERE user_id = ?")
      .run(h.userId);
    const noConsent = await h.web.post(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      {
        base_cv_id: BASE_CV_ID,
        template: "basic",
        tailor: true,
      }
    );
    expect(noConsent.status).toBe(422);
    expect(noConsent.body).toMatchObject({
      details: { reason: "ai_consent_required" },
    });
    h.t.jobsSqlite
      .query("UPDATE user_settings SET ai_consent_at = 1 WHERE user_id = ?")
      .run(h.userId);
    h.t.jobsSqlite
      .query(
        "INSERT INTO ai_usage (user_id, month, purpose, input_tokens, output_tokens, cost_micro_usd, calls) VALUES (?, '2026-10', 'score', 0, 0, 3000000, 1)"
      )
      .run(h.userId);
    const broke = await h.web.post(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      {
        base_cv_id: BASE_CV_ID,
        template: "basic",
        tailor: true,
      }
    );
    expect(broke.status).toBe(429);
    expect(broke.body).toMatchObject({ error: "ai_budget_exhausted" });
    expect(rowsOf(h.t.jobsSqlite, "cv_variants", h.userId)).toEqual([]);
  });

  it("re-tailoring rejects the in-flight draft and expires its approval (08 §10)", async () => {
    const h = await harness();
    const first = await createVariant(h, { tailor: false });
    expect((await renderVariant(h, first)).status).toBe(201);
    expect(approvals(h).map((a) => a.state)).toEqual(["pending"]);
    const second = await createVariant(h, { tailor: false });
    expect(variantRow(h.t.jobsSqlite, first).status).toBe("rejected");
    expect(variantRow(h.t.jobsSqlite, second).status).toBe("generating");
    expect(approvals(h).map((a) => a.state)).toEqual(["expired"]);
  });
});

describe("tailor_cv consumer (08 §4)", () => {
  it("tailors into a private, photo-free document under a deterministic HMAC slug", async () => {
    const h = await harness({ script: [{ patch: honestPatch() }] });
    const id = await createVariant(h);
    const variant = variantRow(h.t.jobsSqlite, id);
    expect(variant.status).toBe("generating");
    expect(variant.tailored_cv_id).toMatch(SLUG_RE);
    expect(variant.tailored_cv_id).toBe(
      await tailoredCvSlug(h.t.env, BASE_CV_ID, id)
    );
    expect(variant.model).toBe("gpt-6.1-sol");
    const diff = variant.diff as Record<string, unknown>;
    expect(diff.prompt_version).toBe("tailor-prompt-v1");
    expect(diff.notes_for_user).toEqual([
      "The posting asks for Kubernetes, which is not in your CV.",
    ]);
    const doc = kvJson(h, `cv:${variant.tailored_cv_id}`);
    expect(doc?.visibility).toBe("private");
    expect(doc?.style).toBe("harvard");
    expect((doc?.personalInfo as Record<string, unknown>).photoUrl).toBe("");
    expect(
      h.t.kv.CV_KV.store.get(`owner:cv:${variant.tailored_cv_id}`)?.value
    ).toBe(EMAIL);
    expect(diff.tailored_cv_sha256).toBe(await cvCanonicalSha256(doc));
    const usage = h.t.jobsSqlite
      .query("SELECT purpose, calls FROM ai_usage WHERE user_id = ?")
      .all(h.userId);
    expect(usage).toEqual([{ purpose: "tailor_cv", calls: 1 }]);
    // The model never saw contact details or the photo.
    expect(h.ai.inputs[0]).not.toContain("rahma@example.com");
    expect(h.ai.inputs[0]).toContain("<<UNTRUSTED_POSTING>>");
  });

  it("is idempotent per variant: a redelivery after a crash rewrites the same document", async () => {
    const h = await harness({
      script: [{ patch: keepPatch() }, { patch: keepPatch() }],
    });
    const id = await createVariant(h);
    const slug = variantRow(h.t.jobsSqlite, id).tailored_cv_id as string;
    // Simulate a crash between the KV write and the final D1 update.
    h.t.jobsSqlite
      .query("UPDATE cv_variants SET tailored_cv_id = NULL WHERE id = ?")
      .run(id);
    await h.t.env.JOBS_AI_QUEUE.send(tailorCvMessage(h.userId, id));
    await h.drain();
    expect(variantRow(h.t.jobsSqlite, id).tailored_cv_id).toBe(slug);
    const docs = [...h.t.kv.CV_KV.store.keys()].filter((k) =>
      k.startsWith("cv:rahma-cv-t-")
    );
    expect(docs).toEqual([`cv:${slug}`]);
    // A message for a finished variant changes nothing.
    const before = variantRow(h.t.jobsSqlite, id).revision;
    await h.t.env.JOBS_AI_QUEUE.send(tailorCvMessage(h.userId, id));
    await h.drain();
    expect(variantRow(h.t.jobsSqlite, id).revision).toBe(before);
  });

  it("repairs a patch with hard violations once, then fails a second bad patch", async () => {
    const bad = keepPatch({
      include_entries: [{ section: "experience", entry_id: "exp-404" }],
    });
    const repaired = await harness({
      script: [{ patch: bad }, { patch: honestPatch() }],
    });
    const ok = await createVariant(repaired);
    expect(variantRow(repaired.t.jobsSqlite, ok).tailored_cv_id).toMatch(
      SLUG_RE
    );
    expect(repaired.ai.inputs).toHaveLength(2);
    expect(repaired.ai.inputs[1]).toContain("<<VALIDATOR>>");
    expect(repaired.ai.inputs[1]).toContain("exp-404");
    expect(
      repaired.t.jobsSqlite
        .query("SELECT calls FROM ai_usage WHERE user_id = ?")
        .get(repaired.userId)
    ).toEqual({ calls: 2 });

    const twice = await harness({ script: [{ patch: bad }, { patch: bad }] });
    const failed = await createVariant(twice);
    const row = variantRow(twice.t.jobsSqlite, failed);
    expect(row.status).toBe("failed");
    const violations = (row.diff as { validator: { violations: string[] } })
      .validator.violations;
    expect(violations[0]).toBe("failed: validation_failed");
    expect(violations.some((v) => v.startsWith("V1:"))).toBe(true);
    expect(
      [...twice.t.kv.CV_KV.store.keys()].some((k) => k.includes("-t-"))
    ).toBe(false);
  });

  it("fails on a refusal or a missing base CV; retries provider outages", async () => {
    const refused = await harness({ script: [{ refusal: "no" }] });
    const r = await createVariant(refused);
    expect(variantRow(refused.t.jobsSqlite, r).status).toBe("failed");

    const gone = await harness();
    const res = await gone.web.post<{ cv_variant: { id: string } }>(
      `/api/v1/applications/${gone.app.id}/cv-variants`,
      { base_cv_id: BASE_CV_ID, template: "basic", tailor: true }
    );
    gone.t.kv.CV_KV.store.delete(`cv:${BASE_CV_ID}`);
    await gone.drain();
    const goneRow = variantRow(gone.t.jobsSqlite, res.body.cv_variant.id);
    expect(goneRow.status).toBe("failed");
    expect(
      (goneRow.diff as { validator: { violations: string[] } }).validator
        .violations[0]
    ).toBe("failed: base_cv_not_found");

    const outage = await harness({ script: [{ error: "rate_limited" }] });
    const o = await createVariant(outage);
    expect(outage.t.queue.retries.length).toBeGreaterThan(0);
    expect(variantRow(outage.t.jobsSqlite, o).tailored_cv_id).toMatch(SLUG_RE);
  });

  it("S-10 a fabrication-bait job: no new skill, employer or date survives into the CV", async () => {
    const h = await harness({ script: [{ patch: baitedPatch() }] });
    const id = await createVariant(h);
    const variant = variantRow(h.t.jobsSqlite, id);
    expect(variant.status).toBe("generating");
    const doc = kvJson(h, `cv:${variant.tailored_cv_id}`);
    const text = JSON.stringify(doc);
    for (const bait of [
      "Kubernetes",
      "Google",
      "MIT",
      "PhD",
      "2015",
      "30%",
      "Globex",
    ]) {
      expect(text.toLowerCase()).not.toContain(bait.toLowerCase());
    }
    const diff = variant.diff as {
      validator: { fallbacks_to_keep: number };
      summary: unknown;
    };
    expect(diff.validator.fallbacks_to_keep).toBe(3);
    expect(diff.summary).toBeNull();
    expect(doc?.summary).toBe(sampleCv().summary);
    // The prompt carried the posting fenced as untrusted data.
    expect(h.ai.inputs[0]).toContain("ignore all previous instructions");
    expect(h.ai.inputs[0].indexOf("<<UNTRUSTED_POSTING>>")).toBeLessThan(
      h.ai.inputs[0].indexOf("ignore all previous instructions")
    );
  });
});

describe("T8-08 render tickets", () => {
  it("T8-08 a ticket reads the variant's CVData once, then 401", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    const issued = await issueTicket(h, id);
    expect(issued.expires_in).toBe(120);
    expect(issued.url).toBe(
      `http://localhost:4007/render/cv/${id}?ticket=${encodeURIComponent(issued.ticket)}`
    );
    const anon = h.client.anonymous();
    const headers = { "X-Render-Ticket": issued.ticket };
    const read = await anon.get<{
      tailored_cv: Record<string, unknown>;
      cv_variant: { template: string };
    }>(variantPath(id), { headers, query: { include: "cv_data" } });
    expect(read.status).toBe(200);
    expect(read.body.cv_variant.template).toBe("harvard");
    expect(read.body.tailored_cv.visibility).toBe("private");
    expect(read.headers.get("Referrer-Policy")).toBe("no-referrer");
    const again = await anon.get(variantPath(id), {
      headers,
      query: { include: "cv_data" },
    });
    expect(again.status).toBe(401);
    expect(again.body).toMatchObject({ error: "invalid_token" });
  });

  it("T8-08 a ticket is scoped to one variant, one route shape and 120 s", async () => {
    const h = await harness();
    const a = await createVariant(h, { tailor: false });
    const ticket = (await issueTicket(h, a)).ticket;
    const headers = { "X-Render-Ticket": ticket };
    const anon = h.client.anonymous();
    // Without include=cv_data the ticket is not valid.
    expect((await anon.get(variantPath(a), { headers })).status).toBe(401);
    // Another variant id.
    const other = await harness();
    const b = await createVariant(other, { tailor: false });
    const t2 = (await issueTicket(other, b)).ticket;
    expect(
      (
        await other.client
          .anonymous()
          .get(variantPath("cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D"), {
            headers: { "X-Render-Ticket": t2 },
            query: { include: "cv_data" },
          })
      ).status
    ).toBe(401);
    // Expiry.
    const fresh = (await issueTicket(h, a)).ticket;
    h.clock.advance(121_000);
    expect(
      (
        await anon.get(variantPath(a), {
          headers: { "X-Render-Ticket": fresh },
          query: { include: "cv_data" },
        })
      ).status
    ).toBe(401);
    // The ticket is stored only hashed.
    const stored = [...h.t.kv.AUTH_KV.store.entries()].filter(([k]) =>
      k.startsWith("jobs:render-ticket:")
    );
    expect(stored.length).toBeGreaterThan(0);
    for (const [key, entry] of stored) {
      expect(key).not.toContain(ticket);
      expect(entry.value).not.toContain(ticket);
    }
  });

  it("T8-08 tickets are never stored as idempotent responses and need a renderable variant", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    const res = await h.web.post<{ ticket: string }>(
      `${variantPath(id)}/render-ticket`,
      undefined,
      {
        idempotencyKey: "ticket-1",
      }
    );
    expect(res.status).toBe(200);
    const stored = h.t.jobsSqlite
      .query("SELECT response_body FROM idempotency_keys")
      .all() as Array<{
      response_body: string;
    }>;
    expect(stored.some((r) => r.response_body.includes(res.body.ticket))).toBe(
      false
    );
    const pending = await harness();
    const created = await pending.web.post<{ cv_variant: { id: string } }>(
      `/api/v1/applications/${pending.app.id}/cv-variants`,
      { base_cv_id: BASE_CV_ID, template: "basic", tailor: false }
    );
    const early = await pending.web.post(
      `${variantPath(created.body.cv_variant.id)}/render-ticket`
    );
    expect(early.status).toBe(422);
  });

  it("T8-08 a CLI device needs a live lease on the variant's render_cv task", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    const cli = await h.client.cliSession(EMAIL);
    const denied = await cli.post(`${variantPath(id)}/render-ticket`);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: "insufficient_scope" });
    h.t.jobsSqlite
      .query(
        "INSERT INTO automation_tasks (id, user_id, kind, application_id, cv_variant_id, payload, state, required_capabilities, not_before, expires_at, lease_id, lease_device_id, lease_expires_at, created_by, idempotency_key, created_at, updated_at) VALUES ('tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C0D', ?, 'render_cv', ?, ?, '{}', 'running', '[\"render_cv\"]', 0, ?, 'lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0D', ?, ?, 'system', 'render:x', 0, 0)"
      )
      .run(
        h.userId,
        h.app.id,
        id,
        h.clock.now() + 3_600_000,
        cli.deviceId,
        h.clock.now() + 60_000
      );
    const granted = await cli.post<{ ticket: string }>(
      `${variantPath(id)}/render-ticket`
    );
    expect(granted.status).toBe(200);
    expect(granted.body.ticket.length).toBeGreaterThanOrEqual(43);
    // An expired lease no longer qualifies.
    h.clock.advance(61_000);
    expect((await cli.post(`${variantPath(id)}/render-ticket`)).status).toBe(
      403
    );
  });
});

describe("TCV-TICKET-UPLOAD the render page uploads with its ticket", () => {
  it("TCV-TICKET-UPLOAD reads, uploads once, and the variant becomes draft with a cv_variant approval", async () => {
    const h = await harness({ script: [{ patch: honestPatch() }] });
    const id = await createVariant(h);
    const { ticket } = await issueTicket(h, id);
    const anon = h.client.anonymous();
    const headers = { "X-Render-Ticket": ticket };
    expect(
      (
        await anon.get(variantPath(id), {
          headers,
          query: { include: "cv_data" },
        })
      ).status
    ).toBe(200);
    const bytes = pdfBytes(4096);
    const upload = await uploadFile(anon, {
      bytes,
      headers,
      meta: { links: { cv_variant_id: id } },
    });
    expect(upload.status).toBe(201);
    const variant = variantRow(h.t.jobsSqlite, id);
    expect(variant.status).toBe("draft");
    expect(variant.file_id).toBe(upload.body.file.id as string);
    const [approval] = approvals(h);
    expect(approval).toMatchObject({
      kind: "cv_variant",
      state: "pending",
      application_id: h.app.id,
    });
    expect(approval.payload_hash).toBe(
      await cvVariantPayloadHash(await sha256Of(bytes), variant.diff)
    );
    expect(JSON.parse(approval.payload as string)).toMatchObject({
      type: "cv_variant",
      cv_variant_id: id,
      sha256: await sha256Of(bytes),
      template: "harvard",
      rephrased_bullets: 1,
    });
    expect(eventTypes(h)).toContain("approval_requested");
    // The ticket's upload is spent.
    const again = await uploadFile(anon, {
      headers,
      meta: { links: { cv_variant_id: id } },
    });
    expect(again.status).toBe(401);
  });

  it("TCV-TICKET-UPLOAD a ticket uploads only its own variant's cv_pdf", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    const anon = h.client.anonymous();
    const wrongVariant = await uploadFile(anon, {
      headers: { "X-Render-Ticket": (await issueTicket(h, id)).ticket },
      meta: { links: { cv_variant_id: "cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D" } },
    });
    expect(wrongVariant.status).toBe(401);
    const wrongKind = await uploadFile(anon, {
      headers: { "X-Render-Ticket": (await issueTicket(h, id)).ticket },
      meta: { kind: "attachment", links: {} },
    });
    expect(wrongKind.status).toBe(401);
    expect(h.t.r2.objects.size).toBe(0);
    expect(rowsOf(h.t.jobsSqlite, "files", h.userId)).toEqual([]);
  });
});

describe("TCV-RENDER-TASK the render_cv fallback (08 §4.1 step 8)", () => {
  it("TCV-RENDER-TASK no PDF 2 min after tailoring → one queued render_cv task for any render device", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    // The delayed checks ran early (the fake queue ignores delays): no task yet.
    expect(rowsOf(h.t.jobsSqlite, "automation_tasks", h.userId)).toEqual([]);
    h.clock.advance(TWO_MINUTES);
    await h.t.env.JOBS_AI_QUEUE.send(tailorCvMessage(h.userId, id, 1));
    await h.drain();
    const tasks = rowsOf(h.t.jobsSqlite, "automation_tasks", h.userId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      kind: "render_cv",
      cv_variant_id: id,
      application_id: h.app.id,
      state: "queued",
      created_by: "system",
      required_capabilities: '["render_cv"]',
      target_device_id: null,
      idempotency_key: `render:${id}`,
    });
    expect(eventTypes(h)).toContain("automation_task_created");
    // A second check does not duplicate it.
    await h.t.env.JOBS_AI_QUEUE.send(tailorCvMessage(h.userId, id, 2));
    await h.drain();
    expect(rowsOf(h.t.jobsSqlite, "automation_tasks", h.userId)).toHaveLength(
      1
    );
  });

  it("TCV-RENDER-TASK a web render within 2 min means no task; the daily sweep covers a lost check", async () => {
    const rendered = await harness();
    const r = await createVariant(rendered, { tailor: false });
    expect((await renderVariant(rendered, r)).status).toBe(201);
    rendered.clock.advance(TWO_MINUTES);
    await rendered.t.env.JOBS_AI_QUEUE.send(
      tailorCvMessage(rendered.userId, r, 1)
    );
    await rendered.drain();
    expect(
      rowsOf(rendered.t.jobsSqlite, "automation_tasks", rendered.userId)
    ).toEqual([]);

    const lost = await harness();
    const l = await createVariant(lost, { tailor: false });
    lost.clock.advance(TWO_MINUTES + 1000);
    const ctx = createCtx();
    const report = await runScheduled({ cron: "0 3 * * *" }, lost.t.env, ctx, {
      clock: lost.clock,
    });
    expect(report.failed).toEqual([]);
    const tasks = rowsOf(lost.t.jobsSqlite, "automation_tasks", lost.userId);
    expect(tasks.map((t) => [t.kind, t.cv_variant_id])).toEqual([
      ["render_cv", l],
    ]);
  });
});

describe("TCV-APPROVE approve / reject", () => {
  it("TCV-APPROVE approves a rendered draft: attached, cv_variant_attached, preparing → ready", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    const upload = await renderVariant(h, id);
    const revision = variantRow(h.t.jobsSqlite, id).revision;
    const res = await h.web.post<{
      cv_variant: CvVariantRecord;
      application: Record<string, unknown>;
    }>(`${variantPath(id)}/approve`, { base_revision: revision });
    expect(res.status).toBe(200);
    expect(res.body.cv_variant).toMatchObject({
      status: "approved",
      revision: revision + 1,
    });
    expect(res.body.cv_variant.approved_at).toBe(h.clock.now());
    expect(res.body.application).toMatchObject({
      cv_variant_id: id,
      stage: "ready",
    });
    const app = appRow(h);
    expect(app.cv_variant_id).toBe(id);
    expect(app.stage).toBe("ready");
    const [approval] = approvals(h);
    expect(approval).toMatchObject({
      state: "approved",
      decided_via: "web",
      decided_by_user_id: h.userId,
    });
    expect(eventTypes(h)).toEqual(
      expect.arrayContaining([
        "approval_decided",
        "cv_variant_attached",
        "stage_changed",
      ])
    );
    const attached = h.t.jobsSqlite
      .query(
        "SELECT payload FROM application_events WHERE type = 'cv_variant_attached'"
      )
      .get() as { payload: string };
    expect(JSON.parse(attached.payload)).toMatchObject({
      cv_variant_id: id,
      file_id: upload.body.file.id,
    });
  });

  it("TCV-APPROVE refuses a stale revision (409), a variant without PDF (422) and a second approval", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    const early = await h.web.post(`${variantPath(id)}/approve`, {
      base_revision: variantRow(h.t.jobsSqlite, id).revision,
    });
    expect(early.status).toBe(422);
    await renderVariant(h, id);
    const stale = await h.web.post<{
      details: { current: { revision: number } };
    }>(`${variantPath(id)}/approve`, { base_revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.details.current.revision).toBe(
      variantRow(h.t.jobsSqlite, id).revision
    );
    const ok = await h.web.post(`${variantPath(id)}/approve`, {
      base_revision: variantRow(h.t.jobsSqlite, id).revision,
    });
    expect(ok.status).toBe(200);
    const twice = await h.web.post(`${variantPath(id)}/approve`, {
      base_revision: variantRow(h.t.jobsSqlite, id).revision,
    });
    expect(twice.status).toBe(422);
  });

  it("TCV-APPROVE keeps the stage when the mode is manual or an answer approval is open", async () => {
    const manual = await harness({ appOverrides: { mode: "manual" } });
    const m = await createVariant(manual, { tailor: false });
    await renderVariant(manual, m);
    await manual.web.post(`${variantPath(m)}/approve`, {
      base_revision: variantRow(manual.t.jobsSqlite, m).revision,
    });
    expect(appRow(manual)).toMatchObject({
      stage: "preparing",
      cv_variant_id: m,
    });

    const open = await harness();
    const o = await createVariant(open, { tailor: false });
    await renderVariant(open, o);
    open.t.jobsSqlite
      .query(
        "INSERT INTO approvals (id, user_id, kind, application_id, payload, payload_hash, state, expires_at, created_at) VALUES ('apr_01JA6V8M3W8Z1T6Q4Y2B7K9C0D', ?, 'answer', ?, '{}', ?, 'pending', 0, 0)"
      )
      .run(open.userId, open.app.id, "0".repeat(64));
    await open.web.post(`${variantPath(o)}/approve`, {
      base_revision: variantRow(open.t.jobsSqlite, o).revision,
    });
    expect(appRow(open).stage).toBe("preparing");
  });

  it("TCV-APPROVE reject closes the variant and its pending approval", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    await renderVariant(h, id);
    const res = await h.web.post<{ cv_variant: CvVariantRecord }>(
      `${variantPath(id)}/reject`,
      {
        base_revision: variantRow(h.t.jobsSqlite, id).revision,
        reason: "Wrong template",
      }
    );
    expect(res.status).toBe(200);
    expect(res.body.cv_variant.status).toBe("rejected");
    const [approval] = approvals(h);
    expect(approval).toMatchObject({ state: "rejected", decided_via: "web" });
    expect(JSON.parse(approval.response as string)).toEqual({
      note: "Wrong template",
    });
    expect(appRow(h).cv_variant_id).toBeNull();
    const again = await h.web.post(`${variantPath(id)}/reject`, {
      base_revision: variantRow(h.t.jobsSqlite, id).revision,
    });
    expect(again.status).toBe(422);
  });

  it("TCV-APPROVE GET detail shows the variant, its file and (on request) the CVData; not owned = 404", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    await renderVariant(h, id);
    const plain = await h.web.get<Record<string, unknown>>(variantPath(id));
    expect(plain.status).toBe(200);
    expect(plain.body.tailored_cv).toBeUndefined();
    expect(plain.body.edited_after_approval).toBe(false);
    expect((plain.body.file as Record<string, unknown>).status).toBe("ready");
    expect(plain.body.file as Record<string, unknown>).not.toHaveProperty(
      "r2_key"
    );
    const withData = await h.web.get<{ tailored_cv: Record<string, unknown> }>(
      variantPath(id),
      {
        query: { include: "cv_data" },
      }
    );
    expect(withData.body.tailored_cv.visibility).toBe("private");
    const budi = await h.client.browserSession(OTHER_EMAIL);
    expect((await budi.get(variantPath(id))).status).toBe(404);
    expect(
      (await budi.post(`${variantPath(id)}/approve`, { base_revision: 1 }))
        .status
    ).toBe(404);
  });
});

describe("T8-10 a re-render invalidates the approval", () => {
  it("T8-10 the old approval expires, its payload_hash no longer matches, the old PDF starts its clock", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    const first = await renderVariant(h, id, pdfBytes(2048, "a"));
    const [old] = approvals(h);
    const second = await renderVariant(h, id, pdfBytes(2048, "b"));
    expect(second.status).toBe(201);
    const all = approvals(h);
    expect(all.map((a) => a.state)).toEqual(["expired", "pending"]);
    expect(all[1].payload_hash).not.toBe(old.payload_hash);
    const oldFile = h.t.jobsSqlite
      .query("SELECT retention_until FROM files WHERE id = ?")
      .get(first.body.file.id as string) as { retention_until: number };
    expect(oldFile.retention_until).toBe(h.clock.now() + 30 * 86_400_000);
    // Deciding with the hash the user saw before the re-render is refused.
    const approval = h.t.jobsSqlite
      .query("SELECT * FROM approvals WHERE id = ?")
      .get(all[1].id as string) as Record<string, unknown>;
    await expect(
      planCvVariantApprovalDecision(jobsDb(h.t.env), h.web.scope as UserScope, {
        approval: {
          ...approval,
          payload: JSON.parse(approval.payload as string),
        } as never,
        decision: "approve",
        payloadHash: old.payload_hash as string,
        decidedVia: "web",
        now: h.clock.now(),
        source: "web",
      })
    ).rejects.toMatchObject({ code: "policy_violation" });
    // The current approval still works.
    const ok = await h.web.post(`${variantPath(id)}/approve`, {
      base_revision: variantRow(h.t.jobsSqlite, id).revision,
    });
    expect(ok.status).toBe(200);
  });
});

describe("T8-12 edited after approval", () => {
  it("T8-12 detects a change of the tailored document in apps/cv after approval", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    await renderVariant(h, id);
    await h.web.post(`${variantPath(id)}/approve`, {
      base_revision: variantRow(h.t.jobsSqlite, id).revision,
    });
    const slug = variantRow(h.t.jobsSqlite, id).tailored_cv_id as string;
    const detail = async () =>
      (await h.web.get<{ edited_after_approval: boolean }>(variantPath(id)))
        .body.edited_after_approval;
    expect(await detail()).toBe(false);
    // A builder save that changes nothing visible (keys reordered, unknown key) is not an edit.
    const doc = kvJson(h, `cv:${slug}`) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(doc).reverse());
    h.t.kv.CV_KV.store.set(`cv:${slug}`, {
      value: JSON.stringify({ ...reordered, _ui: 1 }),
    });
    expect(await detail()).toBe(false);
    h.t.kv.CV_KV.store.set(`cv:${slug}`, {
      value: JSON.stringify({ ...doc, summary: "Edited by hand." }),
    });
    expect(await detail()).toBe(true);
    h.t.kv.CV_KV.store.delete(`cv:${slug}`);
    expect(await detail()).toBe(true);
  });
});

describe("T8-13 auto-approve only for pure selection in auto mode", () => {
  async function autoHarness(policy: Record<string, unknown>, mode = "auto") {
    const h = await harness({ script: [{ patch: keepPatch() }] });
    await h.t.setFlag("JOBS_AUTO_MODE_ENABLED", true);
    seedAutoRule(h, policy, mode);
    return h;
  }

  it("T8-13 auto mode + require_cv_approval=false + pure selection → approved and attached on upload", async () => {
    const h = await autoHarness({ require_cv_approval: false, tailor: true });
    const id = await createVariant(h);
    expect((await renderVariant(h, id)).status).toBe(201);
    const variant = variantRow(h.t.jobsSqlite, id);
    expect(variant.status).toBe("approved");
    expect(variant.approved_at).toBe(h.clock.now());
    expect(appRow(h)).toMatchObject({ cv_variant_id: id, stage: "ready" });
    const [approval] = approvals(h);
    expect(approval).toMatchObject({ state: "approved", decided_via: null });
    expect(eventTypes(h)).toContain("cv_variant_attached");
  });

  it("T8-13 a rephrased bullet always needs a human approval, even in auto mode", async () => {
    const h = await harness({ script: [{ patch: honestPatch() }] });
    await h.t.setFlag("JOBS_AUTO_MODE_ENABLED", true);
    seedAutoRule(h, { require_cv_approval: false });
    const id = await createVariant(h);
    await renderVariant(h, id);
    expect(variantRow(h.t.jobsSqlite, id).status).toBe("draft");
    expect(approvals(h).map((a) => a.state)).toEqual(["pending"]);
  });

  it("T8-13 approval mode, a missing require_cv_approval=false or the dark flag keep approval required", async () => {
    for (const [policy, mode, flag] of [
      [{ require_cv_approval: false }, "approval", true],
      [{}, "auto", true],
      [{ require_cv_approval: false }, "auto", false],
    ] as const) {
      const h = await harness({ script: [{ patch: keepPatch() }] });
      await h.t.setFlag("JOBS_AUTO_MODE_ENABLED", flag);
      seedAutoRule(h, policy, mode);
      const id = await createVariant(h);
      await renderVariant(h, id);
      expect(variantRow(h.t.jobsSqlite, id).status).toBe("draft");
    }
  });
});

describe("TCV-APPROVE decisions from MCP, purge and the DLQ helper", () => {
  it("TCV-APPROVE MCP may decide a cv_variant approval only when the user allowed it", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    await renderVariant(h, id);
    const mcp = await h.client.mcpOAuthToken(EMAIL);
    const body = { base_revision: variantRow(h.t.jobsSqlite, id).revision };
    const refused = await mcp.post(`${variantPath(id)}/approve`, body);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      details: { reason: "mcp_approvals_disabled" },
    });
    h.t.jobsSqlite
      .query(
        "UPDATE user_settings SET allow_mcp_approvals = 1 WHERE user_id = ?"
      )
      .run(h.userId);
    const allowed = await mcp.post(`${variantPath(id)}/approve`, body);
    expect(allowed.status).toBe(200);
    expect(approvals(h)[0]).toMatchObject({
      state: "approved",
      decided_via: "mcp",
    });
    const actor = h.t.jobsSqlite
      .query(
        "SELECT actor_kind FROM application_events WHERE type = 'cv_variant_attached'"
      )
      .get() as { actor_kind: string };
    expect(actor.actor_kind).toBe("mcp");
  });

  it("TCV-APPROVE purging an application removes its variants, approvals, documents and PDFs (06 §8)", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    await renderVariant(h, id);
    const slug = variantRow(h.t.jobsSqlite, id).tailored_cv_id as string;
    const db = jobsDb(h.t.env);
    const scope = h.web.scope as UserScope;
    const purge = await planPurgeApplicationCvVariants(db, scope, h.t.env, {
      applicationId: h.app.id,
      now: h.clock.now(),
    });
    await h.t.env.JOBS_DB.batch(purge.statements);
    await purge.afterCommit();
    expect(rowsOf(h.t.jobsSqlite, "cv_variants", h.userId)).toEqual([]);
    expect(approvals(h)).toEqual([]);
    expect(rowsOf(h.t.jobsSqlite, "files", h.userId)[0].status).toBe("deleted");
    expect(h.t.r2.objects.size).toBe(0);
    expect(h.t.kv.CV_KV.store.has(`cv:${slug}`)).toBe(false);
    expect(h.t.kv.CV_KV.store.has(`owner:cv:${slug}`)).toBe(false);
    // The base CV is never touched.
    expect(h.t.kv.CV_KV.store.has(`cv:${BASE_CV_ID}`)).toBe(true);
  });

  it("TCV-APPROVE failCvVariant fails only a generating variant (the DLQ path)", async () => {
    const h = await harness();
    const res = await h.web.post<{ cv_variant: { id: string } }>(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      { base_cv_id: BASE_CV_ID, template: "basic", tailor: false }
    );
    const id = res.body.cv_variant.id;
    const db = jobsDb(h.t.env);
    const scope = h.web.scope as UserScope;
    expect(
      await failCvVariant(db, scope, { cvvId: id, now: h.clock.now() })
    ).toBe(true);
    expect(variantRow(h.t.jobsSqlite, id).status).toBe("failed");
    expect(
      await failCvVariant(db, scope, { cvvId: id, now: h.clock.now() })
    ).toBe(false);
    // A late tailor_cv delivery for the failed variant is a no-op.
    await h.drain();
    expect(variantRow(h.t.jobsSqlite, id).tailored_cv_id).toBeNull();
  });

  it("revoked AI consent between request and consumer fails the variant without an AI call", async () => {
    const h = await harness({ script: [{ patch: keepPatch() }] });
    const res = await h.web.post<{ cv_variant: { id: string } }>(
      `/api/v1/applications/${h.app.id}/cv-variants`,
      { base_cv_id: BASE_CV_ID, template: "basic", tailor: true }
    );
    h.t.jobsSqlite
      .query("UPDATE user_settings SET ai_consent_at = NULL WHERE user_id = ?")
      .run(h.userId);
    await h.drain();
    const row = variantRow(h.t.jobsSqlite, res.body.cv_variant.id);
    expect(row.status).toBe("failed");
    expect(
      (row.diff as { validator: { violations: string[] } }).validator
        .violations[0]
    ).toBe("failed: ai_consent_required");
    expect(h.ai.inputs).toEqual([]);
  });
});
