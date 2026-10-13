import { describe, expect, it } from "vitest";
import { DAY, makeDevice, makePosting, NOW } from "@/test/fixtures";
import { makeInboxItem, makeRun } from "@/test/fixtures-rest";
import {
  alternateListings,
  anyRunActive,
  blockedSources,
  importStripRun,
  inboxEmptyKind,
  lastRunAt,
  listingCount,
  provenanceOf,
  trackedJobRedirect,
} from "./inbox-state";

const HOUR = 3_600_000;
const deviceId = makeDevice().id;

describe("TW-INBOX empty states, import strip and provenance (12 §4)", () => {
  it("TW-INBOX the empty state is no sources, then no runs, then all caught up; filters and other tabs come first", () => {
    const base = { filtered: false, runs: 0, sources: 0, tab: "new" as const };
    expect(inboxEmptyKind(base)).toBe("no_sources");
    expect(inboxEmptyKind({ ...base, sources: 2 })).toBe("no_runs");
    expect(inboxEmptyKind({ ...base, sources: 2, runs: 3 })).toBe("caught_up");
    expect(inboxEmptyKind({ ...base, filtered: true })).toBe("no_matches");
    expect(inboxEmptyKind({ ...base, tab: "dismissed" })).toBe("empty_tab");
  });

  it("TW-INBOX the strip shows the newest run finished within 24 h, with blocked sources; the inbox polls only while a run runs", () => {
    const old = makeRun(deviceId, {
      started_at: NOW - 30 * HOUR,
      finished_at: NOW - 29 * HOUR,
    });
    const recent = makeRun(deviceId, {
      started_at: NOW - 3 * HOUR,
      finished_at: NOW - 2 * HOUR,
      status: "partial",
      sources: [
        { source_id: null, adapter: "workday", label: "Workday" },
        { source_id: null, adapter: "greenhouse", label: "Acme" },
      ],
      errors: [
        { source: "Workday", error_class: "access_denied" },
        { source: "Workday", error_class: "access_denied" },
        { source: "Acme", error_class: "network" },
      ],
    });
    const running = makeRun(deviceId, {
      status: "running",
      started_at: NOW - 60_000,
      finished_at: null,
    });
    expect(importStripRun([old, recent, running], NOW)?.id).toBe(recent.id);
    expect(importStripRun([old], NOW)).toBeNull();
    expect(blockedSources(recent)).toEqual([
      { label: "Workday", errorClass: "access_denied" },
    ]);
    expect(anyRunActive([old, recent])).toBe(false);
    expect(anyRunActive([old, running])).toBe(true);
    expect(anyRunActive(undefined)).toBe(false);
    expect(lastRunAt([old, recent])).toBe(NOW - 2 * HOUR);
    expect(lastRunAt([])).toBeNull();
  });

  it("TW-INBOX provenance and duplicate listings are read defensively from extraction", () => {
    const item = makeInboxItem({
      company: "Acme",
      title: "FE",
      duplicates: 2,
    });
    expect(provenanceOf(item.posting)).toMatchObject({
      adapter: "greenhouse",
      adapterVersion: "1.0.0",
      fetchMode: "json_api",
      confidence: 0.97,
    });
    expect(provenanceOf(makePosting({ extraction: {} }))).toEqual({
      adapter: null,
      adapterVersion: null,
      fetchMode: null,
      method: null,
      confidence: null,
      runId: null,
    });
    const withAlternates = makePosting({
      extraction: {
        v: 1,
        adapter: "greenhouse",
        adapter_version: "1.0.0",
        fetch_mode: "json_api",
        method: "json_api",
        confidence: 1,
        observed_at: NOW - DAY,
        alternates: [
          {
            adapter: "career_page",
            fetch_mode: "static_html",
            source_urls: { detail: "https://acme.example/careers/1" },
            observed_at: NOW - DAY,
          },
          { adapter: 42 },
          "nonsense",
          null,
        ],
      } as never,
    });
    expect(alternateListings(withAlternates)).toEqual([
      {
        adapter: "career_page",
        fetchMode: "static_html",
        observedAt: NOW - DAY,
        url: "https://acme.example/careers/1",
      },
    ]);
    expect(listingCount({ ...item, posting: withAlternates })).toBe(4);
    expect(listingCount(makeInboxItem({ company: "A", title: "B" }))).toBe(1);
  });

  it("TW-INBOX a tracked job redirects to its application", () => {
    expect(trackedJobRedirect({ application: null })).toBeNull();
    expect(trackedJobRedirect({ application: { id: "app_01J9ABC" } })).toBe(
      "/applications/app_01J9ABC"
    );
  });
});
