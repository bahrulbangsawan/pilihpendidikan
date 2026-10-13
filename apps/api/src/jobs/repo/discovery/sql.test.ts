// D1 limits of the discovery statements (14 §4: ≤ 100 params per statement).
import { describe, expect, it } from "bun:test";
import { createTestEnv } from "../../../../test/fakes";
import { trustedScope } from "../../core/scope";
import { jobsDb } from "../core/db";
import { insertRunItemStatements, insertUserJobStatements } from "./postings";
import {
  changeLogRows,
  insertRows,
  likePattern,
  MAX_PARAMS_PER_STATEMENT,
} from "./sql";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";

function params(statement: D1PreparedStatement): unknown[] {
  return (statement as unknown as { params: unknown[] }).params;
}

describe("TD-BATCH-LIMITS multi-row INSERTs respect the D1 parameter limit", () => {
  it("TD-BATCH-LIMITS insertRows chunks rows so no statement binds more than 100 parameters", () => {
    const t = createTestEnv();
    const db = jobsDb(t.env);
    const rows = Array.from({ length: 250 }, (_, i) => [i, `v${i}`, i * 2]);
    const statements = insertRows(
      db,
      { head: "INSERT INTO x (a, b, c)", rowSql: "(?, ?, ?)" },
      rows
    );
    expect(statements).toHaveLength(Math.ceil(250 / 33));
    expect(
      statements.every((s) => params(s).length <= MAX_PARAMS_PER_STATEMENT)
    ).toBe(true);
    expect(statements.flatMap(params)).toEqual(rows.flat());
    expect(
      insertRows(db, { head: "INSERT INTO x (a)", rowSql: "(?)" }, [])
    ).toEqual([]);
  });

  it("TD-BATCH-LIMITS a full batch's user_jobs, run items and change rows fit in a handful of statements", () => {
    const t = createTestEnv();
    const db = jobsDb(t.env);
    const scope = trustedScope(USER, "script");
    const links = Array.from({ length: 100 }, (_, i) => ({
      id: `ujb_${i}`,
      postingId: `pst_${i}`,
      origin: "discovered" as const,
      inboxState: "new" as const,
      firstRunId: "run_1",
      sourceId: null,
      userNotes: "",
    }));
    const userJobs = insertUserJobStatements(db, scope, links, 1);
    const runItems = insertRunItemStatements(
      db,
      scope,
      "run_1",
      links.map((l) => ({ postingId: l.postingId, outcome: "new" }))
    );
    const changes = changeLogRows(
      db,
      scope,
      links.flatMap((l) => [
        { entity: "posting", entityId: l.postingId, revision: 1 },
        { entity: "user_job", entityId: l.id, revision: 1 },
      ]),
      1
    );
    expect(
      userJobs.length + runItems.length + changes.length
    ).toBeLessThanOrEqual(30);
    for (const s of [...userJobs, ...runItems, ...changes]) {
      expect(params(s).length).toBeLessThanOrEqual(MAX_PARAMS_PER_STATEMENT);
    }
  });

  it("TD-INBOX likePattern escapes LIKE wildcards", () => {
    expect(likePattern("50%_off\\x")).toBe("%50\\%\\_off\\\\x%");
  });
});
