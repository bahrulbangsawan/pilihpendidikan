// Cloud discovery end to end (job-tracker-spec/24): seed catalog, operator
// controls, hourly dispatch, the jobs-scrape consumer with a scripted
// scraper, ingestion / dedupe / expiry, follower fan-out, failure
// classification, retries, the breaker, leases and the AI fallback.

import { beforeEach, describe, expect, it } from "bun:test";
import type { CloudSourceView } from "@pilihpendidikan/jobs-contracts/api";
import { CLOUD_SOURCES_FILE } from "@pilihpendidikan/jobs-contracts/cloud-sources";
import type {
  FakeClock,
  TestEnv,
  V1Client,
  V1Session,
} from "../../../test/fakes";
import {
  createCtx,
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../test/fakes";
import type { FakeScrapeQueue, FakeScraper } from "../../../test/cloud-fakes";
import {
  cloudItem,
  createFakeScraper,
  createFakeScrapeQueue,
  scrapeResponse,
} from "../../../test/cloud-fakes";
import { getAiProvider } from "../ai/provider";
import { CRON_HOURLY, runScheduled } from "../cron/index";

const USER = "rahma@example.com";
const ADMIN = "admin@example.com";
const WWR = "weworkremotely.com";
const HOUR = 3_600_000;

type Body = Record<string, unknown>;

interface World {
  admin: V1Session;
  clock: FakeClock;
  client: V1Client;
  queue: FakeScrapeQueue;
  scraper: FakeScraper;
  t: TestEnv;
  user: V1Session;
}

async function world(flags: Record<string, boolean> = {}): Promise<World> {
  const queue = createFakeScrapeQueue();
  const scraper = createFakeScraper();
  const t = createTestEnv(
    { JOBS_SCRAPE_QUEUE: queue.queue, SCRAPER: scraper.binding },
    { flags: { JOBS_CLOUD_DISCOVERY_ENABLED: true, ...flags } }
  );
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  return {
    t,
    clock,
    client,
    queue,
    scraper,
    user: await client.browserSession(USER),
    admin: await client.browserSession(ADMIN),
  };
}

async function catalog(
  s: V1Session
): Promise<{ items: CloudSourceView[]; viewer: { operator: boolean } }> {
  const res = await s.get<{
    items: CloudSourceView[];
    viewer: { operator: boolean };
  }>("/api/v1/cloud-sources");
  expect(res.status).toBe(200);
  return res.body;
}

async function sourceBySlug(w: World, slug: string): Promise<CloudSourceView> {
  const found = (await catalog(w.user)).items.find((s) => s.slug === slug);
  if (!found) {
    throw new Error(`no source ${slug}`);
  }
  return found;
}

function row(
  w: World,
  sql: string,
  ...binds: (string | number)[]
): Record<string, unknown> {
  return w.t.jobsSqlite.query(sql).get(...binds) as Record<string, unknown>;
}

async function runNow(w: World, sourceId: string, body: Body = {}) {
  const res = await w.admin.post<{ run: { id: string; status: string } }>(
    `/api/v1/cloud-sources/${sourceId}/runs`,
    body
  );
  expect(res.status).toBe(202);
  return res.body.run;
}

async function drain(w: World, ai?: ReturnType<typeof getAiProvider>) {
  return await w.queue.drain(w.t.env, {
    deps: { clock: w.clock, ...(ai ? { ai: () => ai } : {}) },
  });
}

function run(w: World, id: string): Record<string, unknown> {
  const r = row(w, "SELECT * FROM cloud_runs WHERE id = ?", id);
  return {
    ...r,
    stats: JSON.parse(String(r.stats)),
    warnings: JSON.parse(String(r.warnings)),
    log: JSON.parse(String(r.log)),
  };
}

describe("T24-SEED the audited catalog", () => {
  it("T24-SEED-01 registers every audited platform once, the explicit sources included", async () => {
    const w = await world();
    const first = await catalog(w.user);
    expect(first.items).toHaveLength(CLOUD_SOURCES_FILE.sources.length);
    expect(first.viewer.operator).toBe(false);
    const second = await catalog(w.user);
    expect(second.items).toHaveLength(first.items.length);
    expect(row(w, "SELECT count(*) AS n FROM cloud_sources").n).toBe(
      first.items.length
    );
    for (const slug of ["remotefreelance.id", "workfromhome.id", WWR]) {
      const s = first.items.find((x) => x.slug === slug);
      expect(s?.status).toBe("ACTIVE");
    }
    const upwork = first.items.find((x) => x.slug === "upwork.com");
    expect(upwork?.status).toBe("UNSUPPORTED");
    expect(upwork?.status_reason).toContain("freelance marketplace");
    const pangian = first.items.find((x) => x.slug === "pangian.com");
    expect(pangian?.status).toBe("DISABLED");
    expect((await catalog(w.admin)).viewer.operator).toBe(true);
  });
});

describe("T24-OPERATOR catalog management", () => {
  it("T24-OPERATOR-01 only operators edit; edits survive seed syncs and disabled sources stay disabled", async () => {
    const w = await world();
    const wwr = await sourceBySlug(w, WWR);
    const denied = await w.user.patch<Body>(`/api/v1/cloud-sources/${wwr.id}`, {
      base_revision: wwr.revision,
      priority: 5,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("operator_required");
    const ok = await w.admin.patch<{ source: CloudSourceView }>(
      `/api/v1/cloud-sources/${wwr.id}`,
      {
        base_revision: wwr.revision,
        priority: 5,
        enabled: false,
      }
    );
    expect(ok.status).toBe(200);
    expect(ok.body.source.priority).toBe(5);
    expect(ok.body.source.status).toBe("DISABLED");
    expect(ok.body.source.user_modified).toEqual(
      expect.arrayContaining(["priority", "enabled"])
    );
    const stale = await w.admin.patch<Body>(`/api/v1/cloud-sources/${wwr.id}`, {
      base_revision: wwr.revision,
      priority: 6,
    });
    expect(stale.status).toBe(409);
    // A new deploy with a changed seed file: operator edits are kept.
    const { ensureCatalogSeeded } = await import("../services/cloud/seed");
    const { jobsDb } = await import("../repo/core/db");
    await ensureCatalogSeeded(jobsDb(w.t.env), w.clock.now(), { force: true });
    const after = await sourceBySlug(w, WWR);
    expect(after.priority).toBe(5);
    expect(after.enabled).toBe(false);
    expect(
      row(w, "SELECT count(*) AS n FROM cloud_sources WHERE slug = ?", WWR).n
    ).toBe(1);
  });

  it("T24-OPERATOR-02 strategy configs are validated and unsafe URLs refused", async () => {
    const w = await world();
    const wwr = await sourceBySlug(w, WWR);
    const bad = await w.admin.patch<Body>(`/api/v1/cloud-sources/${wwr.id}`, {
      base_revision: wwr.revision,
      strategy: "rss",
      strategy_config: { url: "https://weworkremotely.com/remote-jobs.rss" },
    });
    expect(bad.status).toBe(400);
    const local = await w.admin.post<Body>("/api/v1/cloud-sources", {
      name: "Local",
      url: "http://localhost:8080/jobs",
    });
    expect(local.status).toBe(400);
    const excluded = await w.admin.post<Body>("/api/v1/cloud-sources", {
      name: "LinkedIn",
      url: "https://www.linkedin.com/jobs",
    });
    expect(excluded.status).toBe(422);
    const dup = await w.admin.post<Body>("/api/v1/cloud-sources", {
      name: "WWR again",
      url: "https://weworkremotely.com/categories/remote-programming-jobs",
    });
    expect(dup.status).toBe(409);
    const created = await w.admin.post<{
      source: CloudSourceView;
      run: { kind: string };
    }>("/api/v1/cloud-sources", {
      name: "Example Board",
      url: "https://jobs.example-board.org/",
    });
    expect(created.status).toBe(201);
    expect(created.body.source.origin).toBe("operator");
    expect(created.body.source.enabled).toBe(false);
    expect(created.body.run.kind).toBe("probe");
    expect(w.queue.sent.at(-1)?.body.type).toBe("probe_source");
  });
});

describe("T24-DISPATCH hourly cron", () => {
  it("T24-DISPATCH-01 enqueues each due source once and never scrapes in the cron", async () => {
    const w = await world();
    await catalog(w.user);
    const schedulable = CLOUD_SOURCES_FILE.sources.filter(
      (s) => s.enabled && s.health === "ACTIVE" && s.strategy !== "none"
    );
    await runScheduled({ cron: CRON_HOURLY }, w.t.env, createCtx(), {
      clock: w.clock,
    });
    const scrapes = w.queue.sent.filter((m) => m.body.type === "scrape_source");
    expect(scrapes).toHaveLength(schedulable.length);
    expect(w.scraper.requests).toHaveLength(0);
    expect(w.queue.sent.some((m) => m.body.type === "refresh_directory")).toBe(
      true
    );
    await runScheduled({ cron: CRON_HOURLY }, w.t.env, createCtx(), {
      clock: w.clock,
    });
    expect(
      w.queue.sent.filter((m) => m.body.type === "scrape_source")
    ).toHaveLength(schedulable.length);
  });

  it("T24-DISPATCH-02 does nothing while JOBS_CLOUD_DISCOVERY_ENABLED is off", async () => {
    const w = await world({ JOBS_CLOUD_DISCOVERY_ENABLED: false });
    await runScheduled({ cron: CRON_HOURLY }, w.t.env, createCtx(), {
      clock: w.clock,
    });
    expect(w.queue.sent).toHaveLength(0);
  });
});

describe("T24-SCRAPE ingestion", () => {
  let w: World;
  let wwr: CloudSourceView;
  const url = (n: number) =>
    `https://weworkremotely.com/remote-jobs/acme-engineer-${n}`;

  beforeEach(async () => {
    w = await world();
    wwr = await sourceBySlug(w, WWR);
    const follow = await w.user.put<{ backfilled: number }>(
      `/api/v1/cloud-sources/${wwr.id}/follow`
    );
    expect(follow.status).toBe(200);
    expect(follow.body.backfilled).toBe(0);
  });

  it("T24-SCRAPE-01 stores normalized postings, links followers, never duplicates on re-runs", async () => {
    const now = w.clock.now();
    const items = [
      await cloudItem(
        WWR,
        { title: "Senior Go Engineer", url: url(1), location: "Worldwide" },
        now
      ),
      await cloudItem(WWR, { title: "Product Designer", url: url(2) }, now),
    ];
    w.scraper.scrape = () => scrapeResponse(items);
    const first = await runNow(w, wwr.id);
    await drain(w);
    const r1 = run(w, first.id);
    expect(r1.status).toBe("succeeded");
    expect(r1.stats).toMatchObject({ new: 2, linked: 2, postings_found: 2 });
    expect(
      row(
        w,
        "SELECT count(*) AS n FROM job_postings WHERE cloud_source_id = ?",
        wwr.id
      ).n
    ).toBe(2);
    const posting = row(
      w,
      "SELECT * FROM job_postings WHERE canonical_url = ?",
      url(1)
    );
    expect(posting.source_kind).toBe("generic_listing");
    expect(posting.source_org).toBe(WWR);
    expect(JSON.parse(String(posting.skills))).toEqual(["Go"]);
    expect(posting.employment_detail).toBe("full_time");
    expect(JSON.parse(String(posting.extraction)).cloud.source_id).toBe(wwr.id);
    expect(
      row(
        w,
        "SELECT count(*) AS n FROM user_jobs WHERE user_id = ? AND source_id = ?",
        w.user.userId as string,
        wwr.id
      ).n
    ).toBe(2);
    const inbox = await w.user.get<{
      items: { provenance: { source_id: string; source_label: string } }[];
    }>("/api/v1/inbox", { query: { source: wwr.id } });
    expect(inbox.status).toBe(200);
    expect(inbox.body.items).toHaveLength(2);
    expect(inbox.body.items[0].provenance).toMatchObject({
      source_id: wwr.id,
      source_label: "We Work Remotely",
    });
    const source = await sourceBySlug(w, WWR);
    expect(source.health).toBe("ACTIVE");
    expect(source.last_success_at).not.toBeNull();
    expect(source.jobs_total).toBe(2);
    expect(source.stats.jobs_new_last_run).toBe(2);

    w.clock.advance(HOUR);
    const second = await runNow(w, wwr.id);
    await drain(w);
    expect(run(w, second.id).stats).toMatchObject({ new: 0, unchanged: 2 });
    expect(row(w, "SELECT count(*) AS n FROM job_postings").n).toBe(2);
    expect(row(w, "SELECT count(*) AS n FROM user_jobs").n).toBe(2);

    w.clock.advance(HOUR);
    const changed = [
      await cloudItem(
        WWR,
        {
          title: "Senior Go Engineer",
          url: url(1),
          location: "Worldwide",
          description: "Now with Kubernetes. ".repeat(5),
        },
        w.clock.now()
      ),
      items[1],
    ];
    w.scraper.scrape = () => scrapeResponse(changed);
    const third = await runNow(w, wwr.id);
    await drain(w);
    expect(run(w, third.id).stats).toMatchObject({
      updated: 1,
      unchanged: 1,
      new: 0,
    });
  });

  it("T24-SCRAPE-02 two vacancies with the same title and company but different URLs stay apart; copies share a dedupe group", async () => {
    const now = w.clock.now();
    w.scraper.scrape = async () =>
      scrapeResponse([
        await cloudItem(
          WWR,
          { title: "Support Specialist", url: url(10) },
          now
        ),
        await cloudItem(
          WWR,
          { title: "Support Specialist", url: url(11) },
          now
        ),
        await cloudItem(
          WWR,
          { title: "Support Specialist", url: url(10) },
          now
        ),
      ]);
    const r = await runNow(w, wwr.id);
    await drain(w);
    expect(run(w, r.id).stats).toMatchObject({ new: 2, duplicates: 1 });
    const groups = w.t.jobsSqlite
      .query("SELECT DISTINCT dedupe_group FROM job_postings")
      .all();
    expect(groups).toHaveLength(1);
  });

  it("T24-SCRAPE-03 postings missing from two complete runs close", async () => {
    const now = w.clock.now();
    const a = await cloudItem(
      WWR,
      { title: "Backend Engineer", url: url(20) },
      now
    );
    const b = await cloudItem(
      WWR,
      { title: "Data Engineer", url: url(21) },
      now
    );
    w.scraper.scrape = () => scrapeResponse([a, b]);
    await runNow(w, wwr.id);
    await drain(w);
    w.scraper.scrape = () => scrapeResponse([a]);
    for (let i = 0; i < 2; i++) {
      w.clock.advance(HOUR);
      await runNow(w, wwr.id);
      await drain(w);
    }
    expect(
      row(w, "SELECT status FROM job_postings WHERE canonical_url = ?", url(21))
        .status
    ).toBe("closed");
    expect(
      row(w, "SELECT status FROM job_postings WHERE canonical_url = ?", url(20))
        .status
    ).toBe("open");
  });

  it("T24-SCRAPE-04 an invalid item is counted, the rest of the run is stored", async () => {
    const now = w.clock.now();
    const good = await cloudItem(
      WWR,
      { title: "QA Engineer", url: url(30) },
      now
    );
    const forged = {
      ...(await cloudItem(WWR, { title: "Forged", url: url(31) }, now)),
      fingerprint: `fp1:${"0".repeat(64)}`,
    };
    w.scraper.scrape = () =>
      scrapeResponse([good, forged, { title: 1 } as never]);
    const r = await runNow(w, wwr.id);
    await drain(w);
    const done = run(w, r.id);
    expect(done.stats).toMatchObject({ new: 1, invalid: 2 });
    expect(
      (done.warnings as { code: string }[]).some(
        (x) => x.code === "invalid_item"
      )
    ).toBe(true);
  });

  it("T24-SCRAPE-05 following later backfills recent open postings", async () => {
    w.scraper.scrape = async () =>
      scrapeResponse([
        await cloudItem(
          WWR,
          { title: "Mobile Engineer", url: url(40) },
          w.clock.now()
        ),
      ]);
    await runNow(w, wwr.id);
    await drain(w);
    const late = await w.client.browserSession("late@example.com");
    const res = await late.put<{ backfilled: number }>(
      `/api/v1/cloud-sources/${wwr.id}/follow`
    );
    expect(res.body.backfilled).toBe(1);
    const again = await late.put<{ backfilled: number }>(
      `/api/v1/cloud-sources/${wwr.id}/follow`
    );
    expect(again.body.backfilled).toBe(0);
    const off = await late.delete<{ source: CloudSourceView }>(
      `/api/v1/cloud-sources/${wwr.id}/follow`
    );
    expect(off.body.source.following).toBe(false);
  });
});

describe("T24-FAIL failure classification and recovery", () => {
  it("T24-FAIL-01 a challenge blocks the source with an actionable note; retry clears it", async () => {
    const w = await world();
    const wwr = await sourceBySlug(w, WWR);
    w.scraper.scrape = () =>
      scrapeResponse([], {
        outcome: "failed",
        complete: false,
        error: {
          error_class: "challenge_detected",
          message: "cloudflare_challenge",
          http_status: 403,
          url: "https://weworkremotely.com/remote-jobs.rss",
        },
      });
    const r = await runNow(w, wwr.id);
    await drain(w);
    expect(run(w, r.id).status).toBe("blocked");
    const blocked = await sourceBySlug(w, WWR);
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.status_reason).toContain("never solves or bypasses");
    expect(w.scraper.requests).toHaveLength(1);
    const before = w.queue.sent.length;
    w.clock.advance(2 * HOUR);
    await runScheduled({ cron: CRON_HOURLY }, w.t.env, createCtx(), {
      clock: w.clock,
    });
    expect(
      w.queue.sent
        .slice(before)
        .some((m) => "source_id" in m.body && m.body.source_id === wwr.id)
    ).toBe(false);
    const refused = await w.admin.post<Body>(
      `/api/v1/cloud-sources/${wwr.id}/runs`,
      {}
    );
    expect(refused.status).toBe(422);
    w.scraper.scrape = async () =>
      scrapeResponse([
        await cloudItem(
          WWR,
          { title: "Ops", url: "https://weworkremotely.com/remote-jobs/ops" },
          w.clock.now()
        ),
      ]);
    const retry = await runNow(w, wwr.id, { retry: true });
    await drain(w);
    expect(run(w, retry.id).status).toBe("succeeded");
    expect((await sourceBySlug(w, WWR)).status).toBe("ACTIVE");
  });

  it("T24-FAIL-02 auth walls and rate limits get their own statuses", async () => {
    const w = await world();
    const wwr = await sourceBySlug(w, WWR);
    w.scraper.scrape = () =>
      scrapeResponse([], {
        outcome: "failed",
        complete: false,
        error: {
          error_class: "rate_limited",
          message: "429",
          http_status: 429,
          retry_after_s: 4 * 3600,
        },
      });
    await runNow(w, wwr.id);
    await drain(w);
    const limited = await sourceBySlug(w, WWR);
    expect(limited.status).toBe("RATE_LIMITED");
    expect(limited.next_run_at).toBeGreaterThanOrEqual(
      w.clock.now() + 4 * HOUR
    );

    const jobspresso = await sourceBySlug(w, "jobspresso.co");
    w.scraper.scrape = () =>
      scrapeResponse([], {
        outcome: "failed",
        complete: false,
        error: {
          error_class: "auth_required",
          message: "login form",
          http_status: 200,
        },
      });
    await runNow(w, jobspresso.id);
    await drain(w);
    const auth = await sourceBySlug(w, "jobspresso.co");
    expect(auth.status).toBe("AUTH_REQUIRED");
    expect(auth.status_reason).toContain("does not log in");
  });

  it("T24-FAIL-03 an unreachable scraper retries with bounded jittered backoff, then fails; three failures open the breaker", async () => {
    const w = await world();
    const wwr = await sourceBySlug(w, WWR);
    w.scraper.down = true;
    const r = await runNow(w, wwr.id);
    const report = await drain(w);
    expect(report.retried).toBe(3);
    expect(report.deadLettered).toBe(0);
    const delays = w.queue.retries.map((x) => x.delaySeconds ?? 0);
    expect(delays[0]).toBeGreaterThanOrEqual(48);
    expect(delays[0]).toBeLessThanOrEqual(72);
    expect(delays[2]).toBeGreaterThanOrEqual(192);
    expect(delays[2]).toBeLessThanOrEqual(288);
    const failed = run(w, r.id);
    expect(failed.status).toBe("failed");
    expect(failed.error_class).toBe("engine_unavailable");
    const source = await sourceBySlug(w, WWR);
    expect(source.status).toBe("FAILED");
    expect(source.consecutive_failures).toBe(1);
    w.t.jobsSqlite.run(
      "UPDATE cloud_sources SET consecutive_failures = 2 WHERE id = ?",
      [wwr.id]
    );
    await runNow(w, wwr.id);
    await drain(w);
    const broken = await sourceBySlug(w, WWR);
    expect(broken.consecutive_failures).toBe(3);
    expect(broken.circuit_open_until).toBeGreaterThan(w.clock.now());
  });

  it("T24-FAIL-04 runs never overlap: a leased source skips the second run", async () => {
    const w = await world();
    const wwr = await sourceBySlug(w, WWR);
    w.t.jobsSqlite.run(
      "UPDATE cloud_sources SET lease_id = 'crn_other', lease_expires_at = ? WHERE id = ?",
      [w.clock.now() + HOUR, wwr.id]
    );
    expect((await sourceBySlug(w, WWR)).status).toBe("SCRAPING");
    w.scraper.scrape = () => scrapeResponse([]);
    const r = await runNow(w, wwr.id);
    await drain(w);
    expect(run(w, r.id).status).toBe("skipped");
    expect(w.scraper.requests).toHaveLength(0);
  });

  it("T24-FAIL-05 the reaper frees expired leases and fails stuck runs", async () => {
    const w = await world();
    const wwr = await sourceBySlug(w, WWR);
    w.scraper.scrape = () => scrapeResponse([]);
    const r = await runNow(w, wwr.id);
    w.t.jobsSqlite.run(
      "UPDATE cloud_sources SET lease_id = ?, lease_expires_at = ? WHERE id = ?",
      [r.id, w.clock.now() + 60_000, wwr.id]
    );
    w.clock.advance(HOUR);
    await runScheduled({ cron: "*/5 * * * *" }, w.t.env, createCtx(), {
      clock: w.clock,
    });
    expect(
      row(w, "SELECT lease_id FROM cloud_sources WHERE id = ?", wwr.id).lease_id
    ).toBeNull();
    expect(run(w, r.id).status).toBe("failed");
  });
});

describe("T24-AI fallback extraction", () => {
  it("T24-AI-01 extracts only what the page says, caps confidence, records spend", async () => {
    const w = await world({ JOBS_CLOUD_AI_ENABLED: true });
    const source = await sourceBySlug(w, "workfromhome.id");
    const patched = await w.admin.patch<{ source: CloudSourceView }>(
      `/api/v1/cloud-sources/${source.id}`,
      {
        base_revision: source.revision,
        ai_enabled: true,
      }
    );
    expect(patched.status).toBe(200);
    const text =
      "Remote jobs. Customer Success Lead at Nusantara Tech — Remote, Indonesia. Apply: /jobs/123-customer-success-lead";
    w.scraper.scrape = (request) => {
      expect(request.ai_fallback).toBe(true);
      return scrapeResponse([], {
        ai_candidates: [
          {
            url: "https://www.workfromhome.id/jobs",
            reason: "no_items",
            title: "Jobs",
            text,
          },
        ],
      });
    };
    const job = {
      company: "Nusantara Tech",
      location: "Remote, Indonesia",
      workplace_type: "remote",
      employment_type: "unknown",
      employment_detail: null,
      posted_at: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      description: null,
      status: "active",
      suspicious: false,
      suspicious_reason: null,
    };
    const ai = getAiProvider(w.t.env, {
      fake: {
        structured: {
          cloud_job_extraction: {
            is_job_listing_page: true,
            jobs: [
              {
                ...job,
                title: "Customer Success Lead",
                url: "/jobs/123-customer-success-lead",
                confidence: 0.95,
              },
              {
                ...job,
                title: "Invented Role",
                url: "/jobs/999",
                confidence: 0.9,
              },
              {
                ...job,
                title: "Customer Success Lead",
                url: "https://evil.example/phish",
                confidence: 0.9,
              },
            ],
          },
        },
      },
    });
    const r = await runNow(w, source.id);
    await drain(w, ai);
    const done = run(w, r.id);
    expect(done.stats).toMatchObject({ new: 1, ai_calls: 1 });
    const posting = row(
      w,
      "SELECT * FROM job_postings WHERE cloud_source_id = ?",
      source.id
    );
    const extraction = JSON.parse(String(posting.extraction));
    expect(extraction.method).toBe("ai");
    expect(extraction.confidence).toBeLessThanOrEqual(0.7);
    expect(posting.company_name).toBe("Nusantara Tech");
    const reasons = (done.warnings as { code: string; field?: string }[])
      .filter((x) => x.code === "ai_rejected")
      .map((x) => x.field);
    expect(reasons).toEqual(
      expect.arrayContaining(["title_not_in_page", "no_same_site_url"])
    );
  });

  it("T24-AI-02 with AI off the candidates are reported, never sent to a model", async () => {
    const w = await world();
    const source = await sourceBySlug(w, "workfromhome.id");
    w.scraper.scrape = (request) => {
      expect(request.ai_fallback).toBe(false);
      return scrapeResponse([], {
        ai_candidates: [
          {
            url: "https://www.workfromhome.id/jobs",
            reason: "no_items",
            title: null,
            text: "x",
          },
        ],
      });
    };
    const r = await runNow(w, source.id);
    await drain(w);
    expect(
      (run(w, r.id).warnings as { code: string }[]).some(
        (x) => x.code === "ai_skipped"
      )
    ).toBe(true);
  });
});

describe("T24-DIRECTORY discovery refresh", () => {
  it("T24-DIRECTORY-01 registers new platforms once, probes them, and never touches known ones", async () => {
    const w = await world();
    const wwr = await sourceBySlug(w, WWR);
    await w.admin.patch(`/api/v1/cloud-sources/${wwr.id}`, {
      base_revision: wwr.revision,
      enabled: false,
    });
    w.scraper.directory = () => ({
      v: 1,
      final_url: "https://bahrul.me/tools?category=remote-jobs",
      http_status: 200,
      entries: [
        {
          name: "We Work Remotely",
          url: "https://weworkremotely.com",
          description: "Changed text",
          anchor: "recommendations-we-work-remotely",
        },
        {
          name: "Brand New Board",
          url: "https://brand-new-board.example.org/jobs",
          description: "A new board",
          anchor: "recommendations-brand-new",
        },
        {
          name: "Bahrul",
          url: "https://bahrul.me/about",
          description: null,
          anchor: null,
        },
      ],
      error: null,
      log: [],
      engine: { scraper: "0.1.0" },
    });
    w.scraper.probe = () => ({
      v: 1,
      url: "https://brand-new-board.example.org/jobs",
      final_url: "https://brand-new-board.example.org/jobs",
      http_status: 200,
      reachable: true,
      robots: { fetched: true, allowed: true, crawl_delay_s: null },
      protection: null,
      auth_wall: false,
      title: "Brand New Board",
      meta_description: null,
      feeds: [
        {
          type: "rss",
          url: "https://brand-new-board.example.org/jobs.rss",
          items: 12,
          sample_titles: ["Dev"],
        },
      ],
      jsonld_job_postings: 0,
      embedded_json: [],
      job_link_count: 12,
      text_excerpt: "Remote jobs",
      error: null,
      log: [],
      engine: { scraper: "0.1.0" },
    });
    const refresh = await w.admin.post<{ run: { id: string } }>(
      "/api/v1/cloud-discovery/refresh"
    );
    expect(refresh.status).toBe(202);
    await drain(w);
    expect(run(w, refresh.body.run.id).stats).toMatchObject({
      entries: 3,
      registered: 1,
    });
    const added = await sourceBySlug(w, "example.org");
    expect(added.origin).toBe("directory");
    expect(added.category).toBe("job_board");
    expect(added.strategy).toBe("rss");
    expect(added.enabled).toBe(true);
    const known = await sourceBySlug(w, WWR);
    expect(known.enabled).toBe(false);
    expect(known.description).toBe("Changed text");
    expect(
      (await catalog(w.user)).items.filter((s) => s.slug === "bahrul.me")
    ).toHaveLength(0);
    // A second refresh registers nothing new.
    const again = await w.admin.post<{ run: { id: string } }>(
      "/api/v1/cloud-discovery/refresh"
    );
    await drain(w);
    expect(run(w, again.body.run.id).stats).toMatchObject({ registered: 0 });
  });
});
