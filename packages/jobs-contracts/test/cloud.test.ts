import { describe, expect, test } from "bun:test";
import {
  CloudAiExtractionSchema,
  CloudQueueMessageSchema,
  CloudSourcesFileSchema,
} from "../src/cloud";
import { parseStrategyConfig, strategyEntryUrl } from "../src/cloud-config";
import { CLOUD_SOURCES_FILE } from "../src/cloud-sources";
import { excludedSourceFor } from "../src/adapters";
import { registrableDomain } from "../src/fingerprint";
import cloudSourcesJson from "../cloud-sources.json" with { type: "json" };

const sources = CLOUD_SOURCES_FILE.sources;
const HTTP_URL_RE = /^https?:\/\//;

describe("cloud seed catalog (24 §7.1)", () => {
  test("TC-CLOUD-SEED the file parses and every slug is unique", () => {
    expect(CloudSourcesFileSchema.safeParse(cloudSourcesJson).success).toBe(
      true
    );
    const slugs = sources.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(sources.length).toBeGreaterThanOrEqual(80);
  });

  test("TC-CLOUD-SEED slugs are registrable domains (the directory refresh dedupes on them)", () => {
    for (const source of sources) {
      expect(registrableDomain(source.slug), source.slug).toBe(source.slug);
    }
  });

  test("TC-CLOUD-SEED both explicit Indonesian sources are registered and enabled", () => {
    for (const slug of ["remotefreelance.id", "workfromhome.id"]) {
      const source = sources.find((s) => s.slug === slug);
      expect(source?.enabled).toBe(true);
      expect(source?.health).toBe("ACTIVE");
      expect(source?.from_directory).toBe(false);
    }
  });

  test("TC-CLOUD-SEED the directory itself is not a source", () => {
    expect(sources.some((s) => s.canonical_domain === "bahrul.me")).toBe(false);
  });

  test("TC-CLOUD-SEED every strategy config is valid for its strategy", () => {
    for (const source of sources) {
      const parsed = parseStrategyConfig(
        source.strategy,
        source.strategy_config
      );
      expect(parsed.ok, `${source.slug}: ${JSON.stringify(parsed)}`).toBe(true);
    }
  });

  test("TC-CLOUD-SEED only ACTIVE sources with a real strategy can be scheduled", () => {
    for (const source of sources) {
      // A non-ACTIVE source may keep a verified config for later, but it can
      // never be scheduled: no strategy, or switched off.
      if (source.health !== "ACTIVE") {
        expect(source.strategy === "none" || !source.enabled, source.slug).toBe(
          true
        );
      }
      if (source.strategy !== "none") {
        const url = strategyEntryUrl(source.strategy, source.strategy_config);
        expect(url, source.slug).toMatch(HTTP_URL_RE);
      }
    }
  });

  test("TC-CLOUD-SEED a disabled or non-active source explains why", () => {
    for (const source of sources) {
      if (!source.enabled || source.health !== "ACTIVE") {
        expect(
          source.status_reason ?? source.auth_note,
          source.slug
        ).toBeTruthy();
      }
    }
  });

  test("TC-CLOUD-SEED no excluded platform (D-17) is schedulable", () => {
    for (const source of sources) {
      if (excludedSourceFor(source.canonical_domain)) {
        expect(source.strategy).toBe("none");
      }
    }
  });
});

describe("cloud wire contracts (24 §3, §6)", () => {
  test("TC-CLOUD-QUEUE messages are discriminated by type", () => {
    expect(
      CloudQueueMessageSchema.safeParse({
        type: "refresh_directory",
        v: 1,
        run_id: "crn_01JA6V8M3W8Z1T6Q4Y2B7K9C00",
      }).success
    ).toBe(true);
    expect(
      CloudQueueMessageSchema.safeParse({ type: "scrape_source", v: 1 }).success
    ).toBe(false);
  });

  test("TC-CLOUD-AI the AI extraction output is closed and nullable, never optional", () => {
    const job = {
      title: "Backend Engineer",
      company: null,
      location: null,
      workplace_type: "remote",
      employment_type: "full_time",
      employment_detail: null,
      url: null,
      posted_at: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      description: null,
      status: "active",
      confidence: 0.5,
      suspicious: false,
      suspicious_reason: null,
    };
    expect(
      CloudAiExtractionSchema.safeParse({
        is_job_listing_page: true,
        jobs: [job],
      }).success
    ).toBe(true);
    const { company: _company, ...missing } = job;
    expect(
      CloudAiExtractionSchema.safeParse({
        is_job_listing_page: true,
        jobs: [missing],
      }).success
    ).toBe(false);
    expect(
      CloudAiExtractionSchema.safeParse({
        is_job_listing_page: true,
        jobs: [{ ...job, extra: 1 }],
      }).success
    ).toBe(false);
  });
});
