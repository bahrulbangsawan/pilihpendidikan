// A scoring world for the route and consumer tests: one user with AI consent,
// a primary base CV in CV_KV (owned), facts, and tracked postings.
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { KernelDeps } from "../../core/deps";
import type {
  DrainOptions,
  FakeClock,
  TestEnv,
  V1Client,
  V1Session,
} from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import { seedPosting, seedUserJob } from "../../../../test/seed-jobs";
import { sampleCv } from "../../services/scoring/fixtures.test";

export interface ScoringWorld {
  client: V1Client;
  clock: FakeClock;
  drain(
    deps?: KernelDeps,
    overrides?: DrainOptions["overrides"]
  ): ReturnType<TestEnv["queue"]["drain"]>;
  t: TestEnv;
  userId: string;
  web: V1Session;
}

export const EMAIL = "alice@example.com";
export const CV_ID = "alice-backend-cv";

export function insertFact(
  t: TestEnv,
  userId: string,
  key: string,
  value: unknown,
  now: number
): void {
  t.jobsSqlite
    .query(
      "INSERT INTO applicant_facts (id, user_id, key, value, source, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 'user_entered', 1, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, revision = revision + 1, updated_at = excluded.updated_at"
    )
    .run(newId("fct", now), userId, key, JSON.stringify(value), now, now);
}

export function setConsent(
  t: TestEnv,
  userId: string,
  now: number | null,
  extra: Record<string, number | string> = {}
): void {
  const columns = [
    "user_id",
    "ai_consent_at",
    "updated_at",
    ...Object.keys(extra),
  ];
  t.jobsSqlite
    .query(
      `INSERT INTO user_settings (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT(user_id) DO UPDATE SET ai_consent_at = excluded.ai_consent_at${Object.keys(
        extra
      )
        .map((k) => `, ${k} = excluded.${k}`)
        .join("")}`
    )
    .run(userId, now, now ?? 0, ...Object.values(extra));
}

export async function scoringWorld(
  options: { consent?: boolean } = {}
): Promise<ScoringWorld> {
  const t = createTestEnv();
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const web = await client.browserSession(EMAIL);
  const userId = web.userId as string;
  const now = clock.now();
  if (options.consent !== false) {
    setConsent(t, userId, now);
  }
  await t.env.CV_KV.put(`cv:${CV_ID}`, JSON.stringify(sampleCv()));
  await t.env.CV_KV.put(`owner:cv:${CV_ID}`, EMAIL);
  insertFact(t, userId, "profile.primary_cv_id", CV_ID, now);
  insertFact(t, userId, "prefs.target_titles", ["Backend Engineer"], now);
  insertFact(
    t,
    userId,
    "prefs.locations",
    [{ country_code: "ID", city: "Bandung" }],
    now
  );
  insertFact(t, userId, "work_auth.ID", { status: "citizen" }, now);
  return {
    t,
    clock,
    client,
    web,
    userId,
    drain: (deps, overrides) =>
      t.queue.drain(t.env, { deps: { clock, ...deps }, overrides }),
  };
}

const TITLES = [
  "Backend Engineer",
  "Senior Data Engineer",
  "Frontend Developer",
  "Platform Engineer",
  "Product Designer",
];

/** A tracked posting with realistic text. */
export function trackedPosting(
  world: Pick<ScoringWorld, "t" | "userId" | "clock">,
  index: number,
  overrides: Record<string, string | number | null> = {}
): string {
  const now = world.clock.now();
  const posting = seedPosting(world.t.jobsSqlite, {
    title: TITLES[index % TITLES.length],
    company_name: `Company ${index}`,
    requirements: JSON.stringify([
      "Must have strong Python and PostgreSQL experience",
      index % 2 === 0
        ? "Experience with AWS and Docker"
        : "Kubernetes is required",
    ]),
    description_text: `Team ${index} builds services. English required for written communication.`,
    locations: JSON.stringify([
      { raw: "Remote - Indonesia", country_code: "ID" },
    ]),
    workplace_type: "remote",
    posted_at: now - (index % 30) * 86_400_000,
    first_seen_at: now - (index % 30) * 86_400_000,
    ...overrides,
  });
  seedUserJob(world.t.jobsSqlite, world.userId, {
    posting_id: posting.id,
    inbox_state: "new",
  });
  return posting.id;
}

/** Rows of match_scores for the user, decoded. */
export function scoreRows(
  world: Pick<ScoringWorld, "t" | "userId">
): Record<string, unknown>[] {
  return (
    world.t.jobsSqlite
      .query("SELECT * FROM match_scores WHERE user_id = ? ORDER BY posting_id")
      .all(world.userId) as Record<string, unknown>[]
  ).map((row) => ({ ...row, components: JSON.parse(String(row.components)) }));
}

/** The user's ai_usage rows by purpose. */
export function usageRows(
  world: Pick<ScoringWorld, "t" | "userId">
): Record<string, { calls: number; cost_micro_usd: number }> {
  const rows = world.t.jobsSqlite
    .query(
      "SELECT purpose, calls, cost_micro_usd FROM ai_usage WHERE user_id = ?"
    )
    .all(world.userId) as Array<{
    calls: number;
    cost_micro_usd: number;
    purpose: string;
  }>;
  return Object.fromEntries(
    rows.map((row) => [
      row.purpose,
      { calls: row.calls, cost_micro_usd: row.cost_micro_usd },
    ])
  );
}
