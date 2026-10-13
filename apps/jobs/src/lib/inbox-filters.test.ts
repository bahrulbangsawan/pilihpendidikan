import { describe, expect, it } from "vitest";
import { DAY, NOW } from "@/test/fixtures";
import { makeInboxItem } from "@/test/fixtures-rest";
import {
  activeFilterCount,
  applyClientFilters,
  clearedSearch,
  inboxApiQuery,
  isFiltered,
  validateInboxSearch,
} from "./inbox-filters";

describe("TW-INBOX filters (12 §4, 07 §12)", () => {
  it("TW-INBOX validateInboxSearch keeps valid filters from the URL and drops malformed ones", () => {
    expect(
      validateInboxSearch({
        state: "seen",
        q: "frontend",
        min: "70",
        source: "src_01J9ZZZZZZZZZZZZZZZZZZZZZ1",
        workplace: "remote",
        posted: "7",
        band: "high",
        blockers: "1",
      })
    ).toEqual({
      state: "seen",
      q: "frontend",
      min: 70,
      source: "src_01J9ZZZZZZZZZZZZZZZZZZZZZ1",
      workplace: "remote",
      posted: 7,
      band: "high",
      blockers: 1,
    });
    expect(
      validateInboxSearch({
        state: "new",
        q: "   ",
        min: "-3",
        source: "../etc",
        workplace: "moon",
        posted: "3",
        band: "great",
        blockers: "yes",
      })
    ).toEqual({});
    expect(validateInboxSearch({ min: "250" })).toEqual({ min: 100 });
    expect(validateInboxSearch({ q: "x".repeat(201) })).toEqual({});
  });

  it("TW-INBOX filters map to the GET /api/v1/inbox query (state, min_score, source, q)", () => {
    expect(inboxApiQuery({})).toEqual({ state: "new", limit: 50 });
    expect(
      inboxApiQuery({
        state: "dismissed",
        min: 80,
        source: "greenhouse",
        q: "  data  ",
        workplace: "remote",
        band: "mid",
      })
    ).toEqual({
      state: "dismissed",
      limit: 50,
      min_score: 80,
      source: "greenhouse",
      q: "data",
    });
  });

  it("TW-INBOX workplace, posted within, score band and hide blockers filter the loaded rows", () => {
    const remoteHigh = makeInboxItem({
      company: "Acme",
      title: "Frontend",
      score: 91,
      posting: { workplace_type: "remote", posted_at: NOW - DAY },
    });
    const onsiteMid = makeInboxItem({
      company: "Globex",
      title: "Data",
      score: 65,
      posting: { workplace_type: "onsite", posted_at: NOW - 20 * DAY },
    });
    const unscored = makeInboxItem({
      company: "Initech",
      title: "SRE",
      score: null,
      posting: { workplace_type: "remote", posted_at: null },
    });
    const blocked = makeInboxItem({
      company: "Grab",
      title: "ML",
      score: 85,
      posting: { workplace_type: "onsite", posted_at: NOW - 2 * DAY },
    });
    if (blocked.score) {
      blocked.score.explanation = `⚠ Possible blocker: on-site outside your locations\n${blocked.score.explanation}`;
    }
    const all = [remoteHigh, onsiteMid, unscored, blocked];
    const titles = (search: Parameters<typeof applyClientFilters>[1]) =>
      applyClientFilters(all, search, NOW).map((item) => item.posting.title);
    expect(titles({ workplace: "remote" })).toEqual(["Frontend", "SRE"]);
    expect(titles({ posted: 7 })).toEqual(["Frontend", "SRE", "ML"]);
    expect(titles({ band: "high" })).toEqual(["Frontend", "ML"]);
    expect(titles({ band: "mid" })).toEqual(["Data"]);
    expect(titles({ band: "unscored" })).toEqual(["SRE"]);
    expect(titles({ blockers: 1 })).toEqual(["Frontend", "Data", "SRE"]);
    expect(titles({ band: "high", blockers: 1 })).toEqual(["Frontend"]);
  });

  it("TW-INBOX counts and clears filters, keeping the tab", () => {
    const search = {
      state: "seen" as const,
      q: "x",
      min: 60,
      band: "low" as const,
    };
    expect(activeFilterCount(search)).toBe(2);
    expect(isFiltered(search)).toBe(true);
    expect(isFiltered({ state: "seen" })).toBe(false);
    expect(clearedSearch(search)).toEqual({ state: "seen" });
    expect(clearedSearch({ min: 5 })).toEqual({});
  });
});
