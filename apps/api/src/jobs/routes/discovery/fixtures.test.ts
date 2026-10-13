// Shared fixtures of the discovery tests (no tests in this module).
//
//   const f = await discoveryFixture();            // env, fake clock, alice CLI + web
//   const run = await f.startRun(f.cli);           // POST /discovery/runs
//   const a = await postingItem({ ref: "1" });     // a valid full item (fp1 + hash)
//   const res = await f.batch(f.cli, run, [a]);    // POST …/postings:batch

import type { NormalizedPosting } from "@pilihpendidikan/jobs-contracts/api";
import {
  contentHash,
  fingerprint,
  primaryLocation,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
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

export interface DiscoveryFixture {
  /** POSTs a postings batch. */
  batch(
    session: V1Session,
    runId: string,
    items: readonly unknown[],
    options?: { idempotencyKey?: string }
  ): Promise<V1Response<BatchBody>>;
  cli: V1Session;
  client: V1Client;
  clock: FakeClock;
  /** POSTs a completion. */
  complete(
    session: V1Session,
    runId: string,
    body?: Partial<CompleteBody>
  ): Promise<V1Response<{ closed_postings: number; run: RunBody }>>;
  /** Creates a greenhouse source for `session` and returns its id. */
  source(session: V1Session, config?: Record<string, unknown>): Promise<string>;
  /** Starts a run from `session`'s device and returns its id. */
  startRun(
    session: V1Session,
    options?: { sourceId?: string | null }
  ): Promise<string>;
  t: TestEnv;
  web: V1Session;
}

export interface BatchBody {
  items: {
    client_ref: string;
    errors?: { code: string; message: string; path?: string }[];
    outcome: string;
    posting_id?: string;
    user_job_id?: string;
  }[];
}

export interface RunBody {
  errors: unknown[];
  finished_at: number | null;
  id: string;
  revision: number;
  stats: Record<string, unknown>;
  status: string;
}

export interface CompleteBody {
  complete_sources: {
    source_id?: string | null;
    source_kind: string;
    source_org: string | null;
  }[];
  cursor_states?: {
    cursor_state: Record<string, unknown>;
    source_id: string;
  }[];
  errors: unknown[];
  finished_at?: number;
  stats: Record<string, unknown>;
  status: string;
}

export const ALICE = "alice@example.com";
export const BOB = "bob@example.com";

export async function discoveryFixture(): Promise<DiscoveryFixture> {
  const t = createTestEnv();
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const cli = await client.cliSession(ALICE);
  const web = await client.browserSession(ALICE);
  return {
    t,
    clock,
    client,
    cli,
    web,
    async startRun(session, options = {}) {
      const id = newId("run", clock.now());
      const res = await session.post("/api/v1/discovery/runs", {
        id,
        sources: [
          {
            adapter: "greenhouse",
            label: "Acme",
            source_id: options.sourceId ?? null,
          },
        ],
        device_id: session.deviceId,
        engine_version: "pilih-jobs 0.1.0; scrapling 0.4.15",
      });
      if (res.status !== 201) {
        throw new Error(`startRun: ${res.status} ${res.text}`);
      }
      return id;
    },
    batch(session, runId, items, options = {}) {
      return session.post<BatchBody>(
        `/api/v1/discovery/runs/${runId}/postings:batch`,
        { items },
        options
      );
    },
    complete(session, runId, body = {}) {
      return session.post(`/api/v1/discovery/runs/${runId}/complete`, {
        status: "completed",
        stats: {},
        errors: [],
        complete_sources: [],
        ...body,
      });
    },
    async source(session, config = { board_token: "acme" }) {
      const res = await session.post<{ source: { id: string } }>(
        "/api/v1/sources",
        { adapter: "greenhouse", label: "Acme on Greenhouse", config }
      );
      if (res.status !== 201) {
        throw new Error(`source: ${res.status} ${res.text}`);
      }
      return res.body.source.id;
    },
  };
}

export interface ItemOptions {
  apply_url?: string | null;
  canonical_url?: string | null;
  client_ref?: string;
  company_domain?: string | null;
  company_name?: string;
  description?: string;
  location?: string | null;
  observed_at?: number;
  org?: string | null;
  ref?: string | null;
  salary?: NormalizedPosting["salary"];
  source_id?: string | null;
  source_kind?: NormalizedPosting["source_kind"];
  status_evidence?: NormalizedPosting["status_evidence"];
  status_hint?: "closed" | "open";
  title?: string;
  visibility?: "private" | "public";
}

function pick<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

interface ResolvedItem {
  applyUrl: string | null;
  companyDomain: string | null;
  description: string;
  locations: { raw: string }[];
  observedAt: number;
  org: string | null;
  ref: string | null;
  sourceKind: NormalizedPosting["source_kind"];
  title: string;
}

function resolveItem(options: ItemOptions): ResolvedItem {
  const org = pick(options.org, "acme");
  const ref = pick(options.ref, "1001");
  const location = pick(options.location, "Jakarta");
  return {
    sourceKind: options.source_kind ?? "greenhouse",
    ref,
    org,
    title: options.title ?? "Backend Engineer",
    description:
      options.description ??
      "Build and run the payments APIs in Go. Work with PostgreSQL and Kafka.",
    locations: location ? [{ raw: location }] : [],
    applyUrl: pick(
      options.apply_url,
      `https://boards.greenhouse.io/${org ?? "acme"}/jobs/${ref ?? "x"}`
    ),
    companyDomain: pick(options.company_domain, "acme.com"),
    observedAt: options.observed_at ?? Date.UTC(2026, 9, 11, 7),
  };
}

/** A valid full `postings:batch` item with its fp1 and content hash. */
export async function postingItem(
  options: ItemOptions = {}
): Promise<NormalizedPosting> {
  const r = resolveItem(options);
  const canonicalUrl = options.canonical_url ?? null;
  const item: NormalizedPosting = {
    client_ref: options.client_ref ?? `ref-${r.ref ?? r.title}`,
    fingerprint: await fingerprint({
      source_kind: r.sourceKind,
      source_org: r.org,
      source_job_ref: r.ref,
      title: r.title,
      company_domain: r.companyDomain,
      location_primary: primaryLocation(r.locations),
      apply_url: r.applyUrl,
      canonical_url: canonicalUrl,
    }),
    visibility: options.visibility ?? "public",
    source_kind: r.sourceKind,
    source_org: r.org,
    source_job_ref: r.ref,
    source_id: options.source_id ?? null,
    canonical_url: canonicalUrl,
    apply_url: r.applyUrl,
    company_name: options.company_name ?? "Acme",
    company_domain: r.companyDomain,
    title: r.title,
    locations: r.locations,
    workplace_type: "hybrid",
    employment_type: "full_time",
    salary: options.salary ?? null,
    description_text: r.description,
    requirements: ["Go", "PostgreSQL"],
    content_hash: await contentHash(r.title, r.description),
    observed_at: r.observedAt,
    extraction: {
      v: 1,
      adapter: r.sourceKind === "greenhouse" ? "greenhouse" : "career_page",
      adapter_version: "1.0.0",
      fetch_mode: "json_api",
      method: "json_api",
      confidence: 0.98,
      observed_at: r.observedAt,
      source_urls: {
        listing: `https://boards-api.greenhouse.io/v1/boards/${r.org}/jobs`,
      },
    },
  };
  if (options.status_hint) {
    item.status_hint = options.status_hint;
  }
  if (options.status_evidence) {
    item.status_evidence = options.status_evidence;
  }
  return item;
}

/** The unchanged-only form of an item (05 §4). */
export function unchangedItem(
  item: NormalizedPosting,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    client_ref: item.client_ref,
    fingerprint: item.fingerprint,
    content_hash: item.content_hash,
    observed_at: item.observed_at,
    ...overrides,
  };
}

/** One JOBS_DB posting row by id (assertions). */
export function postingRow(
  t: TestEnv,
  id: string
): Record<string, unknown> & {
  closed_at: number | null;
  content_hash: string;
  extraction: string;
  first_seen_at: number;
  last_seen_at: number;
  missed_runs: number;
  revision: number;
  status: string;
  title: string;
} {
  return t.jobsSqlite
    .query("SELECT * FROM job_postings WHERE id = ?")
    .get(id) as ReturnType<typeof postingRow>;
}

/** A user's user_jobs rows. */
export function userJobRows(
  t: TestEnv,
  userId: string
): {
  id: string;
  inbox_state: string;
  origin: string;
  posting_id: string;
  source_id: string | null;
}[] {
  return t.jobsSqlite
    .query("SELECT * FROM user_jobs WHERE user_id = ? ORDER BY rowid")
    .all(userId) as ReturnType<typeof userJobRows>;
}

export function newRunId(clock: FakeClock): string {
  return newId("run", clock.now());
}
