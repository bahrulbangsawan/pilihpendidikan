// `bun run db:seed:demo -- --email you@example.com` — fills the LOCAL dev
// stack with a lived-in Job Tracker for one user: applications on every
// board column (notes, interviews, offers, follow-ups), an inbox of scored
// postings from a discovery run, sources, rules, profile facts and answers,
// a demo device, and automation tasks waiting on approvals.
//
//   bun scripts/seed-demo.ts --email you@example.com
//   bun scripts/seed-demo.ts --email you@example.com --reset   # wipe first
//   bun scripts/seed-demo.ts --email … --api-url http://localhost:8788 --persist-to .tmp/state
//
// Everything goes through the real routes of a RUNNING local api (`bun run
// dev`), so stages, revisions, events and invariants hold. The only direct
// write is the browser session: a random bearer whose SHA-256 is stored as
// `auth:session:<hash>` in the local AUTH_KV (`wrangler kv key put --local`,
// exactly what the e-mail sign-in stores); it is deleted again at the end.
// Signing in with the same e-mail on the dashboard (:4007) shows the data.
// The demo device signs in like the CLI does (OAuth PKCE consent with that
// session, `POST /api/v1/devices`). This script only ever passes `--local`
// and refuses `--remote` and non-localhost API URLs.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CVDataSchema } from "@pilihpendidikan/cv-engine/schema";
import { CLI_BASE_SCOPES } from "../src/jobs/core/scopes";
import {
  contentHash,
  fingerprint,
  primaryLocation,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  DemoApplication,
  DemoJob,
  DemoOffer,
  DemoSource,
} from "./seed-demo-data";
import {
  DEMO_ANSWERS,
  DEMO_APPLICATIONS,
  DEMO_DEVICE_NAME,
  DEMO_PERSONA,
  DEMO_POSTINGS,
  DEMO_RULES,
  DEMO_SKILLS,
  DEMO_SOURCES,
  DEMO_TARGET_TITLES,
  demoCv,
  describe,
} from "./seed-demo-data";

const API_DIR = join(import.meta.dir, "..");
const DAY = 86_400_000;
const HOUR = 3_600_000;
const JAKARTA_OFFSET = 7 * HOUR;
const SESSION_TTL_SECONDS = 2 * 3600;
const CLI_VERSION = "0.1.0";
const CLIENT_ID = "pilih-jobs-cli";
const CAPABILITIES = ["discover", "apply", "render_cv", "headed_browser"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORM_INPUT = /<input type="hidden" name="([^"]+)" value="([^"]*)"/g;
const APPROVE_FORM =
  /<form method="post" action="\/oauth\/authorize\/decision">([\s\S]*?)<\/form>/g;
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
};
const HTML_ENTITY = /&(?:amp|lt|gt|quot|#39|#x27);/g;
const TRAILING_SLASH = /\/$/;
const HTML_TAG = /<[^>]+>/g;
const SPACES = /\s+/g;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export interface Options {
  apiUrl: string;
  email: string;
  persistTo: string | null;
  reset: boolean;
}

const USAGE =
  "usage: bun run db:seed:demo -- --email you@example.com [--reset] [--api-url http://localhost:8788] [--persist-to <dir>]";

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    apiUrl: "http://localhost:8788",
    email: "",
    persistTo: null,
    reset: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--remote") {
      throw new Error(
        "seed-demo only writes the local dev stack (never --remote)"
      );
    }
    if (arg === "--email") {
      options.email = (argv[++i] ?? "").trim().toLowerCase();
    } else if (arg === "--api-url") {
      options.apiUrl = (argv[++i] ?? "").replace(TRAILING_SLASH, "");
    } else if (arg === "--persist-to") {
      options.persistTo = argv[++i] ?? null;
    } else if (arg === "--reset") {
      options.reset = true;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(USAGE);
    } else {
      throw new Error(`unknown argument "${arg}"\n${USAGE}`);
    }
  }
  validateOptions(options);
  return options;
}

/** A real e-mail and a localhost API (the session only exists locally). */
function validateOptions(options: Options): void {
  if (!options.email.includes("@")) {
    throw new Error(`--email is required\n${USAGE}`);
  }
  let url: URL;
  try {
    url = new URL(options.apiUrl);
  } catch {
    throw new Error(`--api-url is not a URL: ${options.apiUrl}`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `--api-url must be a local wrangler dev (localhost), not ${url.hostname}`
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface Res<T> {
  body: T;
  headers: Headers;
  status: number;
}

let keyCounter = 0;
function newKey(label: string): string {
  keyCounter += 1;
  return `seed-demo-${label}-${Date.now().toString(36)}-${keyCounter}-${randomBytes(3).toString("hex")}`;
}

type Query = Record<string, string | number | boolean | undefined>;

class Api {
  readonly base: string;
  readonly bearer: string;
  readonly headers: Record<string, string>;

  constructor(
    base: string,
    bearer: string,
    headers: Record<string, string> = {}
  ) {
    this.base = base;
    this.bearer = bearer;
    this.headers = headers;
  }

  async call<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { key?: string | false; query?: Query } = {}
  ): Promise<Res<T>> {
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.bearer}`,
      ...this.headers,
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (method !== "GET" && opts.key !== false) {
      headers["idempotency-key"] = opts.key ?? newKey("req");
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  /** Throws unless the status is one of `ok`. */
  async ok<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { key?: string | false; ok?: number[]; query?: Query } = {}
  ): Promise<T> {
    const res = await this.call<T>(method, path, body, opts);
    const expected = opts.ok ?? [200, 201, 202, 204];
    if (!expected.includes(res.status)) {
      throw new Error(
        `${method} ${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 600)}`
      );
    }
    return res.body;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.ok<T>("GET", path, undefined, { query });
  }

  /** Every item of a paginated list (05 §1.5). */
  async all<T>(path: string, query: Query = {}): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.get<{ items: T[]; next_cursor: string | null }>(
        path,
        { ...query, limit: 200, cursor }
      );
      items.push(...page.items);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return items;
  }
}

// ---------------------------------------------------------------------------
// Local session (AUTH_KV) and flags
// ---------------------------------------------------------------------------

function wrangler(args: string[], persistTo: string | null): void {
  const full = ["wrangler", ...args, "--local"];
  if (persistTo) {
    full.push("--persist-to", persistTo);
  }
  const result = spawnSync("bunx", full, { cwd: API_DIR, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `wrangler ${args.slice(0, 3).join(" ")} failed:\n${result.stderr || result.stdout}`
    );
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A browser-session bearer for `email` (what `/auth/verify` stores). */
function mintSession(
  email: string,
  persistTo: string | null
): {
  bearer: string;
  key: string;
} {
  const bearer = randomBytes(32).toString("base64url");
  const key = `auth:session:${sha256Hex(bearer)}`;
  wrangler(
    [
      "kv",
      "key",
      "put",
      "--binding",
      "AUTH_KV",
      "--ttl",
      String(SESSION_TTL_SECONDS),
      key,
      JSON.stringify({ email, createdAt: Date.now() }),
    ],
    persistTo
  );
  return { bearer, key };
}

function dropSession(key: string, persistTo: string | null): void {
  try {
    wrangler(["kv", "key", "delete", "--binding", "AUTH_KV", key], persistTo);
  } catch {
    // it expires on its own (SESSION_TTL_SECONDS)
  }
}

async function requireApi(apiUrl: string): Promise<string[]> {
  let meta: { features?: string[] };
  try {
    const res = await fetch(`${apiUrl}/api/v1/meta`);
    meta = (await res.json()) as { features?: string[] };
  } catch {
    throw new Error(
      `No api at ${apiUrl}. Start it first: cd apps/api && bun run db:migrate:local && bun run db:migrate:jobs:local && bun run db:seed:local && bun run dev`
    );
  }
  return meta.features ?? [];
}

/** Turns the flags on through seed-local.ts when /api/v1 is dark. */
async function ensureFlags(options: Options): Promise<string[]> {
  let features = await requireApi(options.apiUrl);
  if (features.includes("jobs_v1")) {
    return features;
  }
  console.log("The Job Tracker is dark locally: running db:seed:local …");
  const args = ["scripts/seed-local.ts"];
  if (options.persistTo) {
    args.push("--persist-to", options.persistTo);
  }
  const result = spawnSync("bun", args, { cwd: API_DIR, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("db:seed:local failed");
  }
  // Flags are cached for 30 s per isolate (D-33).
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    features = await requireApi(options.apiUrl);
    if (features.includes("jobs_v1")) {
      return features;
    }
    await sleep(2000);
  }
  throw new Error(
    "JOBS_V1_ENABLED is still off. Did the api start with another --persist-to? Restart it after `bun run db:seed:local`."
  );
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();

/** `hour:00` Jakarta time, `days` from today. */
function atJakarta(days: number, hour: number): number {
  const local = new Date(NOW + days * DAY + JAKARTA_OFFSET);
  local.setUTCHours(hour, 0, 0, 0);
  return local.getTime() - JAKARTA_OFFSET;
}

function daysAgo(days: number): number {
  return NOW - days * DAY;
}

// ---------------------------------------------------------------------------
// Records (the subset this script reads)
// ---------------------------------------------------------------------------

interface AppRecord {
  id: string;
  revision: number;
  stage: string;
  user_job_id: string;
}
interface UserJobRecord {
  id: string;
  inbox_state: string;
  posting_id: string;
}
interface DeviceRecord {
  accepts_tasks: boolean;
  id: string;
  name: string;
  revision: number;
  revoked_at: number | null;
}
interface TaskRecord {
  application_id: string | null;
  id: string;
  state: string;
}

interface Tally {
  [what: string]: number;
}

function bump(tally: Tally, what: string, by = 1): void {
  tally[what] = (tally[what] ?? 0) + by;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

const TERMINAL_TASK_STATES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "outcome_unknown",
]);

async function reset(web: Api): Promise<void> {
  console.log("--reset: removing this user's Job Tracker data …");
  const tally: Tally = {};
  for (const task of await web.all<TaskRecord>("/api/v1/tasks")) {
    if (TERMINAL_TASK_STATES.has(task.state)) {
      continue;
    }
    const res = await web.call("POST", `/api/v1/tasks/${task.id}/cancel`);
    if (res.status < 300) {
      bump(tally, "tasks cancelled");
    }
  }
  const devices = await web.all<DeviceRecord>("/api/v1/devices");
  for (const device of devices) {
    if (device.name === DEMO_DEVICE_NAME && device.revoked_at === null) {
      await web.ok("POST", `/api/v1/devices/${device.id}/revoke`, {});
      bump(tally, "demo devices revoked");
    }
  }
  const apps = await web.all<AppRecord>("/api/v1/applications", {
    include_archived: "1",
  });
  for (const app of apps) {
    await web.ok("DELETE", `/api/v1/applications/${app.id}`, undefined, {
      query: { purge: "1" },
    });
    bump(tally, "applications purged");
  }
  for (const rule of await web.all<{ id: string }>("/api/v1/rules")) {
    await web.ok("DELETE", `/api/v1/rules/${rule.id}`);
    bump(tally, "rules deleted");
  }
  // The demo sources stay: their postings keep their provenance (inbox
  // states cannot be reset through the API, see seedDiscovery).
  const demoLabels = new Set(DEMO_SOURCES.map((source) => source.label));
  const sources = await web.all<{ id: string; label: string }>(
    "/api/v1/sources"
  );
  for (const source of sources.filter((s) => !demoLabels.has(s.label))) {
    await web.ok("DELETE", `/api/v1/sources/${source.id}`);
    bump(tally, "sources deleted");
  }
  for (const answer of await web.all<{ id: string }>(
    "/api/v1/profile/answers"
  )) {
    await web.ok("DELETE", `/api/v1/profile/answers/${answer.id}`);
    bump(tally, "answers deleted");
  }
  const facts = await web.get<{ facts: Array<{ key: string }> }>(
    "/api/v1/profile/facts"
  );
  if (facts.facts.length > 0) {
    await web.ok("PUT", "/api/v1/profile/facts", {
      facts: [],
      delete_keys: facts.facts.map((f) => f.key),
    });
    bump(tally, "facts deleted", facts.facts.length);
  }
  console.log(`  ${formatTally(tally) || "nothing to remove"}`);
}

function formatTally(tally: Tally): string {
  return Object.entries(tally)
    .map(([what, n]) => `${n} ${what}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Profile, settings, base CV
// ---------------------------------------------------------------------------

async function seedSettings(web: Api): Promise<void> {
  const { settings } = await web.get<{ settings: { revision: number } }>(
    "/api/v1/settings"
  );
  await web.ok("PATCH", "/api/v1/settings", {
    base_revision: settings.revision,
    ai_consent: true,
    timezone: "Asia/Jakarta",
    default_mode: "approval",
    generated_text_allowed: true,
  });
}

/** The persona's base CV in the CV builder store (MCP `cv_create` + PUT). */
async function seedBaseCv(
  options: Options,
  session: string
): Promise<string | null> {
  const cvId = `demo-cv-${sha256Hex(options.email).slice(0, 8)}`;
  const data = demoCv(options.email);
  const checked = CVDataSchema.safeParse(data);
  if (!checked.success) {
    throw new Error(
      `the demo CV does not match CVDataSchema: ${JSON.stringify(checked.error.issues).slice(0, 400)}`
    );
  }
  const headers = {
    authorization: `Bearer ${session}`,
    "content-type": "application/json",
  };
  const existing = await fetch(`${options.apiUrl}/api/cv/${cvId}`, {
    headers,
  });
  if (existing.status === 404) {
    await mcpCall(options.apiUrl, session, "cv_create", {
      cv_id: cvId,
      full_name: `${DEMO_PERSONA.first} ${DEMO_PERSONA.last}`,
      job_title: "Senior Backend Engineer",
    });
  } else {
    await existing.text();
  }
  const put = await fetch(`${options.apiUrl}/api/cv/${cvId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });
  if (!put.ok) {
    console.warn(
      `  base CV not saved (${put.status} ${(await put.text()).slice(0, 200)}); continuing without it`
    );
    return null;
  }
  return cvId;
}

function rpcResult(text: string): Record<string, unknown> {
  const payload = text.trim().startsWith("{")
    ? text
    : (text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .at(-1) ?? "{}");
  return JSON.parse(payload) as Record<string, unknown>;
}

/** One MCP tool call over Streamable HTTP (as e2e/harness/applicant.ts). */
async function mcpCall(
  origin: string,
  bearer: string,
  tool: string,
  args: Record<string, unknown>
): Promise<void> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const init = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "pilih-seed-demo", version: "1.0.0" },
      },
    }),
  });
  if (!init.ok) {
    throw new Error(`mcp initialize → ${init.status} ${await init.text()}`);
  }
  await init.text();
  const sessionId = init.headers.get("mcp-session-id");
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }
  const protocol = init.headers.get("mcp-protocol-version");
  if (protocol) {
    headers["mcp-protocol-version"] = protocol;
  }
  await fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  }).then((r) => r.text());
  const call = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const body = rpcResult(await call.text());
  const result = body.result as { isError?: boolean } | undefined;
  if (!call.ok || body.error || result?.isError) {
    throw new Error(
      `mcp ${tool} → ${call.status} ${JSON.stringify(body).slice(0, 400)}`
    );
  }
}

async function seedProfile(
  web: Api,
  email: string,
  cvId: string | null
): Promise<void> {
  const facts: Array<{ key: string; value: unknown }> = [
    { key: "contact.first_name", value: DEMO_PERSONA.first },
    { key: "contact.last_name", value: DEMO_PERSONA.last },
    {
      key: "contact.full_name",
      value: `${DEMO_PERSONA.first} ${DEMO_PERSONA.last}`,
    },
    { key: "contact.email", value: email },
    { key: "contact.phone", value: DEMO_PERSONA.phone },
    { key: "contact.location", value: DEMO_PERSONA.location },
    { key: "contact.country", value: "Indonesia" },
    { key: "links.linkedin", value: DEMO_PERSONA.linkedin },
    { key: "links.github", value: DEMO_PERSONA.github },
    { key: "skills.extra", value: DEMO_SKILLS },
    { key: "prefs.target_titles", value: DEMO_TARGET_TITLES },
    { key: "prefs.workplace_types", value: ["hybrid", "remote"] },
    { key: "prefs.timezone", value: "Asia/Jakarta" },
    { key: "eligibility.age_18_plus", value: true },
  ];
  if (cvId) {
    facts.push({ key: "profile.primary_cv_id", value: cvId });
  }
  const res = await web.call("PUT", "/api/v1/profile/facts", { facts });
  if (res.status >= 300) {
    // A fact the contract shapes differently: write the rest one by one.
    for (const fact of facts) {
      const one = await web.call("PUT", "/api/v1/profile/facts", {
        facts: [fact],
      });
      if (one.status >= 300) {
        console.warn(`  fact ${fact.key} skipped (${one.status})`);
      }
    }
  }
  const existing = new Set(
    (await web.all<{ question_key: string }>("/api/v1/profile/answers")).map(
      (a) => a.question_key
    )
  );
  for (const answer of DEMO_ANSWERS) {
    if (!existing.has(answer.question_key)) {
      await web.ok("POST", "/api/v1/profile/answers", answer);
    }
  }
}

// ---------------------------------------------------------------------------
// Device (the CLI's login, 17 §10.1)
// ---------------------------------------------------------------------------

function decodeHtml(value: string): string {
  return value.replace(HTML_ENTITY, (m) => HTML_ENTITIES[m] ?? m);
}

/** The fields of the consent page's approve form. */
function approveForm(html: string): URLSearchParams | null {
  for (const match of html.matchAll(APPROVE_FORM)) {
    const inner = match[1];
    if (!inner.includes('value="approve"')) {
      continue;
    }
    const form = new URLSearchParams();
    for (const input of inner.matchAll(FORM_INPUT)) {
      form.set(input[1], decodeHtml(input[2]));
    }
    form.set("decision", "approve");
    return form;
  }
  return null;
}

/**
 * Signs the demo device in exactly like `pilih-jobs login`: authorize with
 * the browser session, approve, exchange the code (PKCE), then register (or
 * re-bind via `device_hint`) the device. Returns a device-bound client.
 */
async function signInDevice(
  options: Options,
  session: string,
  web: Api
): Promise<{ device: DeviceRecord; cli: Api }> {
  const previous = (await web.all<DeviceRecord>("/api/v1/devices")).find(
    (d) => d.name === DEMO_DEVICE_NAME && d.revoked_at === null
  );
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://127.0.0.1:53682/callback";
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: randomBytes(32).toString("base64url"),
    scope: CLI_BASE_SCOPES.join(" "),
    device_name: DEMO_DEVICE_NAME,
  });
  if (previous) {
    query.set("device_hint", previous.id);
  }
  const cookie = `session=${session}`;
  const page = await fetch(`${options.apiUrl}/oauth/authorize?${query}`, {
    headers: { cookie },
    redirect: "manual",
  });
  const html = await page.text();
  const form = approveForm(html);
  if (!form) {
    const reason = html.replace(HTML_TAG, " ").replace(SPACES, " ").trim();
    throw new Error(
      `the consent page (${page.status}) has no approve form: ${reason.slice(0, 300)}`
    );
  }
  const decision = await fetch(`${options.apiUrl}/oauth/authorize/decision`, {
    method: "POST",
    headers: {
      cookie,
      origin: options.apiUrl,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    redirect: "manual",
  });
  const location = decision.headers.get("location") ?? "";
  const code = location ? new URL(location).searchParams.get("code") : null;
  if (!code) {
    throw new Error(
      `consent decision → ${decision.status} without a code: ${(await decision.text()).slice(0, 300)}`
    );
  }
  const token = await fetch(`${options.apiUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
    }).toString(),
  });
  const tokens = (await token.json()) as { access_token?: string };
  if (!tokens.access_token) {
    throw new Error(
      `token exchange → ${token.status} ${JSON.stringify(tokens)}`
    );
  }
  const cli = new Api(options.apiUrl, tokens.access_token, {
    "x-pilih-client": `cli/${CLI_VERSION}`,
  });
  const me = await cli.get<{ device: DeviceRecord | null }>("/api/v1/me");
  let device = me.device;
  if (!device) {
    const registered = await cli.ok<{ device: DeviceRecord }>(
      "POST",
      "/api/v1/devices",
      {
        name: DEMO_DEVICE_NAME,
        platform: "macos",
        arch: "arm64",
        cli_version: CLI_VERSION,
        capabilities: CAPABILITIES,
      }
    );
    device = registered.device;
  }
  const fresh = (await web.all<DeviceRecord>("/api/v1/devices")).find(
    (d) => d.id === device.id
  );
  if (fresh && !fresh.accepts_tasks) {
    await web.ok("PATCH", `/api/v1/devices/${device.id}`, {
      base_revision: fresh.revision,
      accepts_tasks: true,
    });
  }
  await cli.ok("POST", `/api/v1/devices/${device.id}/heartbeat`, {
    cli_version: CLI_VERSION,
    local_state_summary: {},
    active_lease_ids: [],
    outbox_depth: 0,
    outbox_dead: 0,
    last_sync_at: Date.now(),
    browser: { mode: "managed", status: "ready" },
    capabilities: CAPABILITIES,
  });
  return { device, cli };
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

function manualJobBody(job: DemoJob): Record<string, unknown> {
  return {
    title: job.title,
    company_name: job.company,
    company_domain: job.domain,
    apply_url: job.applyUrl,
    canonical_url: job.applyUrl,
    department: job.department,
    locations: [job.location],
    workplace_type: job.workplace,
    employment_type: job.employment,
    seniority: job.seniority,
    salary: job.salary,
    description_text: describe(job),
    requirements: job.requirements,
    posted_at: daysAgo(job.postedDaysAgo),
  };
}

async function currentRevision(web: Api, appId: string): Promise<number> {
  const detail = await web.get<{ application: AppRecord }>(
    `/api/v1/applications/${appId}`
  );
  return detail.application.revision;
}

async function patchApp(
  web: Api,
  appId: string,
  body: Record<string, unknown>
): Promise<void> {
  await web.ok("PATCH", `/api/v1/applications/${appId}`, {
    base_revision: await currentRevision(web, appId),
    ...body,
  });
}

const PREP_STAGES = new Set(["saved", "preparing", "ready"]);

async function seedInterviews(
  web: Api,
  id: string,
  demo: DemoApplication,
  tally: Tally
): Promise<void> {
  for (const [index, interview] of (demo.interviews ?? []).entries()) {
    await web.ok("POST", `/api/v1/applications/${id}/interviews`, {
      kind: interview.kind,
      round: index + 1,
      scheduled_at: atJakarta(interview.days, interview.hour),
      duration_min: interview.durationMin,
      timezone: "Asia/Jakarta",
      location: interview.location,
      interviewers: interview.interviewers,
      outcome: interview.outcome,
      notes: interview.notes ?? "",
    });
    bump(tally, "interviews");
  }
}

async function seedOffer(
  web: Api,
  id: string,
  offer: DemoOffer,
  tally: Tally
): Promise<void> {
  const compensation: Record<string, unknown> = {
    base: offer.base,
    currency: offer.currency,
    period: offer.period,
  };
  if (offer.bonus) {
    compensation.bonus = offer.bonus;
  }
  if (offer.equity) {
    compensation.equity = offer.equity;
  }
  const res = await web.ok<{ offer: { id: string; revision: number } }>(
    "POST",
    `/api/v1/applications/${id}/offers`,
    {
      received_at: daysAgo(offer.receivedDaysAgo),
      compensation,
      deadline_at: atJakarta(offer.deadlineInDays, 17),
      status: "open",
      notes: offer.notes,
    }
  );
  bump(tally, "offers");
  if (offer.accept) {
    await web.ok("PATCH", `/api/v1/applications/${id}/offers/${res.offer.id}`, {
      base_revision: res.offer.revision,
      status: "accepted",
    });
  }
}

/** Closing stage, follow-up date, priority and notes. */
async function seedFinish(
  web: Api,
  id: string,
  demo: DemoApplication,
  tally: Tally
): Promise<void> {
  if (demo.stage === "rejected" || demo.stage === "withdrawn") {
    await patchApp(web, id, { stage: demo.stage });
  }
  const extra: Record<string, unknown> = {};
  if (demo.followUpInDays !== undefined) {
    extra.follow_up_at = atJakarta(demo.followUpInDays, 9);
  }
  if (demo.priority !== undefined) {
    extra.priority = demo.priority;
  }
  if (Object.keys(extra).length > 0) {
    await patchApp(web, id, extra);
  }
  for (const note of demo.notes ?? []) {
    await web.ok("POST", `/api/v1/applications/${id}/events`, {
      type: "note_added",
      payload: { text: note.text },
      idempotency_key: newKey("note"),
      occurred_at: daysAgo(note.daysAgo),
    });
    bump(tally, "notes");
  }
}

/** Creates one application and walks it to its column. Null when it existed. */
async function seedApplication(
  web: Api,
  demo: DemoApplication,
  tally: Tally
): Promise<AppRecord | null> {
  const { user_job } = await web.ok<{ user_job: UserJobRecord }>(
    "POST",
    "/api/v1/user-jobs",
    manualJobBody(demo.job)
  );
  const created = await web.call<{ application: AppRecord }>(
    "POST",
    "/api/v1/applications",
    {
      user_job_id: user_job.id,
      stage: PREP_STAGES.has(demo.stage) ? demo.stage : "saved",
      mode: demo.mode ?? "manual",
    }
  );
  if (created.status === 200) {
    bump(tally, "applications already present");
    return null;
  }
  if (created.status !== 201) {
    throw new Error(
      `POST /api/v1/applications → ${created.status} ${JSON.stringify(created.body)}`
    );
  }
  const { id, revision } = created.body.application;
  if (demo.appliedDaysAgo !== undefined) {
    await web.ok("POST", `/api/v1/applications/${id}/submission`, {
      base_revision: revision,
      action: "mark_applied",
      applied_at: daysAgo(demo.appliedDaysAgo),
      method: demo.appliedMethod ?? "manual",
    });
  }
  await seedInterviews(web, id, demo, tally);
  if (demo.offer) {
    await seedOffer(web, id, demo.offer, tally);
  }
  await seedFinish(web, id, demo, tally);
  const final = await web.get<{ application: AppRecord }>(
    `/api/v1/applications/${id}`
  );
  if (final.application.stage !== demo.stage) {
    console.warn(
      `  ${demo.job.company}: ended in ${final.application.stage}, wanted ${demo.stage}`
    );
  }
  bump(tally, "applications");
  return final.application;
}

// ---------------------------------------------------------------------------
// Sources, discovery run, inbox
// ---------------------------------------------------------------------------

async function seedSources(web: Api): Promise<Map<DemoSource, string>> {
  const existing = await web.all<{ id: string; label: string }>(
    "/api/v1/sources"
  );
  const ids = new Map<DemoSource, string>();
  for (const source of DEMO_SOURCES) {
    const found = existing.find((s) => s.label === source.label);
    if (found) {
      ids.set(source, found.id);
      continue;
    }
    const res = await web.ok<{ source: { id: string } }>(
      "POST",
      "/api/v1/sources",
      {
        adapter: source.adapter,
        label: source.label,
        config: source.config,
        enabled: source.enabled,
        schedule: source.schedule,
      }
    );
    ids.set(source, res.source.id);
  }
  return ids;
}

async function postingItem(
  job: DemoJob,
  source: DemoSource,
  sourceId: string,
  ref: string
): Promise<Record<string, unknown>> {
  const applyUrl = job.applyUrl.endsWith("/")
    ? `${job.applyUrl}${ref}`
    : job.applyUrl;
  const description = describe(job);
  const observedAt = Date.now();
  return {
    client_ref: ref,
    fingerprint: await fingerprint({
      source_kind: source.adapter,
      source_org: source.org,
      source_job_ref: ref,
      title: job.title,
      company_domain: job.domain,
      location_primary: primaryLocation([job.location]),
      apply_url: applyUrl,
      canonical_url: applyUrl,
    }),
    visibility: "public",
    source_kind: source.adapter,
    source_org: source.org,
    source_job_ref: ref,
    source_id: sourceId,
    canonical_url: applyUrl,
    apply_url: applyUrl,
    company_name: job.company,
    company_domain: job.domain,
    title: job.title,
    department: job.department,
    locations: [job.location],
    workplace_type: job.workplace,
    employment_type: job.employment,
    seniority: job.seniority,
    salary: job.salary,
    description_text: description,
    requirements: job.requirements,
    posted_at: daysAgo(job.postedDaysAgo),
    content_hash: await contentHash(job.title, description),
    observed_at: observedAt,
    extraction: {
      v: 1,
      adapter: source.adapter,
      adapter_version: "1.0.0",
      engine: { pilih_jobs: CLI_VERSION },
      fetch_mode: "json_api",
      method: "json_api",
      confidence: 0.97,
      observed_at: observedAt,
    },
  };
}

interface BatchOutcome {
  client_ref: string;
  outcome: string;
  user_job_id?: string;
}

/**
 * One discovery run per source, as the CLI reports it. Refs are stable, so a
 * re-run reports the postings `unchanged` and their inbox state stays as it
 * is: no route returns a dismissed or seen job to `new`, and the inbox hides
 * a fresh copy behind a handled one of the same dedupe group (15 §11).
 */
async function seedDiscovery(
  cli: Api,
  device: DeviceRecord,
  sourceIds: Map<DemoSource, string>,
  tally: Tally
): Promise<Map<string, string>> {
  const userJobs = new Map<string, string>();
  for (const [index, source] of DEMO_SOURCES.entries()) {
    const postings = DEMO_POSTINGS.filter((p) => p.source === index);
    const sourceId = sourceIds.get(source);
    if (postings.length === 0 || !sourceId) {
      continue;
    }
    const runId = newId("run");
    await cli.ok("POST", "/api/v1/discovery/runs", {
      id: runId,
      sources: [
        { source_id: sourceId, adapter: source.adapter, label: source.label },
      ],
      device_id: device.id,
      engine_version: `pilih-jobs ${CLI_VERSION}; scrapling 0.4.15`,
      started_at: Date.now() - 40_000,
    });
    const items: Record<string, unknown>[] = [];
    for (const [n, posting] of postings.entries()) {
      items.push(
        await postingItem(
          posting.job,
          source,
          sourceId,
          `demo-${source.org}-${n + 1}`
        )
      );
    }
    const batch = await cli.ok<{ items: BatchOutcome[] }>(
      "POST",
      `/api/v1/discovery/runs/${runId}/postings:batch`,
      { items }
    );
    const outcomes: Tally = {};
    for (const [n, item] of batch.items.entries()) {
      bump(outcomes, item.outcome);
      if (item.user_job_id) {
        userJobs.set(
          postings[n].job.title + postings[n].job.company,
          item.user_job_id
        );
      }
    }
    await cli.ok("POST", `/api/v1/discovery/runs/${runId}/complete`, {
      status: "completed",
      finished_at: Date.now(),
      stats: {
        pages: 1,
        postings_found: items.length,
        new: outcomes.new ?? 0,
        updated: outcomes.updated ?? 0,
        unchanged: outcomes.unchanged ?? 0,
        invalid: outcomes.invalid ?? 0,
      },
      errors: [],
      complete_sources: [],
    });
    bump(tally, "postings new", outcomes.new ?? 0);
    bump(
      tally,
      "postings unchanged",
      (outcomes.unchanged ?? 0) + (outcomes.updated ?? 0)
    );
    bump(tally, "discovery runs");
    if (outcomes.invalid) {
      console.warn(
        `  ${source.label}: ${outcomes.invalid} invalid items ${JSON.stringify(batch.items.filter((i) => i.outcome === "invalid")).slice(0, 400)}`
      );
    }
  }
  return userJobs;
}

async function triageInbox(
  web: Api,
  userJobs: Map<string, string>,
  tally: Tally
): Promise<void> {
  for (const action of ["track", "seen", "dismiss"] as const) {
    const ids = DEMO_POSTINGS.filter((p) => p.triage === action)
      .map((p) => userJobs.get(p.job.title + p.job.company))
      .filter((id): id is string => typeof id === "string");
    if (ids.length > 0) {
      await web.ok("POST", "/api/v1/inbox:bulk", {
        user_job_ids: ids,
        action,
      });
      bump(tally, `inbox ${action}`, ids.length);
    }
  }
}

/** Scores every tracked and discovered job; waits briefly for the queue. */
async function seedScores(web: Api, tally: Tally): Promise<void> {
  const inbox = await web.all<{ user_job: UserJobRecord }>("/api/v1/inbox");
  const apps = await web.all<AppRecord>("/api/v1/applications");
  const ids = [
    ...new Set([
      ...inbox.map((i) => i.user_job.id),
      ...apps.map((a) => a.user_job_id),
    ]),
  ];
  if (ids.length === 0) {
    return;
  }
  const res = await web.ok<{ queued: string[]; cached: string[] }>(
    "POST",
    "/api/v1/scores:request",
    { user_job_ids: ids.slice(0, 500) }
  );
  bump(tally, "scores requested", res.queued.length);
  const deadline = Date.now() + 60_000;
  let scored = 0;
  while (Date.now() < deadline) {
    const page = await web.all<{ score: unknown }>("/api/v1/inbox");
    scored = page.filter((i) => i.score !== null).length;
    if (scored === page.length) {
      break;
    }
    await sleep(2000);
  }
  bump(tally, "inbox items scored", scored);
}

// ---------------------------------------------------------------------------
// Rules and automation
// ---------------------------------------------------------------------------

async function seedRules(
  web: Api,
  features: string[],
  tally: Tally
): Promise<void> {
  const existing = new Set(
    (await web.all<{ name: string }>("/api/v1/rules")).map((r) => r.name)
  );
  const autoMode = features.includes("auto_mode");
  for (const rule of DEMO_RULES) {
    if (existing.has(rule.name)) {
      continue;
    }
    // An enabled `auto` rule waits for a rule_activation approval; that
    // needs JOBS_AUTO_MODE_ENABLED, so it stays off otherwise.
    const enabled = rule.mode === "auto" ? autoMode : rule.enabled;
    await web.ok("POST", "/api/v1/rules", { ...rule, enabled });
    bump(tally, "rules");
  }
}

interface Claim {
  context: { posting: { id: string; apply_url: string | null } } | null;
  lease: { attempt_id: string; lease_id: string };
  task: TaskRecord;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function submitPayload(
  claim: Claim,
  device: DeviceRecord,
  email: string
): Record<string, unknown> {
  const posting = claim.context?.posting;
  const url = posting?.apply_url ?? "https://boards.greenhouse.io/";
  const field = (
    label: string,
    value: string,
    source: string,
    aiWritten = false
  ) => ({
    label,
    value_display: value,
    value_source: source,
    sensitivity: "none",
    ai_written: aiWritten,
  });
  return {
    type: "browser_submit",
    form_hash: sha256Hex(`${claim.task.id}:form`),
    url,
    posting_id: posting?.id,
    attempt_id: claim.lease.attempt_id,
    device_id: device.id,
    fields: [
      field("First name", DEMO_PERSONA.first, "fact"),
      field("Last name", DEMO_PERSONA.last, "fact"),
      field("Email", email, "fact"),
      field("Phone", DEMO_PERSONA.phone, "fact"),
      field("LinkedIn profile", DEMO_PERSONA.linkedin, "fact"),
      field("Notice period", "One month", "answer"),
      field(
        "Why do you want to join us?",
        "I have spent four years on payment and logistics backends in Go, and your fulfillment team works on exactly the reliability problems I enjoy: high-traffic peaks, idempotent APIs and clean reconciliation.",
        "generated_text",
        true
      ),
    ],
    attachments: [],
    screenshot_file_id: null,
  };
}

function answerPayload(claim: Claim): Record<string, unknown> {
  return {
    type: "answer",
    attempt_id: claim.lease.attempt_id,
    questions: [
      {
        ref: "q1",
        question:
          "Will you now or in the future require visa sponsorship to work in Singapore?",
        field_kind: "radio",
        required: true,
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
        question_key: "work_authorization.singapore_sponsorship",
        sensitivity: "personal",
        suggestion: null,
      },
      {
        ref: "q2",
        question: "What are your salary expectations (SGD per year)?",
        field_kind: "text",
        required: true,
        options: [],
        question_key: "compensation.expected_salary_sgd",
        sensitivity: "personal",
        suggestion: null,
      },
    ],
  };
}

/**
 * Apply tasks for the `ready` cards: two claimed by the demo device that
 * ask for an approval (submit / answer) and release the lease, one queued
 * for the device, one cancelled. Nothing is ever submitted.
 */
async function seedAutomation(
  web: Api,
  cli: Api,
  device: DeviceRecord,
  email: string,
  created: Array<{ app: AppRecord; demo: DemoApplication }>,
  tally: Tally
): Promise<void> {
  for (const { app, demo } of created) {
    if (!demo.task) {
      continue;
    }
    const { task } = await web.ok<{ task: TaskRecord }>(
      "POST",
      "/api/v1/tasks",
      {
        kind: "apply",
        application_id: app.id,
        payload: { mode: "approval" },
        target_device_id: device.id,
        idempotency_key: newKey("task"),
      }
    );
    bump(tally, "tasks");
    if (demo.task === "cancelled") {
      await web.ok("POST", `/api/v1/tasks/${task.id}/cancel`);
      continue;
    }
    if (demo.task === "queued") {
      continue;
    }
    const claim = await cli.call<Claim>(
      "POST",
      `/api/v1/devices/${device.id}/tasks:claim`,
      { capabilities: CAPABILITIES, max: 1 }
    );
    if (claim.status !== 200 || claim.body.task.id !== task.id) {
      console.warn(
        `  claim for ${demo.job.company} → ${claim.status}; the task stays queued`
      );
      continue;
    }
    const { lease } = claim.body;
    const base = `/api/v1/tasks/${task.id}/lease/${lease.lease_id}`;
    await cli.ok("POST", `${base}/events`, {
      events: [
        {
          type: "started",
          idempotency_key: newKey("evt"),
          occurred_at: Date.now(),
        },
      ],
    });
    const kind = demo.task === "submit_approval" ? "submit" : "answer";
    const payload =
      kind === "submit"
        ? submitPayload(claim.body, device, email)
        : answerPayload(claim.body);
    await cli.ok("POST", `${base}/approvals`, {
      kind,
      payload,
      payload_hash: sha256Hex(canonicalJson(payload)),
    });
    await cli.ok("POST", `${base}/release`, { reason: "awaiting_approval" });
    bump(tally, "approvals pending");
  }
}

/** Best effort: a tailored CV variant for the first `ready` card. */
async function seedCvVariant(
  web: Api,
  cvId: string,
  created: Array<{ app: AppRecord; demo: DemoApplication }>,
  tally: Tally
): Promise<void> {
  const target = created.find((c) => c.demo.task === "submit_approval");
  if (!target) {
    return;
  }
  const res = await web.call(
    "POST",
    `/api/v1/applications/${target.app.id}/cv-variants`,
    { base_cv_id: cvId, template: "standard", tailor: true }
  );
  if (res.status < 300) {
    bump(tally, "CV variants");
  } else {
    console.warn(`  CV variant skipped (${res.status})`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seed(options: Options, session: string): Promise<void> {
  const features = await ensureFlags(options);
  const web = new Api(options.apiUrl, session);
  const me = await web.call<{ user_id: string; email: string }>(
    "GET",
    "/api/v1/me"
  );
  if (me.status !== 200) {
    throw new Error(
      `GET /api/v1/me → ${me.status} ${JSON.stringify(me.body)}. Is the api using the same local state (--persist-to)?`
    );
  }
  console.log(
    `Seeding ${me.body.email} (${me.body.user_id}) on ${options.apiUrl}`
  );
  if (options.reset) {
    await reset(web);
  }
  const tally: Tally = {};

  await seedSettings(web);
  const cvId = await seedBaseCv(options, session);
  await seedProfile(web, options.email, cvId);
  console.log(
    `  profile: facts, ${DEMO_ANSWERS.length} answers, base CV ${cvId ?? "(none)"}`
  );

  const sourceIds = await seedSources(web);
  const { device, cli } = await signInDevice(options, session, web);
  console.log(`  device: ${device.name} (${device.id})`);
  const userJobs = await seedDiscovery(cli, device, sourceIds, tally);
  await triageInbox(web, userJobs, tally);

  const created: Array<{ app: AppRecord; demo: DemoApplication }> = [];
  for (const demo of DEMO_APPLICATIONS) {
    const app = await seedApplication(web, demo, tally);
    if (app) {
      created.push({ app, demo });
    }
  }
  console.log(`  applications: ${formatTally(tally)}`);

  await seedAutomation(web, cli, device, options.email, created, tally);
  if (cvId) {
    await seedCvVariant(web, cvId, created, tally);
  }
  await seedScores(web, tally);
  // After scoring: enabled rules act on scored postings (evaluate_rules), and
  // the demo board should not depend on queue timing.
  await seedRules(web, features, tally);

  const board = await web.get<{
    columns: Array<{ stage: string; total: number }>;
    counts: Record<string, number>;
  }>("/api/v1/board");
  console.log(`Done: ${formatTally(tally)}`);
  console.log(
    `Board: ${board.columns.map((c) => `${c.stage} ${c.total}`).join(", ")}`
  );
  console.log(`Counts: ${JSON.stringify(board.counts)}`);
  console.log(
    `Sign in on the dashboard (http://localhost:4007) as ${options.email} to see it.`
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await requireApi(options.apiUrl);
  const { bearer, key } = mintSession(options.email, options.persistTo);
  try {
    await seed(options, bearer);
  } finally {
    dropSession(key, options.persistTo);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}
