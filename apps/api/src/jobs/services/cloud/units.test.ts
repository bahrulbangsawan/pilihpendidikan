import { describe, expect, it } from "bun:test";
import type { ProbeResponse } from "@pilihpendidikan/jobs-contracts/cloud";
import { CLOUD_SOURCES_FILE } from "@pilihpendidikan/jobs-contracts/cloud-sources";
import { appearsIn, itemFromAiJob } from "./ai";
import { decideFromProbe } from "./classify";
import {
  breakerOpenUntil,
  diagnosticMessage,
  dispositionOf,
  finishOutcome,
  retryDelaySeconds,
} from "./health";
import { recordFromSeed, seedPatch } from "./seed";
import { validateCloudUrl } from "./url";
import { statusOf } from "./views";

const NOW = Date.UTC(2026, 9, 13, 12);
const HOUR = 3_600_000;
const seed = CLOUD_SOURCES_FILE.sources.find(
  (s) => s.slug === "weworkremotely.com"
);
if (!seed) {
  throw new Error("seed missing");
}
const source = recordFromSeed(seed, NOW, "csr_01JA6V8M3W8Z1T6Q4Y2B7K9C00");

describe("T24-HEALTH backoff, breaker and dispositions (24 §6.3)", () => {
  it("T24-HEALTH-01 retry delay is exponential, jittered ±20 %, capped at 15 min", () => {
    expect(retryDelaySeconds(1, () => 0.5)).toBe(60);
    expect(retryDelaySeconds(2, () => 0.5)).toBe(120);
    expect(retryDelaySeconds(3, () => 0)).toBe(192);
    expect(retryDelaySeconds(3, () => 1)).toBe(288);
    expect(retryDelaySeconds(20, () => 0.5)).toBe(900);
  });

  it("T24-HEALTH-02 the breaker opens at three failures and caps at 24 h", () => {
    expect(breakerOpenUntil(2, NOW)).toBeNull();
    expect(breakerOpenUntil(3, NOW)).toBe(NOW + HOUR);
    expect(breakerOpenUntil(4, NOW)).toBe(NOW + 2 * HOUR);
    expect(breakerOpenUntil(30, NOW)).toBe(NOW + 24 * HOUR);
  });

  it("T24-HEALTH-03 error classes map to distinct statuses", () => {
    expect(dispositionOf("challenge_detected")).toEqual({
      health: "BLOCKED",
      runStatus: "blocked",
    });
    expect(dispositionOf("access_denied").health).toBe("BLOCKED");
    expect(dispositionOf("robots_disallowed").health).toBe("BLOCKED");
    expect(dispositionOf("rate_limited").health).toBe("RATE_LIMITED");
    expect(dispositionOf("auth_required").health).toBe("AUTH_REQUIRED");
    expect(dispositionOf("parse_error").health).toBe("FAILED");
  });

  it("T24-HEALTH-04 a transient stop after stored items is a partial success", () => {
    const outcome = finishOutcome(
      source,
      { id: "crn_01JA6V8M3W8Z1T6Q4Y2B7K9C01" },
      {
        error: { error_class: "timeout", message: "page 3 timed out" },
        hadItems: true,
        durationMs: 9000,
        found: 40,
        newCount: 3,
        confidenceAvg: 0.85,
        warnings: 0,
        aiCalls: 0,
      },
      NOW
    );
    expect(outcome.runStatus).toBe("partial");
    expect(outcome.patch.health).toBe("ACTIVE");
    expect(outcome.patch.consecutive_failures).toBe(0);
    expect(outcome.patch.stats?.successes).toBe(1);
  });

  it("T24-HEALTH-05 diagnostics are actionable and never promise a bypass", () => {
    const text = diagnosticMessage(
      {
        error_class: "challenge_detected",
        message: "cf",
        http_status: 403,
        url: "https://x.example.com/a",
      },
      source,
      null
    );
    expect(text).toContain("x.example.com");
    expect(text).toContain("never solves or bypasses");
    expect(
      diagnosticMessage(
        { error_class: "selector_drift", message: "" },
        source,
        null
      )
    ).toContain("Update the strategy");
  });

  it("T24-HEALTH-06 the shown status: DISABLED > SCRAPING > health", () => {
    expect(
      statusOf(
        { enabled: false, health: "ACTIVE", lease_expires_at: NOW + 1 },
        NOW
      )
    ).toBe("DISABLED");
    expect(
      statusOf(
        { enabled: true, health: "FAILED", lease_expires_at: NOW + 1 },
        NOW
      )
    ).toBe("SCRAPING");
    expect(
      statusOf(
        { enabled: true, health: "FAILED", lease_expires_at: NOW - 1 },
        NOW
      )
    ).toBe("FAILED");
  });
});

describe("T24-URL source URL validation (24 §8)", () => {
  it("T24-URL-01 accepts public boards and returns the registrable domain", () => {
    expect(
      validateCloudUrl("https://jobs.example-board.co.id/remote")
    ).toMatchObject({ ok: true, domain: "example-board.co.id" });
  });

  it("T24-URL-02 refuses SSRF-shaped and excluded URLs", () => {
    for (const [url, problem] of [
      ["ftp://example.com/jobs", "scheme"],
      ["https://user:pw@example.com/", "userinfo"],
      ["https://example.com:8443/", "port"],
      ["http://169.254.169.254/latest/meta-data", "ip_literal"],
      ["http://[::1]/", "ip_literal"],
      ["http://localhost/jobs", "local_host"],
      ["http://intranet/jobs", "local_host"],
      ["https://metadata.google.internal/", "local_host"],
      ["https://www.linkedin.com/jobs/", "excluded"],
      ["https://id.indeed.com/jobs", "excluded"],
    ] as const) {
      expect(validateCloudUrl(url)).toEqual({ ok: false, problem });
    }
  });
});

function probe(overrides: Partial<ProbeResponse> = {}): ProbeResponse {
  return {
    v: 1,
    url: "https://board.example.org/jobs",
    final_url: "https://board.example.org/jobs",
    http_status: 200,
    reachable: true,
    robots: { fetched: true, allowed: true, crawl_delay_s: null },
    protection: null,
    auth_wall: false,
    title: "Board",
    meta_description: null,
    feeds: [],
    jsonld_job_postings: 0,
    embedded_json: [],
    job_link_count: 0,
    text_excerpt: "",
    error: null,
    log: [],
    engine: { scraper: "0.1.0" },
    ...overrides,
  };
}

describe("T24-PROBE classification (24 §7.2)", () => {
  it("T24-PROBE-01 only a verified, allowed, unprotected feed is enabled automatically", () => {
    const feed = decideFromProbe(
      probe({
        feeds: [
          {
            type: "rss",
            url: "https://board.example.org/jobs.rss",
            items: 20,
            sample_titles: [],
          },
        ],
      })
    );
    expect(feed).toMatchObject({
      category: "job_board",
      enabled: true,
      health: "ACTIVE",
      strategy: "rss",
    });
    const jsonld = decideFromProbe(probe({ jsonld_job_postings: 4 }));
    expect(jsonld).toMatchObject({ enabled: false, strategy: "json_ld" });
    expect(decideFromProbe(probe({ job_link_count: 30 }))).toMatchObject({
      category: "job_board",
      enabled: false,
      strategy: null,
    });
    expect(decideFromProbe(probe())).toMatchObject({
      health: "UNSUPPORTED",
      enabled: false,
    });
  });

  it("T24-PROBE-02 protection, robots and login walls win over everything", () => {
    const withFeed = {
      feeds: [
        {
          type: "rss" as const,
          url: "https://board.example.org/f",
          items: 5,
          sample_titles: [],
        },
      ],
    };
    expect(
      decideFromProbe(
        probe({ ...withFeed, protection: "cloudflare_challenge" })
      ).health
    ).toBe("BLOCKED");
    expect(
      decideFromProbe(
        probe({
          ...withFeed,
          robots: { fetched: true, allowed: false, crawl_delay_s: null },
        })
      ).health
    ).toBe("BLOCKED");
    expect(
      decideFromProbe(probe({ ...withFeed, auth_wall: true }))
    ).toMatchObject({ health: "AUTH_REQUIRED", authRequired: true });
    expect(
      decideFromProbe(
        probe({
          reachable: false,
          error: { error_class: "network", message: "NXDOMAIN" },
        })
      )
    ).toMatchObject({ category: "defunct", enabled: false });
  });
});

describe("T24-SEED-MERGE operator edits win (24 §7.1)", () => {
  it("T24-SEED-MERGE-01 seed fields update unless an operator edited them; operational state never", () => {
    const edited = {
      ...source,
      priority: 5,
      enabled: false,
      health: "FAILED" as const,
      user_modified: ["priority"],
    };
    const patch = seedPatch(edited, {
      ...seed,
      priority: 99,
      description: "New text",
      enabled: true,
      health: "ACTIVE",
    });
    expect(patch).toEqual({ description: "New text" });
  });
});

describe("T24-AI-GUARD AI output is grounded in the page (24 §4.3)", () => {
  const candidate = {
    url: "https://weworkremotely.com/remote-jobs",
    reason: "no_items",
    title: "Jobs",
    text: "Acme Remote is hiring a Staff Engineer. Apply at /remote-jobs/acme-staff",
  };
  const job = {
    title: "Staff Engineer",
    company: "Acme Remote",
    location: null,
    workplace_type: "remote" as const,
    employment_type: "full_time" as const,
    employment_detail: "freelance" as const,
    url: "/remote-jobs/acme-staff",
    posted_at: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: null,
    status: "active" as const,
    confidence: 0.99,
    suspicious: true,
    suspicious_reason: "asks for a training fee",
  };
  const options = { index: 0, minConfidence: 0.5, now: NOW };

  it("T24-AI-GUARD-01 grounded jobs become capped, flagged items", async () => {
    const item = await itemFromAiJob(job, candidate, source, options);
    if ("reason" in item) {
      throw new Error(item.reason);
    }
    expect(item.extraction.confidence).toBe(0.7);
    expect(item.extraction.method).toBe("ai");
    expect(item.extraction.flags).toContain(
      "suspicious:asks for a training fee"
    );
    expect(item.apply_url).toBe(
      "https://weworkremotely.com/remote-jobs/acme-staff"
    );
    expect(item.extras?.employment_detail).toBe("freelance");
  });

  it("T24-AI-GUARD-02 invented, expired, off-site or unsure jobs are dropped", async () => {
    expect(
      await itemFromAiJob(
        { ...job, title: "Chief Wizard" },
        candidate,
        source,
        options
      )
    ).toMatchObject({ reason: "title_not_in_page" });
    expect(
      await itemFromAiJob(
        { ...job, company: "Other Co" },
        candidate,
        { ...source, strategy_config: {} },
        options
      )
    ).toMatchObject({ reason: "company_not_in_page" });
    expect(
      await itemFromAiJob(
        { ...job, url: "https://phish.example.net/x" },
        candidate,
        source,
        options
      )
    ).toMatchObject({ reason: "no_same_site_url" });
    expect(
      await itemFromAiJob(
        { ...job, url: "javascript:alert(1)" },
        candidate,
        source,
        options
      )
    ).toMatchObject({ reason: "no_same_site_url" });
    expect(
      await itemFromAiJob(
        { ...job, status: "expired" },
        candidate,
        source,
        options
      )
    ).toMatchObject({ reason: "expired" });
    expect(
      await itemFromAiJob(
        { ...job, confidence: 0.2 },
        candidate,
        source,
        options
      )
    ).toMatchObject({ reason: "low_confidence" });
  });

  it("T24-AI-GUARD-03 matching ignores case and whitespace only", () => {
    expect(appearsIn("staff   ENGINEER", candidate.text)).toBe(true);
    expect(appearsIn("Staff Engineers Lead", candidate.text)).toBe(false);
    expect(appearsIn("", candidate.text)).toBe(false);
  });
});
