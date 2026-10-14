import { CLOUD_SOURCE_STATUSES } from "@pilihpendidikan/jobs-contracts/enums";
import { describe, expect, it } from "vitest";
import { NOW } from "@/test/fixtures";
import { makeCloudSource, sampleCloudSources } from "@/test/fixtures-cloud";
import {
  boardUrlProblem,
  canRetry,
  checkStrategyConfig,
  countByGroup,
  diagnosticOf,
  editorChanges,
  editorFormOf,
  filterCloudSources,
  hasLiveCloudWork,
  nextRunOf,
  sortCloudSources,
  stableJson,
  statusBadgeVariant,
  statusGroupOf,
} from "./cloud-sources-model";
import { formatDuration } from "./format";

const HOUR = 3_600_000;

describe("TW-CLOUD-MODEL cloud catalog rules (24 §5, 05 §15)", () => {
  it("TW-CLOUD-MODEL badges never spend the cobalt and every status has a group", () => {
    for (const status of CLOUD_SOURCE_STATUSES) {
      expect(["secondary", "destructive", "outline", "ghost"]).toContain(
        statusBadgeVariant(status)
      );
      expect(["active", "attention", "inactive"]).toContain(
        statusGroupOf(status)
      );
    }
    expect(statusGroupOf("SCRAPING")).toBe("active");
    expect(statusGroupOf("AUTH_REQUIRED")).toBe("attention");
    expect(statusGroupOf("UNSUPPORTED")).toBe("inactive");
    expect(statusGroupOf("DISABLED")).toBe("inactive");
  });

  it("TW-CLOUD-MODEL filters by status group, following and name or domain", () => {
    const all = sampleCloudSources();
    const attention = filterCloudSources(all, {
      group: "attention",
      following: false,
      q: "",
    });
    expect(attention.map((source) => source.status).sort()).toEqual([
      "AUTH_REQUIRED",
      "BLOCKED",
      "FAILED",
      "RATE_LIMITED",
    ]);
    expect(
      filterCloudSources(all, { group: "all", following: true, q: "" })
    ).toHaveLength(2);
    expect(
      filterCloudSources(all, {
        group: "all",
        following: false,
        q: "KERJA-REMOTE.example",
      }).map((source) => source.name)
    ).toEqual(["Example Kerja Remote"]);
    expect(countByGroup(all)).toEqual({
      all: 8,
      active: 2,
      attention: 4,
      inactive: 2,
    });
  });

  it("TW-CLOUD-MODEL sorts followed first, then usable before broken, then priority and name", () => {
    const sorted = sortCloudSources([
      makeCloudSource({ name: "B", status: "FAILED", health: "FAILED" }),
      makeCloudSource({ name: "C", priority: 10 }),
      makeCloudSource({ name: "A", priority: 10 }),
      makeCloudSource({ name: "D", status: "UNSUPPORTED", following: true }),
      makeCloudSource({ name: "E", priority: 99 }),
    ]);
    expect(sorted.map((source) => source.name)).toEqual([
      "D",
      "E",
      "A",
      "C",
      "B",
    ]);
  });

  it("TW-CLOUD-MODEL the next run is paused for off pipelines, disabled sources, open breakers and stops that need an operator", () => {
    const base = makeCloudSource({ next_run_at: NOW + HOUR });
    expect(nextRunOf(base, NOW, true)).toEqual({ kind: "at", at: NOW + HOUR });
    expect(nextRunOf(base, NOW + 2 * HOUR, true)).toEqual({ kind: "due" });
    expect(nextRunOf(base, NOW, false)).toEqual({
      kind: "paused",
      reason: "pipeline_off",
    });
    expect(
      nextRunOf(makeCloudSource({ status: "SCRAPING" }), NOW, false)
    ).toEqual({ kind: "scraping" });
    expect(
      nextRunOf(
        makeCloudSource({ enabled: false, status: "DISABLED" }),
        NOW,
        true
      )
    ).toEqual({ kind: "paused", reason: "disabled" });
    expect(
      nextRunOf(
        makeCloudSource({
          health: "FAILED",
          status: "FAILED",
          circuit_open_until: NOW + 3 * HOUR,
        }),
        NOW,
        true
      )
    ).toEqual({ kind: "paused", reason: "breaker", until: NOW + 3 * HOUR });
    expect(
      nextRunOf(
        makeCloudSource({ health: "BLOCKED", status: "BLOCKED" }),
        NOW,
        true
      )
    ).toEqual({ kind: "paused", reason: "needs_retry" });
    expect(
      nextRunOf(
        makeCloudSource({ strategy: "none", strategy_config: {} }),
        NOW,
        true
      )
    ).toEqual({ kind: "paused", reason: "no_strategy" });
    expect(canRetry("BLOCKED")).toBe(true);
    expect(canRetry("ACTIVE")).toBe(false);
  });

  it("TW-CLOUD-MODEL diagnostics map error classes to actionable explanations", () => {
    expect(diagnosticOf(makeCloudSource())).toBeNull();
    expect(
      diagnosticOf(
        makeCloudSource({
          health: "BLOCKED",
          status: "BLOCKED",
          last_error_class: "challenge_detected",
          last_error_message: "Challenge page",
        })
      )
    ).toEqual({
      kind: "challenge",
      errorClass: "challenge_detected",
      key: "cloudSources.diagnostics.challenge",
      message: "Challenge page",
    });
    expect(
      diagnosticOf(
        makeCloudSource({ health: "AUTH_REQUIRED", status: "AUTH_REQUIRED" })
      )?.kind
    ).toBe("auth");
    for (const errorClass of [
      "parse_error",
      "schema_invalid",
      "selector_drift",
    ] as const) {
      expect(
        diagnosticOf(makeCloudSource({ last_error_class: errorClass }))?.kind
      ).toBe("layout");
    }
    expect(
      diagnosticOf(makeCloudSource({ last_error_class: "engine_unavailable" }))
        ?.kind
    ).toBe("engine");
  });

  it("TW-CLOUD-MODEL the strategy config is JSON checked against the strategy's schema", () => {
    expect(checkStrategyConfig("rss", "{").syntax).toBe(true);
    const missing = checkStrategyConfig(
      "rss",
      JSON.stringify({ url: "https://board.example/feed.rss" })
    );
    expect(missing.syntax).toBe(false);
    expect(
      missing.issues.some((issue) => issue.startsWith("title_pattern"))
    ).toBe(true);
    expect(
      checkStrategyConfig(
        "rss",
        JSON.stringify({
          url: "https://board.example/feed.rss",
          title_pattern: "company_title",
        })
      ).issues
    ).toEqual([]);
    expect(checkStrategyConfig("none", "[]").syntax).toBe(true);
  });

  it("TW-CLOUD-MODEL the editor sends only changed fields, ignoring key order", () => {
    const source = makeCloudSource();
    const form = editorFormOf(source);
    expect(editorChanges(source, form)).toEqual({ ok: true, changes: {} });
    const reordered = JSON.stringify({
      defaults: { workplace_type: "remote" },
      separator: ": ",
      title_pattern: "company_title",
      url: "https://remote-board.example/jobs.rss",
    });
    expect(editorChanges(source, { ...form, configText: reordered })).toEqual({
      ok: true,
      changes: {},
    });
    expect(
      editorChanges(source, {
        ...form,
        priority: "80",
        intervalMinutes: 360,
        statusReason: "  ",
        maxPages: "",
        authNote: "Members only",
      })
    ).toEqual({
      ok: true,
      changes: {
        priority: 80,
        interval_minutes: 360,
        rate_limit: { min_delay_ms: 2000, max_items: 200 },
        auth_note: "Members only",
      },
    });
    const bad = editorChanges(source, {
      ...form,
      priority: "101",
      maxItems: "9999",
      configText: "{",
    });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? null : bad.errors).toMatchObject({
      priority: true,
      rate: ["maxItems"],
    });
    expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(
      '{"a":[{"c":2,"d":1}],"b":1}'
    );
  });

  it("TW-CLOUD-MODEL a new board needs a public http(s) address without credentials", () => {
    expect(boardUrlProblem("")).toBe("empty");
    expect(boardUrlProblem("remotefreelance.id/jobs")).toBe("invalid");
    expect(boardUrlProblem("ftp://board.example")).toBe("scheme");
    expect(boardUrlProblem("https://user:pw@board.example")).toBe(
      "credentials"
    );
    expect(boardUrlProblem("http://localhost:8788")).toBe("local");
    expect(boardUrlProblem("http://169.254.169.254/latest")).toBe("local");
    expect(boardUrlProblem("http://[::1]/")).toBe("local");
    expect(boardUrlProblem("https://intranet/jobs")).toBe("local");
    expect(boardUrlProblem("https://remotefreelance.id/jobs")).toBeNull();
  });

  it("TW-CLOUD-MODEL polls fast while a source scrapes or a run was just queued", () => {
    expect(hasLiveCloudWork([makeCloudSource()], 0, NOW)).toBe(false);
    expect(hasLiveCloudWork([makeCloudSource()], NOW + 1000, NOW)).toBe(true);
    expect(
      hasLiveCloudWork([makeCloudSource({ status: "SCRAPING" })], 0, NOW)
    ).toBe(true);
    expect(
      hasLiveCloudWork([makeCloudSource({ last_run_status: "queued" })], 0, NOW)
    ).toBe(true);
  });

  it("TW-CLOUD-MODEL durations read naturally", () => {
    expect(formatDuration(850, "en")).toBe("850 ms");
    expect(formatDuration(4500, "en")).toBe("4.5 s");
    expect(formatDuration(4500, "id")).toBe("4,5 s");
    expect(formatDuration(125_000, "en")).toBe("2 min 5 s");
    expect(formatDuration(3_780_000, "en")).toBe("1 h 3 min");
  });
});
