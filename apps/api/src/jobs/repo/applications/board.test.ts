import { describe, expect, it } from "bun:test";
import { createTestEnv } from "../../../../test/fakes";
import { boardSql } from "./board";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
// Plan steps that read rows without an index, other than the derived
// table `a` and SQLite's co-routines/subquery materializations.
const UNINDEXED_SCAN_RE = /^SCAN (?!a$|\(subquery-\d+\)$)/;
const APPLICATION_READS_RE = / x /;
const USER_RANGE_RE = /^SEARCH x USING INDEX ix_apps_\w+ \(user_id=\?/;

function plan(includeArchived: boolean): string[] {
  const t = createTestEnv();
  const rows = t.jobsSqlite
    .query(`EXPLAIN QUERY PLAN ${boardSql(includeArchived)}`)
    .all(1, "r1", USER, 200) as Array<{ detail: string }>;
  return rows.map((row) => row.detail);
}

describe("board query (04 §3)", () => {
  it("reads the user's applications with ONE ix_apps_board range; every per-card subquery is an index search", () => {
    const steps = plan(false);
    const applicationReads = steps.filter((s) =>
      APPLICATION_READS_RE.test(`${s} `)
    );
    expect(applicationReads).toEqual([
      "SEARCH x USING INDEX ix_apps_board (user_id=? AND archived=?)",
    ]);
    expect(steps.filter((s) => UNINDEXED_SCAN_RE.test(s))).toEqual([]);
    for (const alias of ["u", "p", "s", "t", "i", "o"]) {
      expect(steps.some((s) => s.startsWith(`SEARCH ${alias} USING`))).toBe(
        true
      );
    }
  });

  it("include_archived=1 still reads one indexed range of the user's applications", () => {
    const steps = plan(true);
    const applicationReads = steps.filter((s) =>
      APPLICATION_READS_RE.test(`${s} `)
    );
    expect(applicationReads).toHaveLength(1);
    expect(applicationReads[0]).toMatch(USER_RANGE_RE);
    expect(steps.filter((s) => UNINDEXED_SCAN_RE.test(s))).toEqual([]);
  });
});
