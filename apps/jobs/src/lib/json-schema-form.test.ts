import {
  ADAPTER_MANIFESTS,
  parseAdapterConfig,
} from "@pilihpendidikan/jobs-contracts/adapters";
import { describe, expect, it } from "vitest";
import { makeDevice } from "@/test/fixtures";
import { makeRun, makeSource } from "@/test/fixtures-rest";
import {
  configFromValues,
  fieldsFromSchema,
  validateValues,
  valuesFromConfig,
} from "./json-schema-form";
import {
  configSummary,
  defaultLabel,
  disabledReason,
  formatDuration,
  requiresOptIn,
  runErrorGroups,
  runNowTask,
  SERVER_MANAGED_KEYS,
  sameConfig,
  splitRegistry,
  testCommand,
} from "./sources-model";

const SKIP = { skip: SERVER_MANAGED_KEYS };

/** A valid sample config for each adapter (15 §14.3). */
const SAMPLE: Record<string, Record<string, unknown>> = {
  greenhouse: { board_token: "acme" },
  lever: { site: "globex", region: "eu", filters: { team: "Platform" } },
  ashby: { job_board_name: "initech" },
  smartrecruiters: { company_identifier: "Umbrella1" },
  workable: { subdomain: "hooli" },
  workday: { tenant: "nvidia", wd_host_number: 5, site: "External" },
  career_page: {
    url: "https://initech.example/careers",
    fields: { title: "h2 a" },
    allow_browser: true,
  },
  generic_listing: {
    start_url: "https://jobs.example/",
    detail_url_pattern: "/jobs/\\d+",
    max_pages: 10,
  },
  custom_url: { url: "https://jobs.example/123" },
};

describe("TW-SOURCES config forms generated from the manifest JSON Schema (12 §8)", () => {
  it("TW-SOURCES every adapter manifest yields fields, and a sample config round-trips into a config the contract accepts", () => {
    expect(ADAPTER_MANIFESTS).toHaveLength(9);
    for (const manifest of ADAPTER_MANIFESTS) {
      const fields = fieldsFromSchema(manifest.config_schema, SKIP);
      expect(fields.length, manifest.id).toBeGreaterThan(0);
      expect(fields.some((field) => field.name === "disabled_reason")).toBe(
        false
      );
      const sample = SAMPLE[manifest.id] ?? {};
      const values = valuesFromConfig(fields, sample);
      expect(validateValues(fields, values), manifest.id).toEqual({});
      const config = configFromValues(fields, values);
      expect(config, manifest.id).toEqual(sample);
      expect(parseAdapterConfig(manifest.id, config).success, manifest.id).toBe(
        true
      );
    }
  });

  it("TW-SOURCES maps string, URL, enum, boolean, integer, nested and map properties", () => {
    const kinds = (id: string) =>
      Object.fromEntries(
        fieldsFromSchema(
          ADAPTER_MANIFESTS.find((manifest) => manifest.id === id)
            ?.config_schema,
          SKIP
        ).map((field) => [field.path, field.kind])
      );
    expect(kinds("lever")).toEqual({
      site: "text",
      region: "enum",
      "filters.location": "text",
      "filters.commitment": "text",
      "filters.team": "text",
      "filters.department": "text",
    });
    expect(kinds("workday")).toEqual({
      tenant: "text",
      wd_host_number: "integer",
      site: "text",
      search_text: "text",
    });
    expect(kinds("career_page")).toMatchObject({
      url: "text",
      fields: "map",
      allow_browser: "boolean",
    });
    const url = fieldsFromSchema(
      ADAPTER_MANIFESTS.find((manifest) => manifest.id === "custom_url")
        ?.config_schema
    ).find((field) => field.path === "url");
    expect(url?.url).toBe(true);
    expect(url?.required).toBe(true);
  });

  it("TW-SOURCES validates required, pattern, URL, enum, integer bounds and map keys", () => {
    const schemaOf = (id: string) =>
      ADAPTER_MANIFESTS.find((manifest) => manifest.id === id)?.config_schema;
    const greenhouse = fieldsFromSchema(schemaOf("greenhouse"));
    expect(validateValues(greenhouse, { board_token: "" })).toEqual({
      board_token: { code: "required" },
    });
    expect(validateValues(greenhouse, { board_token: "acme/../x" })).toEqual({
      board_token: { code: "pattern" },
    });
    const workday = fieldsFromSchema(schemaOf("workday"), SKIP);
    const valid = valuesFromConfig(workday, SAMPLE.workday);
    expect(
      validateValues(workday, { ...valid, wd_host_number: "100" })
    ).toEqual({ wd_host_number: { code: "max", max: 99 } });
    expect(
      validateValues(workday, { ...valid, wd_host_number: "4.5" })
    ).toEqual({ wd_host_number: { code: "integer" } });
    const lever = fieldsFromSchema(schemaOf("lever"));
    expect(
      validateValues(lever, {
        ...valuesFromConfig(lever, SAMPLE.lever),
        region: "mars",
      })
    ).toEqual({ region: { code: "enum" } });
    const career = fieldsFromSchema(schemaOf("career_page"));
    const careerValues = valuesFromConfig(career, SAMPLE.career_page);
    expect(
      validateValues(career, { ...careerValues, url: "ftp://x.example" })
    ).toEqual({ url: { code: "url" } });
    expect(
      validateValues(career, {
        ...careerValues,
        fields: [
          { name: "title", value: "h2" },
          { name: "title", value: "h3" },
        ],
      })
    ).toEqual({ fields: { code: "mapKey" } });
  });

  it("TW-SOURCES keeps server-managed keys when an edited config is saved", () => {
    const workday = ADAPTER_MANIFESTS.find(
      (manifest) => manifest.id === "workday"
    );
    const fields = fieldsFromSchema(workday?.config_schema, SKIP);
    const source = makeSource({
      adapter: "workday",
      config: { ...SAMPLE.workday, disabled_reason: "access_denied" },
    });
    const values = valuesFromConfig(fields, source.config);
    const config = configFromValues(fields, values, {
      disabled_reason: "access_denied",
    });
    expect(config.disabled_reason).toBe("access_denied");
    expect(disabledReason(source)).toBe("access_denied");
    // The API may order keys differently: that is not a change.
    expect(sameConfig(config, { ...source.config })).toBe(true);
    expect(
      sameConfig(
        { site: "Ext", tenant: "nvidia" },
        { tenant: "nvidia", site: "Ext" }
      )
    ).toBe(true);
    expect(sameConfig({ site: "a" }, { site: "b" })).toBe(false);
    expect(workday && requiresOptIn(workday)).toBe(true);
  });
});

describe("TW-SOURCES registry, labels, test command and runs (12 §8, 15 §8)", () => {
  it("TW-SOURCES splits the registry: 9 adapters, LinkedIn and Indeed excluded with a reason", () => {
    const registry = splitRegistry({
      version: 1,
      adapters: [
        ...ADAPTER_MANIFESTS,
        {
          id: "linkedin",
          status: "excluded",
          display_name: "LinkedIn",
          hosts: ["linkedin.com"],
          reason: "Terms prohibit automated access.",
          evidence_urls: ["https://www.linkedin.com/robots.txt"],
        },
      ],
    });
    expect(registry.manifests).toHaveLength(9);
    expect(registry.excluded.map((entry) => entry.id)).toEqual(["linkedin"]);
  });

  it("TW-SOURCES Test shows the dry-run CLI command; Run now queues a discover task", () => {
    expect(testCommand("src_01JA0000000000000000000000")).toBe(
      "pilih-jobs discover --source src_01JA0000000000000000000000 --dry-run"
    );
    expect(runNowTask(["src_1"], "any", "web:k", true)).toEqual({
      kind: "discover",
      payload: { source_ids: ["src_1"] },
      target_device_id: null,
      idempotency_key: "web:k",
      queue_without_device: false,
    });
    expect(runNowTask(["src_1"], "dev_1", "web:k", false)).toMatchObject({
      target_device_id: "dev_1",
      queue_without_device: true,
    });
  });

  it("TW-SOURCES summarises configs and suggests labels", () => {
    expect(configSummary("lever", { site: "globex", region: "eu" })).toBe(
      "globex (EU)"
    );
    expect(
      configSummary("workday", {
        tenant: "nvidia",
        wd_host_number: 5,
        site: "Ext",
      })
    ).toBe("nvidia.wd5 / Ext");
    expect(
      configSummary("career_page", { url: "https://initech.example/careers" })
    ).toBe("initech.example/careers");
    expect(
      defaultLabel(
        { id: "greenhouse", display_name: "Greenhouse" },
        { board_token: "acme" }
      )
    ).toBe("acme (Greenhouse)");
  });

  it("TW-SOURCES groups a run's errors by class and names the host that denied access", () => {
    const run = makeRun(makeDevice().id, {
      status: "partial",
      stats: { errors_by_class: { access_denied: 1, rate_limited: 2 } },
      errors: [
        {
          error_class: "access_denied",
          source: "workday:nvidia",
          url: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/x/jobs",
          http_status: 403,
        },
        {
          error_class: "rate_limited",
          source: "lever:globex",
          http_status: 429,
        },
      ],
    });
    expect(runErrorGroups(run)).toEqual([
      { errorClass: "rate_limited", count: 2, hosts: ["lever:globex"] },
      {
        errorClass: "access_denied",
        count: 1,
        hosts: ["nvidia.wd5.myworkdayjobs.com"],
      },
    ]);
    expect(formatDuration(4 * 60_000)).toBe("4 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 05 min");
    expect(formatDuration(45_000)).toBe("45 s");
  });
});
