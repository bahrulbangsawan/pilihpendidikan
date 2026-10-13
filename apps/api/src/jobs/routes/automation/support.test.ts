// Shared fixtures of the automation tests (leaf-2.7). A `.test.ts` file so
// the bun-only fakes never enter the Worker's type program.

import type { FeatureFlagKey } from "@pilihpendidikan/jobs-contracts/enums";
import { newId, newUlid } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  AutomationTaskRecord,
  MatchScoreRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import type {
  CliSessionOptions,
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
import {
  seedApplication,
  seedPosting,
  seedTask,
  seedUserJob,
} from "../../../../test/seed-jobs";
import type { UserScope } from "../../core/scope";
import { trustedScope } from "../../core/scope";
import { CLI_BASE_SCOPES } from "../../core/scopes";
import type { JobsDb } from "../../repo/core/db";
import { decodeRow, jobsDb } from "../../repo/core/db";
import { computeProfileVersion } from "../../repo/core/profile-version";

/** 2026-10-12 09:00 UTC (16:00 in Asia/Jakarta, the default timezone). */
export const NOW = Date.UTC(2026, 9, 12, 9);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const FORM_HASH = "a".repeat(64);
export const OTHER_HASH = "b".repeat(64);

type Row = Record<string, string | number | null>;

/** A response body the tests assert on dynamically. */
// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field
export type Body = any;

export interface Fixture {
  cli: V1Session;
  client: V1Client;
  clock: FakeClock;
  db: JobsDb;
  scope: UserScope;
  t: TestEnv;
  userId: string;
  web: V1Session;
}

export interface SetupOptions {
  cli?: CliSessionOptions;
  email?: string;
  flags?: Partial<Record<FeatureFlagKey, boolean>>;
}

/** A fresh env (automation on) with a web session and a CLI device. */
export async function setup(options: SetupOptions = {}): Promise<Fixture> {
  const t = createTestEnv(
    {},
    { flags: { JOBS_AUTOMATION_ENABLED: true, ...options.flags } }
  );
  const clock = createFakeClock(NOW);
  const client = createV1Client(t, { clock });
  const email = options.email ?? "alice@example.com";
  const web = await client.browserSession(email);
  const cli = await client.cliSession(email, options.cli);
  const userId = web.userId as string;
  return {
    t,
    clock,
    client,
    web,
    cli,
    db: jobsDb(t.env),
    scope: trustedScope(userId, "script"),
    userId,
  };
}

/** CLI scopes with the step-up `automation:manage` (D-29). */
export const MANAGE_SCOPES = [...CLI_BASE_SCOPES, "automation:manage"];

let counter = 0;

/** A unique idempotency key. */
export function key(prefix = "k"): string {
  counter += 1;
  return `${prefix}:${counter}:${newUlid()}`;
}

export interface SeededApp {
  appId: string;
  postingId: string;
  userJobId: string;
}

/** A greenhouse posting (browser_supported, auto-capable) + its card. */
export function seedReadyApp(
  t: TestEnv,
  userId: string,
  options: { app?: Row; posting?: Row; userJob?: Row } = {}
): SeededApp {
  const posting = seedPosting(t.jobsSqlite, {
    apply_url: "https://boards.greenhouse.io/acme/jobs/1",
    apply_domain: "greenhouse.io",
    application_support: "browser_supported",
    source_kind: "greenhouse",
    company_domain: "acme.com",
    company_name: "Acme",
    title: "Backend Engineer",
    description_text: "We build Go and Postgres services.",
    workplace_type: "remote",
    ...options.posting,
  });
  const userJob = seedUserJob(t.jobsSqlite, userId, {
    posting_id: posting.id,
    ...options.userJob,
  });
  const app = seedApplication(t.jobsSqlite, userId, {
    user_job_id: userJob.id,
    stage: "ready",
    mode: "approval",
    ...options.app,
  });
  return { appId: app.id, postingId: posting.id, userJobId: userJob.id };
}

/** A queued task row (claimable now unless overridden). */
export function seedQueued(
  t: TestEnv,
  userId: string,
  overrides: Row = {}
): string {
  return seedTask(t.jobsSqlite, userId, {
    payload: JSON.stringify({ mode: "approval" }),
    required_capabilities: JSON.stringify(["apply"]),
    not_before: NOW - HOUR,
    expires_at: NOW + 72 * HOUR,
    created_at: NOW - HOUR,
    updated_at: NOW - HOUR,
    ...overrides,
  }).id;
}

export function taskRow(t: TestEnv, id: string): AutomationTaskRecord {
  const row = t.jobsSqlite
    .query("SELECT * FROM automation_tasks WHERE id = ?")
    .get(id) as Record<string, unknown>;
  return decodeRow<AutomationTaskRecord>("automation_tasks", row);
}

export function appRow(t: TestEnv, id: string): Record<string, unknown> {
  return t.jobsSqlite
    .query("SELECT * FROM applications WHERE id = ?")
    .get(id) as Record<string, unknown>;
}

export function rows(
  t: TestEnv,
  sql: string,
  ...binds: Array<string | number | null>
): Record<string, unknown>[] {
  return t.jobsSqlite.query(sql).all(...binds) as Record<string, unknown>[];
}

export function eventsOf(
  t: TestEnv,
  appId: string,
  type?: string
): Record<string, unknown>[] {
  return type
    ? rows(
        t,
        "SELECT * FROM application_events WHERE application_id = ? AND type = ? ORDER BY recorded_at, rowid",
        appId,
        type
      )
    : rows(
        t,
        "SELECT * FROM application_events WHERE application_id = ? ORDER BY recorded_at, rowid",
        appId
      );
}

export function changesOf(
  t: TestEnv,
  entity: string,
  id: string
): Record<string, unknown>[] {
  return rows(
    t,
    "SELECT * FROM change_log WHERE entity = ? AND entity_id = ? ORDER BY seq",
    entity,
    id
  );
}

/** POST /api/v1/tasks as the given session. */
export async function createTask(
  session: V1Session,
  body: Record<string, unknown>
): Promise<V1Response<Body>> {
  return await session.post<Body>(
    "/api/v1/tasks",
    { payload: {}, idempotency_key: key("task"), ...body },
    { idempotencyKey: key("hdr") }
  );
}

export async function claim(
  cli: V1Session,
  capabilities: string[] = ["discover", "apply", "render_cv"],
  idempotencyKey?: string
): Promise<V1Response<Body>> {
  return await cli.post<Body>(
    `/api/v1/devices/${cli.deviceId}/tasks:claim`,
    { capabilities, max: 1 },
    { idempotencyKey: idempotencyKey ?? `claim:${cli.deviceId}:${newUlid()}` }
  );
}

/** A lease-scoped POST (`…/lease/{l}/<path>`). */
export async function leasePost(
  cli: V1Session,
  taskId: string,
  leaseId: string,
  path: string,
  body: unknown,
  idempotencyKey: string = key(path)
): Promise<V1Response<Body>> {
  return await cli.post<Body>(
    `/api/v1/tasks/${taskId}/lease/${leaseId}/${path}`,
    body,
    {
      idempotencyKey,
    }
  );
}

export async function heartbeat(
  cli: V1Session,
  taskId: string,
  leaseId: string,
  stage = "filling"
): Promise<V1Response<Body>> {
  return await leasePost(cli, taskId, leaseId, "heartbeat", {
    progress: { stage, step: 1, message: "working" },
    local_state: "running",
  });
}

/** Claims and returns `{taskId, leaseId, attemptId?}` (asserts a 200). */
export async function claimOne(
  cli: V1Session,
  capabilities?: string[]
): Promise<{ body: Body; leaseId: string; taskId: string }> {
  const res = await claim(cli, capabilities);
  if (res.status !== 200) {
    throw new Error(`claim answered ${res.status}: ${res.text}`);
  }
  return {
    body: res.body,
    taskId: res.body.task.id,
    leaseId: res.body.lease.lease_id,
  };
}

export function browserSubmitPayload(
  postingId: string,
  formHash: string = FORM_HASH
): Record<string, unknown> {
  return {
    type: "browser_submit",
    form_hash: formHash,
    url: "https://boards.greenhouse.io/acme/jobs/1",
    posting_id: postingId,
    fields: [
      {
        label: "Email",
        value_display: "alice@example.com",
        value_source: "fact",
        sensitivity: "personal",
        ai_written: false,
      },
    ],
    attachments: [],
  };
}

/** Device asks for a submit approval → returns the approval body. */
export async function requestSubmitApproval(
  cli: V1Session,
  taskId: string,
  leaseId: string,
  postingId: string,
  formHash: string = FORM_HASH
): Promise<V1Response<Body>> {
  return await leasePost(cli, taskId, leaseId, "approvals", {
    kind: "submit",
    payload: browserSubmitPayload(postingId, formHash),
    payload_hash: formHash,
  });
}

export async function decide(
  web: V1Session,
  approval: { id: string; payload_hash: string },
  decision: "approve" | "reject" = "approve",
  extra: Record<string, unknown> = {}
): Promise<V1Response<Body>> {
  return await web.post<Body>(
    `/api/v1/approvals/${approval.id}/decide`,
    { decision, payload_hash: approval.payload_hash, ...extra },
    { idempotencyKey: key("decide") }
  );
}

export function evidence(
  verdict: "verified" | "unverified" | "negative",
  capturedAt: number = NOW
): Record<string, unknown> {
  return {
    kind: "browser_confirmation",
    verdict,
    signals: {
      url_match: verdict !== "negative",
      negative_marker: verdict === "negative",
    },
    final_url: "https://boards.greenhouse.io/acme/jobs/1/confirmation",
    page_title: "Thanks",
    text_excerpt: "Application received",
    form_hash: FORM_HASH,
    captured_at: capturedAt,
  };
}

/** Claim → approval → decide → submit-intent: a task past its intent. */
export async function toIntent(
  fx: Fixture,
  app: SeededApp
): Promise<{ leaseId: string; taskId: string }> {
  const created = await createTask(fx.web, {
    kind: "apply",
    application_id: app.appId,
    payload: { mode: "approval" },
  });
  if (created.status !== 201) {
    throw new Error(`create answered ${created.status}: ${created.text}`);
  }
  const { taskId, leaseId } = await claimOne(fx.cli);
  await heartbeat(fx.cli, taskId, leaseId);
  const approval = await requestSubmitApproval(
    fx.cli,
    taskId,
    leaseId,
    app.postingId
  );
  const decided = await decide(fx.web, approval.body.approval);
  if (decided.status !== 200) {
    throw new Error(`decide answered ${decided.status}: ${decided.text}`);
  }
  const intent = await leasePost(fx.cli, taskId, leaseId, "submit-intent", {
    form_hash: FORM_HASH,
    approval_id: approval.body.approval.id,
  });
  if (intent.status !== 200) {
    throw new Error(`submit-intent answered ${intent.status}: ${intent.text}`);
  }
  return { taskId, leaseId };
}

/** A `ready` r1 score of the user's CURRENT profile version (07 §10). */
export async function seedScore(
  fx: Fixture,
  postingId: string,
  overrides: Partial<MatchScoreRecord> & {
    gates?: unknown[];
    aiStatus?: string;
  } = {}
): Promise<void> {
  const version =
    overrides.profile_version ??
    (await computeProfileVersion(fx.t.env, fx.db, fx.scope));
  const components = {
    rubric_version: "r1",
    features: {
      skills_overlap: null,
      title_similarity: null,
      location_fit: null,
      seniority_fit: null,
      salary_fit: null,
      language_fit: null,
      freshness: null,
    },
    ai: {
      status: overrides.aiStatus ?? "ok",
      overall_fit: { score: 3, confidence: 0.9 },
      weight: 0.2,
      predicates: {},
      refused: [],
    },
    gates: overrides.gates ?? [],
    base: 0.9,
    score: overrides.score ?? 90,
  };
  fx.t.jobsSqlite
    .query(
      "INSERT INTO match_scores (id, user_id, posting_id, profile_version, rubric_version, model, score, confidence, components, explanation, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)"
    )
    .run(
      newId("scr"),
      fx.userId,
      postingId,
      version,
      overrides.rubric_version ?? "r1",
      overrides.model ?? "gpt-6-luna",
      overrides.score ?? 90,
      0.9,
      overrides.status === "queued" ? "{}" : JSON.stringify(components),
      overrides.status ?? "ready",
      overrides.created_at ?? NOW - HOUR
    );
}

/** An `auto` rule with an APPROVED activation (19 §8.3), via the API. */
export async function activeAutoRule(
  fx: Fixture,
  overrides: Record<string, unknown> = {}
): Promise<Body> {
  const created = await fx.web.post<Body>(
    "/api/v1/rules",
    {
      name: "Auto backend",
      mode: "auto",
      enabled: true,
      criteria: {
        min_score: 80,
        require_ai_component: true,
        max_score_age_days: 14,
        exclude_blocking_gates: true,
        exclude_possible_gates: true,
        keywords: ["backend"],
      },
      limits: { max_per_day: 3, max_per_company_per_30d: 3 },
      allowed_domains: ["greenhouse.io"],
      cv_policy: { tailor: false, require_cv_approval: false },
      ...overrides,
    },
    { idempotencyKey: key("rule") }
  );
  if (created.status !== 201) {
    throw new Error(`rule create answered ${created.status}: ${created.text}`);
  }
  const decided = await decide(fx.web, created.body.approval);
  if (decided.status !== 200) {
    throw new Error(`activation answered ${decided.status}: ${decided.text}`);
  }
  return (await fx.web.get<Body>(`/api/v1/rules/${created.body.rule.id}`)).body
    .rule;
}
