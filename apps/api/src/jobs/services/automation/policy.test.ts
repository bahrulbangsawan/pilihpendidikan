import { describe, expect, it } from "bun:test";
import type {
  JobPostingRecord,
  MatchScoreRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  allowedDomainsFor,
  autoRuleProblems,
  canonicalJson,
  companyKey,
  coverageProblem,
  criteriaMatch,
  DAY_MS,
  domainAllowed,
  localMinutes,
  normalizeDomains,
  scoreVerdict,
  shouldRetry,
  withinActiveHours,
} from "./policy";

const NOW = Date.UTC(2026, 9, 12, 9);

const criteria = {
  min_score: 80,
  require_ai_component: true,
  max_score_age_days: 14,
  exclude_blocking_gates: true as const,
  exclude_possible_gates: true,
};

function posting(overrides: Partial<JobPostingRecord> = {}): JobPostingRecord {
  return {
    id: "pst_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
    fingerprint: `fp1:${"0".repeat(64)}`,
    visibility: "public",
    owner_user_id: null,
    source_kind: "greenhouse",
    source_org: "acme",
    source_job_ref: "1",
    canonical_url: null,
    apply_url: "https://boards.greenhouse.io/acme/jobs/1",
    apply_domain: "greenhouse.io",
    company_name: "Acme Inc.",
    company_domain: "www.acme.com",
    title: "Senior Backend Engineer",
    department: null,
    locations: [
      { raw: "Jakarta, Indonesia", city: "Jakarta", country_code: "ID" },
    ],
    workplace_type: "hybrid",
    employment_type: "full_time",
    seniority: "senior",
    salary: null,
    description_text: "Build Go services on Postgres.",
    description_truncated: false,
    requirements: ["Kubernetes"],
    content_hash: "0".repeat(64),
    dedupe_group: null,
    posted_at: null,
    first_seen_at: NOW,
    last_seen_at: NOW,
    last_checked_at: null,
    status: "open",
    closed_at: null,
    missed_runs: 0,
    extraction: {},
    application_support: "browser_supported",
    revision: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as JobPostingRecord;
}

function score(overrides: Record<string, unknown> = {}): MatchScoreRecord {
  return {
    id: "scr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
    user_id: "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
    posting_id: "pst_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
    profile_version: 1,
    rubric_version: "r1",
    model: "gpt-6-luna",
    score: 90,
    confidence: 0.9,
    components: {
      rubric_version: "r1",
      features: {},
      ai: {
        status: "ok",
        overall_fit: null,
        weight: 0.2,
        predicates: {},
        refused: [],
      },
      gates: [],
      base: 0.9,
      score: 90,
    },
    explanation: "",
    status: "ready",
    created_at: NOW - DAY_MS,
    ...overrides,
  } as unknown as MatchScoreRecord;
}

describe("automation policy (19 §8.3, 07 §10, 21 §8)", () => {
  it("TA-RULES auto problems: min_score, narrowing criterion, domains, expiry window", () => {
    const base = {
      mode: "auto" as const,
      criteria: { ...criteria, keywords: ["go"] },
      limits: {
        max_per_day: 10,
        max_per_company_per_30d: 2,
        expires_at: NOW + DAY_MS,
      },
      allowed_domains: ["greenhouse.io"],
    };
    expect(autoRuleProblems(base, NOW)).toEqual([]);
    expect(
      autoRuleProblems(
        { ...base, criteria: { ...criteria, min_score: 69, keywords: ["go"] } },
        NOW
      )
    ).toHaveLength(1);
    expect(autoRuleProblems({ ...base, criteria }, NOW)).toHaveLength(1);
    expect(
      autoRuleProblems({ ...base, allowed_domains: [] }, NOW)
    ).toHaveLength(1);
    expect(
      autoRuleProblems(
        { ...base, limits: { ...base.limits, expires_at: NOW + 31 * DAY_MS } },
        NOW
      )
    ).toHaveLength(1);
    expect(
      autoRuleProblems(
        { ...base, mode: "approval" as never, allowed_domains: [] },
        NOW
      )
    ).toEqual([]);
  });

  it("normalizes domains to registrable domains and matches apply domains", () => {
    expect(
      normalizeDomains([
        "Boards.Greenhouse.io",
        "greenhouse.io",
        "jobs.lever.co",
      ])
    ).toEqual(["greenhouse.io", "lever.co"]);
    expect(domainAllowed("job-boards.greenhouse.io", ["greenhouse.io"])).toBe(
      true
    );
    expect(domainAllowed("evil.com", ["greenhouse.io"])).toBe(false);
    expect(domainAllowed(null, ["greenhouse.io"])).toBe(false);
  });

  it("allowed domains = apply domain + adapter ATS hosts + rule domains (19 §7)", () => {
    const domains = allowedDomainsFor(posting(), ["acme.com"]);
    expect(domains).toEqual([
      "greenhouse.io",
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "job-boards.eu.greenhouse.io",
      "acme.com",
    ]);
  });

  it("company key prefers the registrable company domain", () => {
    expect(companyKey(posting())).toBe("d:acme.com");
    expect(companyKey(posting({ company_domain: null }))).toBe("n:acme inc.");
  });

  it("coverage: closed, unsupported, off-domain and non-auto adapters", () => {
    const rule = { mode: "auto" as const, allowed_domains: ["greenhouse.io"] };
    expect(coverageProblem(rule, posting())).toBeNull();
    expect(coverageProblem(rule, posting({ status: "closed" }))).toBe(
      "posting_closed"
    );
    expect(
      coverageProblem(rule, posting({ application_support: "email" }))
    ).toBe("application_unsupported");
    expect(coverageProblem(rule, posting({ apply_domain: "lever.co" }))).toBe(
      "domain_not_allowed"
    );
    expect(
      coverageProblem(
        { mode: "auto", allowed_domains: ["myworkdayjobs.com"] },
        posting({ source_kind: "workday", apply_domain: "myworkdayjobs.com" })
      )
    ).toBe("adapter_not_auto");
    expect(
      coverageProblem(
        { mode: "approval", allowed_domains: [] },
        posting({ source_kind: "workday" })
      )
    ).toBeNull();
  });

  it("criteria: keywords, title patterns, companies, places, workplace and seniority", () => {
    const p = posting();
    expect(
      criteriaMatch({ ...criteria, keywords: ["kubernetes"] }, p, null)
    ).toBe(true);
    expect(criteriaMatch({ ...criteria, keywords: ["rust"] }, p, null)).toBe(
      false
    );
    expect(
      criteriaMatch({ ...criteria, title_patterns: ["*backend*"] }, p, null)
    ).toBe(true);
    expect(
      criteriaMatch({ ...criteria, title_patterns: ["frontend"] }, p, null)
    ).toBe(false);
    expect(
      criteriaMatch({ ...criteria, companies: ["Acme Inc."] }, p, null)
    ).toBe(true);
    expect(
      criteriaMatch({ ...criteria, exclude_companies: ["acme inc."] }, p, null)
    ).toBe(false);
    expect(
      criteriaMatch({ ...criteria, locations: ["jakarta"] }, p, null)
    ).toBe(true);
    expect(
      criteriaMatch({ ...criteria, locations: ["bandung"] }, p, null)
    ).toBe(false);
    expect(
      criteriaMatch({ ...criteria, workplace_types: ["remote"] }, p, null)
    ).toBe(false);
    expect(criteriaMatch({ ...criteria, seniority: ["senior"] }, p, null)).toBe(
      true
    );
    expect(
      criteriaMatch(
        { ...criteria, source_ids: ["src_01JA6V8M3W8Z1T6Q4Y2B7K9C0A"] },
        p,
        null
      )
    ).toBe(false);
  });

  it("T7-10 score verdicts: ready only, current rubric, age, gates, AI component, threshold", () => {
    expect(scoreVerdict(score(), criteria, NOW)).toEqual({ ok: true });
    expect(scoreVerdict(undefined, criteria, NOW)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(scoreVerdict(score({ status: "queued" }), criteria, NOW)).toEqual({
      ok: false,
      reason: "pending",
    });
    expect(scoreVerdict(score({ status: "failed" }), criteria, NOW)).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(
      scoreVerdict(score({ rubric_version: "r0" }), criteria, NOW)
    ).toEqual({ ok: false, reason: "stale" });
    expect(
      scoreVerdict(score({ created_at: NOW - 15 * DAY_MS }), criteria, NOW)
    ).toEqual({ ok: false, reason: "stale" });
    expect(scoreVerdict(score({ score: 79 }), criteria, NOW)).toEqual({
      ok: false,
      reason: "below_min",
    });
    const blocking = score();
    (blocking.components as { gates: unknown[] }).gates = [
      {
        predicate: "requires_degree_user_lacks",
        level: "blocking",
        probability: 0.9,
        multiplier: 0,
      },
    ];
    expect(
      scoreVerdict(
        blocking,
        { ...criteria, exclude_possible_gates: false },
        NOW
      )
    ).toEqual({ ok: false, reason: "blocking_gate" });
    const deterministic = score();
    (deterministic.components as { ai: { status: string } }).ai.status =
      "budget";
    expect(scoreVerdict(deterministic, criteria, NOW)).toEqual({
      ok: false,
      reason: "no_ai_component",
    });
    expect(
      scoreVerdict(
        deterministic,
        { ...criteria, require_ai_component: false },
        NOW
      )
    ).toEqual({ ok: true });
  });

  it("active hours in the user's timezone, including windows across midnight", () => {
    expect(localMinutes(NOW, "Asia/Jakarta")).toBe(16 * 60);
    expect(localMinutes(NOW, "Not/AZone")).toBe(9 * 60);
    expect(
      withinActiveHours({ start: "09:00", end: "17:00" }, NOW, "Asia/Jakarta")
    ).toBe(true);
    expect(
      withinActiveHours({ start: "09:00", end: "12:00" }, NOW, "Asia/Jakarta")
    ).toBe(false);
    expect(
      withinActiveHours({ start: "22:00", end: "06:00" }, NOW, "UTC")
    ).toBe(false);
    expect(
      withinActiveHours({ start: "08:00", end: "02:00" }, NOW, "UTC")
    ).toBe(true);
    expect(withinActiveHours(null, NOW, "UTC")).toBe(true);
  });

  it("TA-RETRY retry policy: classes, once, attempts, client flag, never after intent (D-19)", () => {
    const base = {
      attemptCount: 1,
      maxAttempts: 3,
      submitIntentAt: null,
      clientRetryable: true,
    };
    expect(shouldRetry({ ...base, errorClass: "network_offline" })).toBe(true);
    expect(
      shouldRetry({
        ...base,
        errorClass: "network_offline",
        clientRetryable: false,
      })
    ).toBe(false);
    expect(shouldRetry({ ...base, errorClass: "login_required" })).toBe(false);
    expect(shouldRetry({ ...base, errorClass: "timeout" })).toBe(true);
    expect(
      shouldRetry({ ...base, errorClass: "timeout", attemptCount: 2 })
    ).toBe(false);
    expect(
      shouldRetry({ ...base, errorClass: "network_offline", attemptCount: 3 })
    ).toBe(false);
    expect(shouldRetry({ ...base, errorClass: "something_new" })).toBe(true);
    expect(
      shouldRetry({
        ...base,
        errorClass: "something_new",
        clientRetryable: undefined,
      })
    ).toBe(false);
    expect(
      shouldRetry({
        ...base,
        errorClass: "network_offline",
        submitIntentAt: NOW,
      })
    ).toBe(false);
  });

  it("canonical JSON sorts keys at every level and drops undefined", () => {
    expect(
      canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: undefined } })
    ).toBe('{"a":{"d":[2,{"x":2,"y":1}]},"b":1}');
  });
});
