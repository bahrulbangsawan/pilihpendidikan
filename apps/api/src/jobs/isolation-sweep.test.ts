// S-31 cross-user isolation sweep (11 §6, §13; 13 §5 S-31; 04 §5 item 3;
// 17 §15 item 7), generated from the declared route table.
//
// T11-ISO          user A owns one of everything; user B calls EVERY /api/v1
//                  route of `listRouteTable()` with A's ids → 404 (an id
//                  route) or a response that carries none of A's ids (a list
//                  or a route without ids); a claim on B's own device never
//                  hands out A's task. A's rows are byte-identical afterwards,
//                  and the same call made by A is not a 404 (the control: B's
//                  404 comes from ownership, not from a bad request). A route
//                  of the table without a sweep case fails the run.
// T11-ADMIN-SWEEP  the same sweep with an ADMIN_EMAILS caller (D-26).
// T11-SCOPES       every route declares a scope (none / any only on an
//                  explicit allow-list); a read-only personal token gets 403
//                  on every write route; a personal write token and an MCP
//                  OAuth token get 403 on every automation:execute /
//                  ai:invoke / automation:manage route.
// T11-MCP-SWEEP    every MCP `jobs_*` tool, called by B (and by an admin)
//                  with A's ids, answers "not found" and leaks nothing, on
//                  both legacy backends.

import { beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import type {
  FeatureFlagKey,
  OAuthScope,
} from "@pilihpendidikan/jobs-contracts/enums";
import { OAUTH_SCOPES } from "@pilihpendidikan/jobs-contracts/enums";
import { newId, newUlid } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  TestEnv,
  V1CallOptions,
  V1Client,
  V1Response,
  V1Session,
} from "../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createToolSession,
  createV1Client,
  textOf,
} from "../../test/fakes";
import { seedUserJob } from "../../test/seed-jobs";
import type { Caller } from "../auth";
import { createCvDocument } from "../documents/cv-create";
import { ensureUser } from "./repo/core/users";
import {
  MCP_OAUTH_SCOPES,
  PERSONAL_READ_SCOPES,
  PERSONAL_WRITE_SCOPES,
} from "./core/scopes";
import { seedFile } from "./routes/email/support.test";
import type { Body } from "./routes/automation/support.test";
import {
  browserSubmitPayload,
  claimOne,
  FORM_HASH,
  NOW,
  requestSubmitApproval,
  seedQueued,
  seedReadyApp,
} from "./routes/automation/support.test";
import type { RouteTableEntry } from "./routes/table";
import { listRouteTable } from "./routes/table";
import { sampleCv } from "./services/cv/tailoring/fixtures";

const A_EMAIL = "alice@example.com";
const B_EMAIL = "bob@example.com";
/** In `ADMIN_EMAILS` of the test env (test/fakes.ts). */
const ADMIN_EMAIL = "admin@example.com";
const A_CV_ID = "alice-private-cv";

const FLAGS: Partial<Record<FeatureFlagKey, boolean>> = {
  JOBS_AUTOMATION_ENABLED: true,
  JOBS_AUTO_MODE_ENABLED: true,
  JOBS_EMAIL_SERVER_SEND_ENABLED: true,
};

type Row = Record<string, string | number | null>;

const RULE_CRITERIA = {
  min_score: 80,
  require_ai_component: false,
  max_score_age_days: 14,
  exclude_blocking_gates: true,
  exclude_possible_gates: false,
  keywords: ["backend"],
};
const RULE_LIMITS = {
  max_per_day: 3,
  max_per_company_per_30d: 2,
  active_hours: { start: "08:00", end: "20:00" },
  expires_at: NOW + 30 * 86_400_000,
};

// ---------------------------------------------------------------------------
// The world: user A owns one of every resource; B has a small data set too.
// ---------------------------------------------------------------------------

/** A's ids, keyed by the route parameter names of 05. */
interface Ids {
  ans_id: string;
  /**
   * A cloud catalog source A follows (24 §5). Catalog rows are system data
   * every user may read, so this id is not one of A's secrets; A's follow
   * row is (snapshot) and must survive B's calls.
   */
  csr_id: string;
  app_id: string;
  apr_id: string;
  att_id: string;
  cvv_id: string;
  dev_id: string;
  eml_id: string;
  export_id: string;
  fil_id: string;
  ivw_id: string;
  lease_id: string;
  ofr_id: string;
  posting_id: string;
  queued_tsk_id: string;
  run_id: string;
  rul_id: string;
  src_id: string;
  tsk_id: string;
  ujb_id: string;
  inbox_ujb_id: string;
}

interface Side {
  cli: V1Session;
  web: V1Session;
}

interface World {
  a: Side;
  b: Side;
  /** B's own application (cross-references from B's side). */
  bAppId: string;
  client: V1Client;
  ids: Ids;
  /** Every value that identifies A (ids, email, CV slug). */
  secrets: string[];
  t: TestEnv;
  userA: string;
}

function insert(t: TestEnv, table: string, row: Row): void {
  const columns = Object.keys(row);
  t.jobsSqlite
    .query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    )
    .run(...columns.map((c) => row[c]));
}

function grantConsent(t: TestEnv, userId: string): void {
  t.jobsSqlite
    .query(
      "INSERT INTO user_settings (user_id, ai_consent_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET ai_consent_at = excluded.ai_consent_at"
    )
    .run(userId, NOW - 1000, NOW - 1000);
}

function expectStatus(res: V1Response<Body>, status: number, what: string) {
  if (res.status !== status) {
    throw new Error(`${what}: ${res.status} ${res.text.slice(0, 400)}`);
  }
}

async function side(client: V1Client, email: string): Promise<Side> {
  return {
    web: await client.browserSession(email),
    cli: await client.cliSession(email, { scopes: OAUTH_SCOPES }),
  };
}

/** A's full data set, created through the routes where that is cheap. */
async function buildWorld(bEmail: string): Promise<World> {
  const t = createTestEnv({}, { flags: FLAGS });
  const clock = createFakeClock(NOW);
  const client = createV1Client(t, { clock });
  const a = await side(client, A_EMAIL);
  const b = await side(client, bEmail);
  const userA = a.web.userId as string;
  const userB = b.web.userId as string;
  grantConsent(t, userA);
  grantConsent(t, userB);
  await createCvDocument(t.env, { email: A_EMAIL }, A_CV_ID, sampleCv());

  const source = await a.web.post<Body>("/api/v1/sources", {
    adapter: "greenhouse",
    label: "Acme (Greenhouse)",
    config: { board_token: "acme" },
    enabled: true,
  });
  expectStatus(source, 201, "A source");
  const srcId = source.body.source.id as string;

  const runId = newId("run", NOW);
  const run = await a.cli.post<Body>("/api/v1/discovery/runs", {
    id: runId,
    sources: [{ source_id: srcId, adapter: "greenhouse", label: "Acme" }],
    device_id: a.cli.deviceId,
    engine_version: "pilih-jobs 0.1.0; scrapling 0.4.15",
    started_at: NOW - 60_000,
  });
  expectStatus(run, 201, "A discovery run");

  // The claimed apply task needs the only queued task to be its own.
  const app = seedReadyApp(t, userA);
  seedQueued(t, userA, { application_id: app.appId });
  const claimed = await claimOne(a.cli);
  const attempt = t.jobsSqlite
    .query("SELECT id FROM automation_attempts WHERE lease_id = ?")
    .get(claimed.leaseId) as { id: string };
  const approval = await requestSubmitApproval(
    a.cli,
    claimed.taskId,
    claimed.leaseId,
    app.postingId
  );
  expect([200, 201]).toContain(approval.status);
  const aprId = approval.body.approval.id as string;
  const other = seedReadyApp(t, userA);
  const queuedTaskId = seedQueued(t, userA, {
    application_id: other.appId,
    not_before: NOW + 3_600_000,
  });

  const interview = await a.web.post<Body>(
    `/api/v1/applications/${app.appId}/interviews`,
    {
      kind: "technical",
      scheduled_at: NOW + 86_400_000,
      move_application: false,
    }
  );
  expectStatus(interview, 201, "A interview");
  const offer = await a.web.post<Body>(
    `/api/v1/applications/${app.appId}/offers`,
    { received_at: NOW, move_application: false }
  );
  expectStatus(offer, 201, "A offer");
  await a.web.post(`/api/v1/applications/${app.appId}/events`, {
    type: "note_added",
    payload: { text: "Alice's private note" },
    idempotency_key: "alice-note",
  });

  const inbox = seedUserJob(t.jobsSqlite, userA, { inbox_state: "new" });

  const rule = await a.web.post<Body>("/api/v1/rules", {
    name: "Alice's rule",
    mode: "approval",
    enabled: false,
    criteria: RULE_CRITERIA,
    limits: RULE_LIMITS,
    allowed_domains: ["greenhouse.io"],
    cv_policy: {
      base_cv_id: A_CV_ID,
      tailor: false,
      require_cv_approval: true,
    },
  });
  expectStatus(rule, 201, "A rule");

  const answer = await a.web.post<Body>("/api/v1/profile/answers", {
    question_key: "notice_period",
    match_patterns: ["notice period"],
    answer: "1 month",
    answer_kind: "text",
    sensitivity: "none",
    auto_use: "always",
  });
  expectStatus(answer, 201, "A answer");

  const file = await seedFile(t, userA);
  const cvvId = newId("cvv", NOW);
  insert(t, "cv_variants", {
    id: cvvId,
    user_id: userA,
    application_id: app.appId,
    base_cv_id: A_CV_ID,
    template: "basic",
    status: "draft",
    created_at: NOW - 1000,
    updated_at: NOW - 1000,
  });
  const emlId = newId("eml", NOW);
  insert(t, "email_applications", {
    id: emlId,
    user_id: userA,
    application_id: app.appId,
    to_address: "careers@acme.com",
    subject: "Application — Alice",
    body_text: "Dear team, …",
    attachment_file_ids: JSON.stringify([file.id]),
    delivery: "local_handoff",
    status: "draft",
    created_at: NOW - 1000,
    updated_at: NOW - 1000,
  });

  const exported = await a.web.post<Body>("/api/v1/account/export");
  expectStatus(exported, 202, "A export");
  await t.queue.drain(t.env, { deps: { clock } });

  // A follows a cloud catalog source (the catalog is seeded on first read).
  const cloud = await a.web.get<Body>("/api/v1/cloud-sources");
  expectStatus(cloud, 200, "A cloud catalog");
  const csrId = (cloud.body.items as Array<{ id: string; slug: string }>).find(
    (item) => item.slug === "weworkremotely.com"
  )?.id as string;
  expectStatus(
    await a.web.put<Body>(`/api/v1/cloud-sources/${csrId}/follow`),
    200,
    "A follow"
  );

  // B's own data set (11 §13: "users A and B with full data sets").
  const bApp = seedReadyApp(t, userB);
  await seedFile(t, userB);

  const ids: Ids = {
    ans_id: answer.body.answer.id,
    csr_id: csrId,
    app_id: app.appId,
    apr_id: aprId,
    att_id: attempt.id,
    cvv_id: cvvId,
    dev_id: a.cli.deviceId as string,
    eml_id: emlId,
    export_id: exported.body.export_id,
    fil_id: file.id,
    inbox_ujb_id: inbox.id,
    ivw_id: interview.body.interview.id,
    lease_id: claimed.leaseId,
    ofr_id: offer.body.offer.id,
    posting_id: app.postingId,
    queued_tsk_id: queuedTaskId,
    run_id: runId,
    rul_id: rule.body.rule.id,
    src_id: srcId,
    tsk_id: claimed.taskId,
    ujb_id: app.userJobId,
  };
  return {
    t,
    client,
    a,
    b,
    bAppId: bApp.appId,
    ids,
    userA,
    secrets: [
      ...Object.entries(ids)
        .filter(([key]) => key !== "csr_id")
        .map(([, value]) => value),
      A_EMAIL,
      A_CV_ID,
      inbox.posting_id,
    ],
  };
}

// ---------------------------------------------------------------------------
// Sweep cases: one per route of the table.
// ---------------------------------------------------------------------------

type Expectation =
  /** 404 `not_found` (an id of A in the path or the body). */
  | "not_found"
  /** Any non-5xx answer that carries none of A's ids. */
  | "no_leak"
  /** B's own device: nothing of A's is handed out (204 or B's own task). */
  | "claim_own";

interface SweepCase {
  /** Which of B's credentials calls (default: CLI for device routes). */
  as?: "web" | "cli";
  body?: unknown;
  /** A body that depends on the caller (its own device id, …). */
  bodyFor?: (who: Side) => unknown;
  /** The owner's control call answers something other than 404. */
  control?: boolean;
  expect: Expectation;
  /** Overrides for the brace parameters of the pattern. */
  params?: Partial<Record<string, string>>;
  query?: Record<string, string>;
  rawBody?: (w: World) => { body: BodyInit; contentType: string };
}

const lease = (ids: Ids) => ({ task_id: ids.tsk_id, lease_id: ids.lease_id });

function observation(ids: Ids) {
  return {
    observation_id: `obs_${newUlid(NOW)}`,
    attempt_id: ids.att_id,
    step: 1,
    url: "https://boards.greenhouse.io/acme/jobs/1",
    origin: "https://boards.greenhouse.io",
    registrable_domain: "greenhouse.io",
    allowlisted: true,
    title: "Apply",
    http_status: 200,
    aria_snapshot: '- heading "Apply for this job"',
    visible_text_excerpt: "Apply for this job. First name.",
    fields: [],
    controls: [],
    errors: [],
    opaque_regions: [],
    challenge: { detected: false, kind: null },
    form_hash: FORM_HASH,
    screenshot_jpeg_b64: null,
  };
}

const EVIDENCE = {
  kind: "browser_confirmation",
  verdict: "verified",
  signals: {
    url_match: true,
    dom_marker: true,
    negative_marker: false,
    xhr_2xx: true,
    form_gone: true,
    application_received: 0.97,
    still_form_or_error: 0.02,
  },
  final_url: "https://boards.greenhouse.io/acme/jobs/1/confirmation",
  page_title: "Thank you for applying",
  text_excerpt: "Thank you for applying",
  screenshot_file_id: null,
  form_hash: FORM_HASH,
  captured_at: NOW,
};

/** The sweep table, keyed exactly like `listRouteTable()` entries. */
function sweepCases(ids: Ids): Record<string, SweepCase> {
  return {
    "GET /api/v1/meta": { expect: "no_leak" },
    "GET /api/v1/me": { expect: "no_leak" },
    "POST /api/v1/devices": {
      as: "cli",
      expect: "no_leak",
      body: {
        name: "Bob laptop",
        platform: "linux",
        arch: "x86_64",
        cli_version: "0.1.0",
        capabilities: ["discover"],
      },
    },
    "GET /api/v1/devices": { expect: "no_leak" },
    "PATCH /api/v1/devices/{dev_id}": {
      expect: "not_found",
      body: { base_revision: 1, accepts_tasks: false },
    },
    "POST /api/v1/devices/{dev_id}/revoke": { expect: "not_found" },
    "POST /api/v1/devices/{dev_id}/heartbeat": {
      expect: "not_found",
      body: {
        cli_version: "0.1.0",
        local_state_summary: {},
        active_lease_ids: [ids.lease_id],
        outbox_depth: 0,
        browser: { mode: "managed", status: "ready" },
      },
    },
    "GET /api/v1/sources": { expect: "no_leak" },
    "POST /api/v1/sources": {
      expect: "no_leak",
      body: {
        adapter: "greenhouse",
        label: "Bob (Greenhouse)",
        config: { board_token: "acme" },
        enabled: true,
      },
    },
    "PATCH /api/v1/sources/{src_id}": {
      expect: "not_found",
      body: { base_revision: 1, enabled: false },
    },
    "DELETE /api/v1/sources/{src_id}": {
      expect: "not_found",
      query: { base_revision: "1" },
    },
    "GET /api/v1/sources/adapters": { expect: "no_leak" },
    "POST /api/v1/discovery/runs": {
      // A's source id is dropped (the run is B's own, `source_id: null`);
      // the leak check proves nothing of A comes back.
      expect: "no_leak",
      bodyFor: (who) => ({
        id: newId("run", NOW),
        sources: [{ source_id: ids.src_id, adapter: "greenhouse", label: "x" }],
        device_id: who.cli.deviceId,
        engine_version: "pilih-jobs 0.1.0",
        started_at: NOW,
      }),
    },
    "POST /api/v1/discovery/runs/{run_id}/postings:batch": {
      expect: "not_found",
      body: {
        items: [
          {
            client_ref: "1",
            fingerprint: `fp1:${"1".repeat(64)}`,
            content_hash: "2".repeat(64),
            observed_at: NOW,
            unchanged: true,
          },
        ],
      },
    },
    "POST /api/v1/discovery/runs/{run_id}/complete": {
      expect: "not_found",
      body: {
        status: "completed",
        finished_at: NOW,
        stats: {
          pages: 1,
          postings_found: 0,
          new: 0,
          updated: 0,
          unchanged: 0,
          duplicates: 0,
          invalid: 0,
          errors_by_class: {},
        },
        errors: [],
        complete_sources: [],
        cursor_states: [],
      },
    },
    "GET /api/v1/discovery/runs": { expect: "no_leak" },
    "GET /api/v1/inbox": { expect: "no_leak", query: { state: "all" } },
    "POST /api/v1/inbox:bulk": {
      expect: "no_leak",
      body: { user_job_ids: [ids.inbox_ujb_id, ids.ujb_id], action: "track" },
    },
    "POST /api/v1/user-jobs": {
      expect: "no_leak",
      body: { url: "https://careers.example.co.id/jobs/42", private: true },
    },
    "GET /api/v1/user-jobs/{ujb_id}": { expect: "not_found" },
    "GET /api/v1/board": { expect: "no_leak" },
    "GET /api/v1/applications": { expect: "no_leak" },
    "POST /api/v1/applications": {
      expect: "not_found",
      body: { user_job_id: ids.inbox_ujb_id, stage: "saved" },
    },
    "GET /api/v1/applications/{app_id}": { expect: "not_found" },
    "PATCH /api/v1/applications/{app_id}": {
      expect: "not_found",
      body: { base_revision: 1, priority: 1 },
    },
    "POST /api/v1/applications/{app_id}/move": {
      expect: "not_found",
      body: { base_revision: 1, stage: "withdrawn" },
    },
    "POST /api/v1/applications/{app_id}/submission": {
      expect: "not_found",
      body: { base_revision: 1, action: "mark_applied", method: "manual" },
    },
    "DELETE /api/v1/applications/{app_id}": {
      expect: "not_found",
      query: { purge: "1" },
    },
    "GET /api/v1/applications/{app_id}/events": { expect: "not_found" },
    "POST /api/v1/applications/{app_id}/events": {
      expect: "not_found",
      body: {
        type: "note_added",
        payload: { text: "intruder" },
        idempotency_key: "intruder-1",
      },
    },
    "GET /api/v1/applications/{app_id}/interviews": { expect: "not_found" },
    "POST /api/v1/applications/{app_id}/interviews": {
      expect: "not_found",
      body: { kind: "other", move_application: false },
    },
    "GET /api/v1/applications/{app_id}/interviews/{ivw_id}": {
      expect: "not_found",
    },
    "GET /api/v1/applications/{app_id}/interviews/{ivw_id}.ics": {
      expect: "not_found",
    },
    "PATCH /api/v1/applications/{app_id}/interviews/{ivw_id}": {
      expect: "not_found",
      body: { base_revision: 1, outcome: "passed" },
    },
    "DELETE /api/v1/applications/{app_id}/interviews/{ivw_id}": {
      expect: "not_found",
      query: { base_revision: "1" },
    },
    "GET /api/v1/applications/{app_id}/offers": { expect: "not_found" },
    "POST /api/v1/applications/{app_id}/offers": {
      expect: "not_found",
      body: { received_at: NOW, move_application: false },
    },
    "GET /api/v1/applications/{app_id}/offers/{ofr_id}": {
      expect: "not_found",
    },
    "PATCH /api/v1/applications/{app_id}/offers/{ofr_id}": {
      expect: "not_found",
      body: { base_revision: 1, status: "declined" },
    },
    "DELETE /api/v1/applications/{app_id}/offers/{ofr_id}": {
      expect: "not_found",
      query: { base_revision: "1" },
    },
    "POST /api/v1/scores:request": {
      expect: "no_leak",
      body: { posting_ids: [ids.posting_id] },
    },
    "GET /api/v1/scores/{posting_id}": { expect: "not_found" },
    "POST /api/v1/files": {
      // A cv_pdf linked to A's variant.
      expect: "not_found",
      rawBody: () => {
        const bytes = new TextEncoder().encode("%PDF-1.7 bob");
        return multipart(
          {
            kind: "cv_pdf",
            sha256: sha256Hex(bytes),
            content_type: "application/pdf",
            size_bytes: bytes.length,
            links: { cv_variant_id: ids.cvv_id },
          },
          bytes
        );
      },
    },
    "GET /api/v1/files/{fil_id}": { expect: "not_found" },
    "GET /api/v1/files/{fil_id}/content": { expect: "not_found" },
    "DELETE /api/v1/files/{fil_id}": { expect: "not_found" },
    "GET /api/v1/cvs": { expect: "no_leak" },
    "POST /api/v1/applications/{app_id}/cv-variants": {
      expect: "not_found",
      body: { base_cv_id: A_CV_ID, template: "basic", tailor: false },
    },
    "GET /api/v1/cv-variants/{cvv_id}": {
      expect: "not_found",
      query: { include: "cv_data" },
    },
    "POST /api/v1/cv-variants/{cvv_id}/render-ticket": { expect: "not_found" },
    "POST /api/v1/cv-variants/{cvv_id}/approve": {
      expect: "not_found",
      body: { base_revision: 1 },
    },
    "POST /api/v1/cv-variants/{cvv_id}/reject": {
      expect: "not_found",
      body: { base_revision: 1, reason: "no" },
    },
    "GET /api/v1/rules": { expect: "no_leak" },
    "POST /api/v1/rules": {
      // A's CV as the rule's base CV.
      expect: "not_found",
      body: {
        name: "Bob's rule",
        mode: "approval",
        enabled: false,
        criteria: RULE_CRITERIA,
        limits: RULE_LIMITS,
        allowed_domains: ["greenhouse.io"],
        cv_policy: {
          base_cv_id: A_CV_ID,
          tailor: false,
          require_cv_approval: true,
        },
      },
    },
    "GET /api/v1/rules/{rul_id}": { expect: "not_found" },
    "PATCH /api/v1/rules/{rul_id}": {
      expect: "not_found",
      body: { base_revision: 1, name: "Bob was here" },
    },
    "DELETE /api/v1/rules/{rul_id}": {
      expect: "not_found",
      query: { base_revision: "1" },
    },
    "POST /api/v1/tasks": {
      expect: "not_found",
      body: {
        kind: "apply",
        application_id: ids.app_id,
        payload: { mode: "approval" },
        idempotency_key: "bob-task-1",
      },
    },
    "GET /api/v1/tasks": {
      expect: "no_leak",
      query: { application_id: ids.app_id },
    },
    "GET /api/v1/tasks/{tsk_id}": { expect: "not_found" },
    "POST /api/v1/tasks/{tsk_id}/cancel": {
      expect: "not_found",
      params: { tsk_id: ids.queued_tsk_id },
    },
    "POST /api/v1/tasks/{tsk_id}/retry": {
      expect: "not_found",
      params: { tsk_id: ids.queued_tsk_id },
      body: { confirm_not_submitted: true, idempotency_key: "bob-retry-1" },
    },
    "POST /api/v1/tasks/{tsk_id}/resume": {
      expect: "not_found",
      params: { tsk_id: ids.queued_tsk_id },
    },
    "POST /api/v1/devices/{dev_id}/tasks:claim": {
      expect: "not_found",
      body: { capabilities: ["discover", "apply", "render_cv"], max: 1 },
    },
    "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/heartbeat": {
      expect: "not_found",
      body: {
        progress: { stage: "filling", step: 1, message: "x" },
        local_state: "running",
      },
    },
    "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/events": {
      expect: "not_found",
      body: {
        events: [
          {
            type: "log",
            idempotency_key: "bob-evt-1",
            occurred_at: NOW,
            level: "info",
            message: "x",
          },
        ],
      },
    },
    "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/submit-intent": {
      expect: "not_found",
      body: { form_hash: FORM_HASH, approval_id: ids.apr_id },
    },
    "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/result": {
      expect: "not_found",
      body: { outcome: "failed", error_class: "unknown", message: "x" },
    },
    "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/release": {
      expect: "not_found",
      body: { reason: "awaiting_approval" },
    },
    "POST /api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence": {
      expect: "not_found",
      body: { evidence: EVIDENCE, outcome: "submitted" },
    },
    "GET /api/v1/approvals": { expect: "no_leak" },
    "POST /api/v1/approvals/{apr_id}/decide": {
      expect: "not_found",
      body: { decision: "approve", payload_hash: FORM_HASH },
    },
    "POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals": {
      expect: "not_found",
      body: {
        kind: "submit",
        payload: browserSubmitPayload(ids.posting_id, "c".repeat(64)),
        payload_hash: "c".repeat(64),
      },
    },
    "GET /api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals/{apr_id}": {
      expect: "not_found",
    },
    "POST /api/v1/ai/page-classify": {
      expect: "not_found",
      body: { lease_ref: lease(ids), observation: observation(ids) },
    },
    "POST /api/v1/ai/next-action": {
      expect: "not_found",
      body: {
        lease_ref: lease(ids),
        observation_id: `obs_${newUlid(NOW)}`,
        step: 1,
        page_kind: "application_form",
        state: { required_remaining: 0, errors: 0, form_hash: FORM_HASH },
        candidates: [
          { id: "c1", type: "click_ref", ref: "c-next", role_hint: "next" },
        ],
      },
    },
    "POST /api/v1/ai/field-plan": {
      expect: "not_found",
      body: {
        lease_ref: lease(ids),
        observation: observation(ids),
        file_slots: { cv_file: true, cover_letter_file: false },
      },
    },
    "POST /api/v1/ai/verify-submission": {
      expect: "not_found",
      body: {
        lease_ref: lease(ids),
        observation_id: `obs_${newUlid(NOW)}`,
        final_url: "https://boards.greenhouse.io/acme/jobs/1/confirmation",
        page_title: "Thank you",
        text_excerpt: "Thank you for applying",
        screenshot_jpeg_b64: null,
        signals: { url_match: true, dom_marker: true },
      },
    },
    "GET /api/v1/profile/facts": { expect: "no_leak" },
    "PUT /api/v1/profile/facts": {
      expect: "no_leak",
      body: { facts: [{ key: "contact.phone", value: "+62 811 0000 0000" }] },
    },
    "POST /api/v1/profile/facts:import-cv": {
      // A's private CV document.
      expect: "not_found",
      body: { cv_id: A_CV_ID },
    },
    "GET /api/v1/profile/answers": { expect: "no_leak" },
    "POST /api/v1/profile/answers": {
      expect: "no_leak",
      body: {
        question_key: "notice_period",
        match_patterns: ["notice period"],
        answer: "2 weeks",
        answer_kind: "text",
        sensitivity: "none",
        auto_use: "approval",
      },
    },
    "GET /api/v1/profile/answers/{ans_id}": { expect: "not_found" },
    "PATCH /api/v1/profile/answers/{ans_id}": {
      expect: "not_found",
      body: { base_revision: 1, auto_use: "never" },
    },
    "DELETE /api/v1/profile/answers/{ans_id}": {
      expect: "not_found",
      query: { base_revision: "1" },
    },
    "GET /api/v1/settings": { expect: "no_leak" },
    "PATCH /api/v1/settings": {
      expect: "no_leak",
      body: { base_revision: 1, locale: "en" },
    },
    "POST /api/v1/account/export": { expect: "no_leak" },
    "GET /api/v1/account/exports/{export_id}": { expect: "not_found" },
    "POST /api/v1/account/delete": {
      expect: "no_leak",
      body: { also_delete_cvs: false },
    },
    "GET /api/v1/account/delete/confirm": {
      expect: "no_leak",
      query: { token: "not-a-token" },
    },
    "POST /api/v1/account/delete/confirm": {
      expect: "not_found",
      body: { token: "not-a-token" },
      control: false,
    },
    "POST /api/v1/telemetry": {
      expect: "no_leak",
      body: {
        day: "2026-10-11",
        install_hash: "b6f0c1d2e3a4",
        cli_version: "0.1.0",
        platform: "linux",
        arch: "x86_64",
        install_channel: "uv",
        counters: { commands: { sync: 1 } },
      },
    },
    "POST /api/v1/telemetry/crash": {
      expect: "no_leak",
      body: {
        install_hash: "b6f0c1d2e3a4",
        cli_version: "0.1.0",
        platform: "linux",
        occurred_at: NOW,
        exception_type: "KeyError",
        message: "[redacted]",
        frames: [],
      },
    },
    "GET /api/v1/changes": { expect: "no_leak", query: { cursor: "0" } },
    "GET /api/v1/snapshot": { expect: "no_leak" },
    "GET /api/v1/analytics/summary": { expect: "no_leak" },
    "GET /api/v1/analytics/timeseries": {
      expect: "no_leak",
      query: { metric: "applied", interval: "week" },
    },
    "GET /api/v1/analytics/breakdown": {
      expect: "no_leak",
      query: { by: "source" },
    },
    "POST /api/v1/applications/{app_id}/emails": {
      expect: "not_found",
      body: {
        to: "careers@acme.com",
        subject: "Bob",
        body_text: "Hello",
        attachment_file_ids: [],
        delivery: "local_handoff",
        recipient_confirmed: true,
      },
    },
    "GET /api/v1/emails/{eml_id}": { expect: "not_found" },
    "POST /api/v1/emails/{eml_id}/approve": {
      expect: "not_found",
      body: { payload_hash: "d".repeat(64), recipient_confirmed: true },
    },
    "POST /api/v1/emails/{eml_id}/handed-off": {
      expect: "not_found",
      body: { sent_confirmed: true },
    },
    // 05 §15 cloud catalog (24): system rows every user reads; operator
    // routes answer 403 operator_required to B (and 422 to an admin while
    // the pipeline flag is off). Nothing of A comes back, A's follow stays.
    "GET /api/v1/cloud-sources": { expect: "no_leak" },
    "POST /api/v1/cloud-sources": {
      expect: "no_leak",
      body: { name: "Bob board", url: "https://bob-board.example.org/jobs" },
    },
    "GET /api/v1/cloud-sources/{csr_id}": { expect: "no_leak" },
    "PATCH /api/v1/cloud-sources/{csr_id}": {
      expect: "no_leak",
      body: { base_revision: 1, priority: 51 },
    },
    "PUT /api/v1/cloud-sources/{csr_id}/follow": { expect: "no_leak" },
    "DELETE /api/v1/cloud-sources/{csr_id}/follow": { expect: "no_leak" },
    "GET /api/v1/cloud-sources/{csr_id}/runs": { expect: "no_leak" },
    "POST /api/v1/cloud-sources/{csr_id}/runs": { expect: "no_leak", body: {} },
    "GET /api/v1/cloud-discovery/runs": { expect: "no_leak" },
    "POST /api/v1/cloud-discovery/refresh": { expect: "no_leak" },
  };
}

// ---------------------------------------------------------------------------
// Running a case
// ---------------------------------------------------------------------------

const CRLF = "\r\n";

function multipart(
  meta: unknown,
  bytes: Uint8Array
): { body: BodyInit; contentType: string } {
  const boundary = "isolationSweepBoundary";
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="meta"${CRLF}Content-Type: application/json${CRLF}${CRLF}${JSON.stringify(meta)}${CRLF}--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="cv.pdf"${CRLF}Content-Type: application/octet-stream${CRLF}${CRLF}`
  );
  const tail = enc.encode(`${CRLF}--${boundary}--${CRLF}`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const PARAM_RE = /\{([a-z_]+)\}/g;

function routeKeyOf(route: Pick<RouteTableEntry, "method" | "pattern">) {
  return `${route.method} ${route.pattern}`;
}

function pathOf(pattern: string, ids: Ids, params: SweepCase["params"] = {}) {
  return pattern.replace(PARAM_RE, (_, name: string) => {
    const value =
      params[name] ?? (ids as unknown as Record<string, string>)[name];
    if (!value) {
      throw new Error(`no sweep id for {${name}} in ${pattern}`);
    }
    return value;
  });
}

function needsDevice(route: RouteTableEntry): boolean {
  return (
    route.device ||
    route.scope === "automation:execute" ||
    route.also_requires.includes("automation:execute")
  );
}

let keyCounter = 0;

async function runCase(
  w: World,
  who: Side,
  route: RouteTableEntry,
  sweep: SweepCase
): Promise<{ path: string; request: string; res: V1Response<Body> }> {
  const path = pathOf(route.pattern, w.ids, sweep.params);
  const session =
    (sweep.as ?? (needsDevice(route) ? "cli" : "web")) === "cli"
      ? who.cli
      : who.web;
  keyCounter += 1;
  const options: V1CallOptions = {
    query: sweep.query,
    idempotencyKey:
      route.idempotency === "none" ? undefined : `sweep-${keyCounter}`,
  };
  if (sweep.rawBody) {
    const raw = sweep.rawBody(w);
    options.rawBody = raw.body;
    options.headers = { "Content-Type": raw.contentType };
  } else if (sweep.bodyFor) {
    options.body = sweep.bodyFor(who);
  } else if (sweep.body !== undefined) {
    options.body = sweep.body;
  }
  const res = await session.call<Body>(route.method, path, options);
  return {
    path,
    request: `${path} ${JSON.stringify(sweep.query ?? {})} ${JSON.stringify(options.body ?? null)}`,
    res,
  };
}

/** A's secrets in `text` that B did not send itself. */
function leaked(w: World, text: string, request: string): string[] {
  return w.secrets.filter(
    (secret) => text.includes(secret) && !request.includes(secret)
  );
}

/** Every JOBS_DB / identity row of A, serialized (the "A unchanged" check). */
function snapshotOf(w: World): string {
  const tables = (
    w.t.jobsSqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%user_id%' ORDER BY name"
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
  const out: Record<string, unknown> = {};
  for (const table of tables) {
    const columns = (
      w.t.jobsSqlite.query(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    const column = columns.includes("user_id") ? "user_id" : "owner_user_id";
    if (!columns.includes(column)) {
      continue;
    }
    out[table] = w.t.jobsSqlite
      .query(`SELECT * FROM ${table} WHERE ${column} = ? ORDER BY rowid`)
      .all(w.userA);
  }
  for (const table of ["devices", "oauth_grants"]) {
    out[`DB.${table}`] = w.t.sqlite
      .query(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY rowid`)
      .all(w.userA);
  }
  out["DB.mcp_tokens"] = w.t.sqlite
    .query(
      "SELECT id, status, last_used_at FROM mcp_tokens WHERE user_email = ? ORDER BY rowid"
    )
    .all(A_EMAIL);
  out.r2 = Object.keys(w.t.r2.objects)
    .filter((key) => key.includes(w.userA))
    .sort();
  return JSON.stringify(out);
}

interface SweepOutcome {
  failures: string[];
  ran: number;
}

async function sweep(w: World): Promise<SweepOutcome> {
  const cases = sweepCases(w.ids);
  const failures: string[] = [];
  let ran = 0;
  const before = snapshotOf(w);
  for (const route of listRouteTable()) {
    const key = routeKeyOf(route);
    const sweepCase = cases[key];
    if (!sweepCase) {
      failures.push(`${key}: no sweep case`);
      continue;
    }
    const { request, res } = await runCase(w, w.b, route, sweepCase);
    ran += 1;
    const leaks = leaked(w, res.text, request);
    if (leaks.length > 0) {
      failures.push(`${key}: leaked ${leaks.join(", ")} (${res.status})`);
    }
    if (res.status >= 500) {
      failures.push(`${key}: ${res.status} ${res.text.slice(0, 200)}`);
      continue;
    }
    if (
      sweepCase.expect === "not_found" &&
      (res.status !== 404 || res.body?.error !== "not_found")
    ) {
      failures.push(
        `${key}: expected 404 not_found, got ${res.status} ${res.text.slice(0, 200)}`
      );
    }
  }
  // B's own device never hands out A's task (the claim half of the sweep).
  const own = await w.b.cli.post<Body>(
    `/api/v1/devices/${w.b.cli.deviceId}/tasks:claim`,
    { capabilities: ["discover", "apply", "render_cv"], max: 1 },
    { idempotencyKey: "bob-own-claim" }
  );
  if (![200, 204].includes(own.status)) {
    failures.push(`own claim: ${own.status} ${own.text.slice(0, 200)}`);
  } else if (leaked(w, own.text, "").length > 0) {
    failures.push(`own claim handed out A's data: ${own.text.slice(0, 200)}`);
  }
  if (snapshotOf(w) !== before) {
    failures.push("A's rows changed during B's sweep");
  }
  return { failures, ran };
}

/** Routes whose sweep expects 404 (the control set). */
function notFoundRoutes(ids: Ids): RouteTableEntry[] {
  const cases = sweepCases(ids);
  return listRouteTable().filter((route) => {
    const sweepCase = cases[routeKeyOf(route)];
    return sweepCase?.expect === "not_found" && sweepCase.control !== false;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S-31 cross-user isolation sweep (11 §13)", () => {
  it("S-31 T11-ISO every route of listRouteTable() has a sweep case and no stale case exists", () => {
    const keys = listRouteTable().map(routeKeyOf);
    const cases = Object.keys(sweepCases(placeholderIds()));
    expect(keys.filter((key) => !cases.includes(key))).toEqual([]);
    expect(cases.filter((key) => !keys.includes(key))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("S-31 T11-ISO user B with user A's ids gets 404 / nothing of A on every /api/v1 route", async () => {
    const w = await buildWorld(B_EMAIL);
    const outcome = await sweep(w);
    expect(outcome.failures).toEqual([]);
    expect(outcome.ran).toBe(listRouteTable().length);
  }, 60_000);

  it("S-31 T11-ADMIN-SWEEP an ADMIN_EMAILS caller gets the same 404s (D-26)", async () => {
    const w = await buildWorld(ADMIN_EMAIL);
    const me = await w.b.web.get<Body>("/api/v1/me");
    expect(me.status).toBe(200);
    const outcome = await sweep(w);
    expect(outcome.failures).toEqual([]);
    expect(outcome.ran).toBe(listRouteTable().length);
  }, 60_000);

  it("S-31 T11-ISO B cannot point its own records at A's private CV, file or task", async () => {
    const w = await buildWorld(B_EMAIL);
    const before = snapshotOf(w);
    const variant = await w.b.web.post<Body>(
      `/api/v1/applications/${w.bAppId}/cv-variants`,
      { base_cv_id: A_CV_ID, template: "basic", tailor: false }
    );
    expect(variant.status).toBe(404);
    const patch = await w.b.web.patch<Body>(
      `/api/v1/applications/${w.bAppId}`,
      { base_revision: 1, base_cv_id: A_CV_ID }
    );
    expect(patch.status).toBe(404);
    // A's file as an attachment answers exactly like a file that does not
    // exist (11 §6.1: not owned = not found, no existence oracle).
    const attach = (fileId: string) =>
      w.b.web.post<Body>(`/api/v1/applications/${w.bAppId}/emails`, {
        to: "careers@acme.com",
        subject: "Bob",
        body_text: "Hello",
        attachment_file_ids: [fileId],
        delivery: "local_handoff",
        recipient_confirmed: true,
      });
    const foreign = await attach(w.ids.fil_id);
    const missing = await attach(newId("fil", NOW));
    expect(foreign.status).toBe(missing.status);
    expect([404, 422]).toContain(foreign.status);
    expect(foreign.body.error).toBe(missing.body.error);
    expect(foreign.body.details?.reason).toBe(missing.body.details?.reason);
    expect(snapshotOf(w)).toBe(before);
  });

  it("S-31 T11-ISO control: the owner's own calls are not 404 (B's 404s come from ownership)", async () => {
    // Each owner call runs in a fresh world so earlier writes cannot hide
    // a resource (DELETE before GET).
    const failures: string[] = [];
    for (const route of notFoundRoutes(placeholderIds())) {
      const w = await buildWorld(B_EMAIL);
      const sweepCase = sweepCases(w.ids)[routeKeyOf(route)] as SweepCase;
      const { res } = await runCase(w, w.a, route, sweepCase);
      if (res.status === 404 || res.status >= 500) {
        failures.push(
          `${routeKeyOf(route)}: owner got ${res.status} ${res.text.slice(0, 200)}`
        );
      }
    }
    expect(failures).toEqual([]);
  }, 300_000);
});

function placeholderIds(): Ids {
  const id = (prefix: Parameters<typeof newId>[0]) => newId(prefix, NOW);
  return {
    ans_id: id("ans"),
    csr_id: id("csr"),
    app_id: id("app"),
    apr_id: id("apr"),
    att_id: id("att"),
    cvv_id: id("cvv"),
    dev_id: id("dev"),
    eml_id: id("eml"),
    export_id: `exp_${newUlid(NOW)}`,
    fil_id: id("fil"),
    inbox_ujb_id: id("ujb"),
    ivw_id: id("ivw"),
    lease_id: id("lse"),
    ofr_id: id("ofr"),
    posting_id: id("pst"),
    queued_tsk_id: id("tsk"),
    run_id: id("run"),
    rul_id: id("rul"),
    src_id: id("src"),
    tsk_id: id("tsk"),
    ujb_id: id("ujb"),
  };
}

// ---------------------------------------------------------------------------
// T11-SCOPES — scope declarations and the credential matrix
// ---------------------------------------------------------------------------

/** The only routes that may skip an OAuth scope. */
const UNSCOPED_ROUTES: Record<string, "none" | "any"> = {
  "GET /api/v1/meta": "none",
  "GET /api/v1/me": "any",
  "GET /api/v1/account/delete/confirm": "none",
  "POST /api/v1/account/delete/confirm": "none",
  "POST /api/v1/telemetry": "none",
  "POST /api/v1/telemetry/crash": "none",
};

/** Scopes a long-lived personal token may never use (05 §1.2, 17 §5). */
const PRIVILEGED: readonly OAuthScope[] = [
  "automation:execute",
  "ai:invoke",
  "automation:manage",
];

function grants(route: RouteTableEntry, scopes: readonly string[]): boolean {
  if (route.scope === "none" || route.scope === "any") {
    return true;
  }
  const primary =
    scopes.includes(route.scope) ||
    (route.alt_scope !== null && scopes.includes(route.alt_scope));
  return primary && route.also_requires.every((s) => scopes.includes(s));
}

function dummyPath(pattern: string): string {
  return pattern.replace(PARAM_RE, (_, name: string) => {
    const prefix = name === "posting_id" ? "pst" : name.split("_")[0];
    return `${prefix}_${newUlid(NOW)}`;
  });
}

async function deniedRoutes(
  session: V1Session,
  routes: RouteTableEntry[]
): Promise<string[]> {
  const wrong: string[] = [];
  for (const route of routes) {
    const res = await session.call<Body>(
      route.method,
      dummyPath(route.pattern),
      {
        body: route.method === "GET" ? undefined : {},
        idempotencyKey: route.idempotency === "none" ? undefined : newUlid(),
      }
    );
    if (res.status !== 403 || res.body?.error !== "insufficient_scope") {
      wrong.push(`${routeKeyOf(route)} → ${res.status} ${res.body?.error}`);
    }
  }
  return wrong;
}

describe("T11-SCOPES every route declares a scope; tokens stay within theirs (17 §15 item 7)", () => {
  let client: V1Client;
  beforeAll(() => {
    client = createV1Client(createTestEnv({}, { flags: FLAGS }), {
      clock: createFakeClock(NOW),
    });
  });

  it("T11-SCOPES every route declares an OAuth scope; none / any only on the allow-list", () => {
    const known = new Set<string>(OAUTH_SCOPES);
    for (const route of listRouteTable()) {
      const key = routeKeyOf(route);
      if (route.scope === "none" || route.scope === "any") {
        expect({ key, scope: UNSCOPED_ROUTES[key] }).toEqual({
          key,
          scope: route.scope,
        });
        continue;
      }
      expect(known.has(route.scope), key).toBe(true);
      if (route.alt_scope !== null) {
        expect(known.has(route.alt_scope), key).toBe(true);
      }
      for (const scope of route.also_requires) {
        expect(known.has(scope), key).toBe(true);
      }
    }
    // Every write route needs a write-class scope.
    for (const route of listRouteTable()) {
      if (route.method !== "GET" && !(routeKeyOf(route) in UNSCOPED_ROUTES)) {
        expect(
          grants(route, PERSONAL_READ_SCOPES),
          `${routeKeyOf(route)} is a write route a read token could call`
        ).toBe(false);
      }
    }
  });

  it("T11-SCOPES a read-only personal token gets 403 insufficient_scope on every write route", async () => {
    const reader = await client.personalToken("reader@example.com", "read");
    const writes = listRouteTable().filter(
      (route) => !grants(route, PERSONAL_READ_SCOPES)
    );
    const nonGet = listRouteTable().filter(
      (r) => r.method !== "GET" && !(routeKeyOf(r) in UNSCOPED_ROUTES)
    );
    expect(writes.length).toBeGreaterThanOrEqual(nonGet.length);
    expect(await deniedRoutes(reader, writes)).toEqual([]);
  });

  it("T11-SCOPES a personal write token is denied automation:execute, ai:invoke and automation:manage routes", async () => {
    const writer = await client.personalToken("writer@example.com", "write");
    const privileged = listRouteTable().filter(
      (route) => !grants(route, PERSONAL_WRITE_SCOPES)
    );
    // Every route that can only be reached with a privileged scope is here.
    for (const route of listRouteTable()) {
      const needs = [route.scope, ...route.also_requires];
      const viaAlt =
        route.alt_scope !== null &&
        PERSONAL_WRITE_SCOPES.includes(route.alt_scope);
      if (needs.some((s) => PRIVILEGED.includes(s as OAuthScope)) && !viaAlt) {
        expect(privileged.map(routeKeyOf)).toContain(routeKeyOf(route));
      }
    }
    expect(
      privileged.some((r) => r.scope === "automation:execute") &&
        privileged.some((r) => r.scope === "ai:invoke") &&
        privileged.some((r) => r.scope === "automation:manage")
    ).toBe(true);
    expect(await deniedRoutes(writer, privileged)).toEqual([]);
  });

  it("T11-SCOPES an MCP OAuth token gets the personal write ceiling (no automation, no AI)", async () => {
    const mcp = await client.mcpOAuthToken("mcp@example.com");
    const privileged = listRouteTable().filter(
      (route) => !grants(route, MCP_OAUTH_SCOPES)
    );
    expect(await deniedRoutes(mcp, privileged)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T11-MCP-SWEEP — every MCP jobs_* tool
// ---------------------------------------------------------------------------

const MCP_A: Caller = { email: A_EMAIL, isAdmin: false, scope: "write" };
const MCP_B: Caller = { email: B_EMAIL, isAdmin: false, scope: "write" };
const MCP_ADMIN: Caller = { email: ADMIN_EMAIL, isAdmin: true, scope: "write" };

interface McpWorld {
  approvalHash: string;
  approvalId: string;
  appId: string;
  itemId: string;
  jobId: string;
  sectionId: string;
  t: TestEnv;
  userA: string;
}

async function buildMcpWorld(backend: "kv" | "d1"): Promise<McpWorld> {
  const t = createTestEnv(
    {},
    { flags: { JOBS_LEGACY_BACKEND: backend, JOBS_AUTOMATION_ENABLED: true } }
  );
  const alice = createToolSession(t.env, MCP_A);
  const jobId = "alice-acme";
  const created = await alice.call("jobs_create", {
    job_id: jobId,
    title: "Alice secret role",
    company: "Acme",
    status: "saved",
  });
  expect(textOf(created)).not.toContain("not");
  await alice.call("jobs_section_add", { job_id: jobId, name: "Prep" });
  const job = JSON.parse(
    textOf(await alice.call("jobs_get", { job_id: jobId }))
  ) as Body;
  const sectionId = job.sections?.[0]?.id ?? job.job?.sections?.[0]?.id;
  await alice.call("jobs_item_add", {
    job_id: jobId,
    section_id: sectionId,
    title: "Read the blog",
  });
  const withItem = JSON.parse(
    textOf(await alice.call("jobs_get", { job_id: jobId }))
  ) as Body;
  const sections = withItem.sections ?? withItem.job?.sections;
  const itemId = sections[0].items[0].id as string;
  const userA = (await ensureUser(t.env.DB, A_EMAIL, NOW)).id;
  const app = seedReadyApp(t, userA);
  const approvalId = newId("apr", NOW);
  const approvalHash = "e".repeat(64);
  insert(t, "approvals", {
    id: approvalId,
    user_id: userA,
    kind: "answer",
    application_id: app.appId,
    payload: JSON.stringify({
      type: "answer",
      question: "Notice period?",
      options: null,
      suggested: null,
      sensitivity: "none",
    }),
    payload_hash: approvalHash,
    expires_at: Date.now() + 86_400_000,
    created_at: Date.now(),
  });
  t.jobsSqlite
    .query(
      "INSERT INTO user_settings (user_id, allow_mcp_approvals, updated_at) VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET allow_mcp_approvals = 1"
    )
    .run(userA, Date.now());
  return {
    t,
    jobId,
    sectionId,
    itemId,
    appId: app.appId,
    approvalId,
    approvalHash,
    userA,
  };
}

/** One call per `jobs_*` tool with A's ids. */
function mcpCases(
  w: McpWorld
): Record<string, { args: Record<string, unknown>; list?: true }> {
  const job = { job_id: w.jobId };
  return {
    jobs_list: { args: {}, list: true },
    jobs_board: { args: {}, list: true },
    jobs_approvals_list: { args: {}, list: true },
    jobs_get: { args: job },
    jobs_update: { args: { ...job, title: "Bob was here" } },
    jobs_delete: { args: job },
    jobs_move: { args: { ...job, stage: "preparing" } },
    jobs_note_add: { args: { ...job, text: "intruder" } },
    jobs_interview_add: { args: job },
    jobs_offer_add: { args: job },
    jobs_section_add: { args: { ...job, name: "Bob" } },
    jobs_section_update: {
      args: { ...job, section_id: w.sectionId, name: "Bob" },
    },
    jobs_section_delete: { args: { ...job, section_id: w.sectionId } },
    jobs_item_add: { args: { ...job, section_id: w.sectionId, title: "x" } },
    jobs_item_update: {
      args: { ...job, section_id: w.sectionId, item_id: w.itemId, title: "x" },
    },
    jobs_item_delete: {
      args: { ...job, section_id: w.sectionId, item_id: w.itemId },
    },
    jobs_approval_decide: {
      args: {
        approval_id: w.approvalId,
        decision: "approve",
        payload_hash: w.approvalHash,
      },
    },
    // A create with A's id must not touch A's job (B gets its own or a
    // refusal that says nothing about A).
    jobs_create: { args: { ...job, title: "Bob's take" }, list: true },
  };
}

function aliceState(w: McpWorld): string {
  return JSON.stringify([
    w.t.jobsSqlite
      .query(
        "SELECT id, stage, revision, sections, updated_at FROM applications WHERE user_id = ? ORDER BY id"
      )
      .all(w.userA),
    w.t.jobsSqlite
      .query("SELECT state, revision FROM approvals WHERE id = ?")
      .all(w.approvalId),
  ]);
}

const NOT_FOUND_RE = /not found/i;

/** Calls every tool as the intruder; returns leaks and non-"not found"s. */
async function mcpFailures(
  w: McpWorld,
  intruder: ReturnType<typeof createToolSession>,
  tools: string[]
): Promise<string[]> {
  const cases = mcpCases(w);
  const secrets = [
    "Alice secret role",
    A_EMAIL,
    w.sectionId,
    w.itemId,
    w.appId,
  ];
  const failures: string[] = [];
  for (const name of tools) {
    const sweepCase = cases[name];
    const text = textOf(await intruder.call(name, sweepCase.args));
    for (const secret of secrets.filter((x) => text.includes(x))) {
      failures.push(`${name}: leaked ${secret}`);
    }
    if (!(sweepCase.list || NOT_FOUND_RE.test(text))) {
      failures.push(`${name}: ${text.slice(0, 160)}`);
    }
  }
  return failures;
}

describe("T11-MCP-SWEEP every MCP jobs_* tool is isolated (11 §13, D-26)", () => {
  for (const backend of ["d1", "kv"] as const) {
    for (const [label, caller] of [
      ["user B", MCP_B],
      ["an admin", MCP_ADMIN],
    ] as const) {
      it(`T11-MCP-SWEEP ${label} with A's ids gets not found on every jobs_* tool (${backend} backend)`, async () => {
        const w = await buildMcpWorld(backend);
        const intruder = createToolSession(w.t.env, caller);
        // jobs_create runs last: B's own job under A's legacy id must not
        // shadow A's job for the other tools.
        const tools = [...intruder.tools.keys()]
          .filter((name) => name.startsWith("jobs_"))
          .sort(
            (x, y) => Number(x === "jobs_create") - Number(y === "jobs_create")
          );
        const cases = mcpCases(w);
        expect(tools.filter((name) => !(name in cases))).toEqual([]);
        const aliceView = textOf(
          await createToolSession(w.t.env, MCP_A).call("jobs_get", {
            job_id: w.jobId,
          })
        );
        const before = aliceState(w);
        const failures = await mcpFailures(w, intruder, tools);
        expect(failures).toEqual([]);
        expect(aliceState(w)).toBe(before);
        expect(
          textOf(
            await createToolSession(w.t.env, MCP_A).call("jobs_get", {
              job_id: w.jobId,
            })
          )
        ).toBe(aliceView);
      });
    }
  }
});
