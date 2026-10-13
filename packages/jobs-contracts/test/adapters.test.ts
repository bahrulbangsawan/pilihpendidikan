import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ADAPTER_CONFIG_SCHEMAS,
  ADAPTER_MANIFESTS,
  AdaptersFileSchema,
  adapterConfigJsonSchema,
  adapterForAtsHost,
  EXCLUDED_SOURCES,
  excludedSourceFor,
  getAdapterManifest,
  isExcludedHost,
  parseAdapterConfig,
} from "../src/adapters";
import { ADAPTER_IDS } from "../src/enums";

const file = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "adapters.json"), "utf8")
);

describe("adapter registry (15 §14)", () => {
  test("TC-ADAPTERS adapters.json validates against the manifest schema", () => {
    expect(AdaptersFileSchema.safeParse(file).success).toBe(true);
  });

  test("TC-ADAPTERS all 9 adapters of 15 §14.3 are present, once each", () => {
    expect(ADAPTER_MANIFESTS.map((m) => m.id).sort()).toEqual(
      [...ADAPTER_IDS].sort()
    );
  });

  test("TC-ADAPTERS linkedin and indeed are excluded with hosts", () => {
    expect(EXCLUDED_SOURCES.map((e) => e.id).sort()).toEqual([
      "indeed",
      "linkedin",
    ]);
    for (const entry of EXCLUDED_SOURCES) {
      expect(entry.hosts.length).toBeGreaterThan(0);
      expect(entry.evidence_urls.length).toBeGreaterThan(0);
    }
  });

  test("TC-ADAPTERS excluded hosts are matched (linkedin.com, *.indeed.*)", () => {
    expect(isExcludedHost("www.linkedin.com")).toBe(true);
    expect(isExcludedHost("https://www.linkedin.com/jobs/view/123")).toBe(true);
    expect(isExcludedHost("linkedin.com")).toBe(true);
    expect(excludedSourceFor("id.indeed.com")).toBe("indeed");
    expect(excludedSourceFor("www.indeed.co.uk")).toBe("indeed");
    expect(excludedSourceFor("https://indeed.com/viewjob?jk=1")).toBe("indeed");
    expect(isExcludedHost("notlinkedin.com")).toBe(false);
    expect(isExcludedHost("boards.greenhouse.io")).toBe(false);
    expect(isExcludedHost("indeedjobs.example.com")).toBe(false);
  });

  test("TC-ADAPTERS auto is never allowed for career_page, generic_listing, custom_url, workday", () => {
    for (const id of [
      "career_page",
      "generic_listing",
      "custom_url",
      "workday",
    ] as const) {
      expect(getAdapterManifest(id).automation.auto_ok).toBe(false);
    }
    for (const id of ["greenhouse", "lever", "ashby"] as const) {
      const manifest = getAdapterManifest(id);
      expect(manifest.automation.auto_ok).toBe(true);
      expect(manifest.capabilities.application_support).toBe(
        "browser_supported"
      );
      expect(manifest.automation.ats_hosts.length).toBeGreaterThan(0);
      expect(
        manifest.automation.confirmation_url_patterns.length
      ).toBeGreaterThan(0);
    }
  });

  test("TC-ADAPTERS workday is opt-in, one request at a time, ≥ 3 s, stops on denial", () => {
    const workday = getAdapterManifest("workday");
    expect(workday.status).toBe("opt_in");
    expect(workday.restrictions.requires_opt_in).toBe(true);
    expect(workday.rate_limits.per_domain_concurrency).toBe(1);
    expect(workday.rate_limits.min_delay_ms).toBeGreaterThanOrEqual(3000);
    expect(workday.restrictions.stop_on).toEqual([
      "access_denied",
      "challenge_detected",
      "rate_limited",
    ]);
  });

  test("TC-ADAPTERS every manifest respects robots and v1 public-only access", () => {
    for (const manifest of ADAPTER_MANIFESTS) {
      expect(manifest.restrictions.robots_respected).toBe(true);
      expect(manifest.capabilities.auth_required).toBe(false);
      expect(manifest.rate_limits.min_delay_ms).toBeGreaterThanOrEqual(1000);
      for (const pattern of manifest.automation.confirmation_url_patterns) {
        expect(() => new RegExp(pattern)).not.toThrow();
      }
    }
  });

  test("TC-ADAPTERS config_schema in adapters.json is generated from the Zod config schemas", () => {
    for (const manifest of ADAPTER_MANIFESTS) {
      expect(manifest.config_schema).toEqual(
        adapterConfigJsonSchema(manifest.id)
      );
    }
  });

  test("TC-ADAPTERS config schemas accept documented configs and reject unknown keys", () => {
    expect(
      parseAdapterConfig("greenhouse", { board_token: "acme" }).success
    ).toBe(true);
    expect(
      parseAdapterConfig("greenhouse", {
        board_token: "acme",
        impersonate: true,
      }).success
    ).toBe(false);
    expect(
      parseAdapterConfig("lever", { site: "acme", region: "eu" }).success
    ).toBe(true);
    expect(
      parseAdapterConfig("lever", { site: "acme", region: "us" }).success
    ).toBe(false);
    expect(
      parseAdapterConfig("workday", {
        tenant: "nvidia",
        wd_host_number: 5,
        site: "NVIDIAExternalCareerSite",
      }).success
    ).toBe(true);
    expect(
      parseAdapterConfig("generic_listing", {
        start_url: "https://acme.com/careers",
        detail_url_pattern: "/jobs/\\d+",
        max_pages: 51,
      }).success
    ).toBe(false);
    expect(
      parseAdapterConfig("custom_url", { url: "javascript:alert(1)" }).success
    ).toBe(false);
    for (const id of ADAPTER_IDS) {
      expect(ADAPTER_CONFIG_SCHEMAS[id]).toBeInstanceOf(z.ZodObject);
    }
  });

  test("TC-ADAPTERS ATS hosts map back to their adapter", () => {
    expect(adapterForAtsHost("boards.greenhouse.io")).toBe("greenhouse");
    expect(
      adapterForAtsHost("https://job-boards.greenhouse.io/acme/jobs/1")
    ).toBe("greenhouse");
    expect(adapterForAtsHost("jobs.eu.lever.co")).toBe("lever");
    expect(adapterForAtsHost("jobs.ashbyhq.com")).toBe("ashby");
    expect(adapterForAtsHost("nvidia.wd5.myworkdayjobs.com")).toBe("workday");
    expect(adapterForAtsHost("careers.acme.com")).toBeNull();
  });
});
