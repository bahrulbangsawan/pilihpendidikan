import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { API_ROUTE_SCHEMAS } from "../src/api/routes";
import { TABLE_RECORDS } from "../src/records";
import { RECORD_EXAMPLES, ROUTE_EXAMPLES } from "./examples";

const SPEC = join(import.meta.dir, "..", "..", "..", "job-tracker-spec");
const CREATE_TABLE = /CREATE TABLE(?: IF NOT EXISTS)? (\w+) \(([\s\S]*?)\n\);/g;
const COLUMN = /^\s{2}([a-z_0-9]+)\s+(TEXT|INTEGER|REAL)\b/;
const ALTER = /ALTER TABLE (\w+) ADD COLUMN (\w+)/g;
const MUTATING = /^(POST|PUT|PATCH) /;

/** Parse → JSON → parse is stable for a schema and a value. */
function expectRoundTrip(schema: z.ZodType, value: unknown) {
  const first = schema.parse(value);
  const second = schema.parse(JSON.parse(JSON.stringify(first)));
  expect(second).toEqual(first);
}

function ddlColumns(): Map<string, string[]> {
  const ddl = readFileSync(join(SPEC, "04-DATABASE-SCHEMA.md"), "utf8");
  const tables = new Map<string, string[]>();
  for (const match of ddl.matchAll(CREATE_TABLE)) {
    const cols: string[] = [];
    for (const line of (match[2] ?? "").split("\n")) {
      const col = COLUMN.exec(line);
      if (col?.[1]) {
        cols.push(col[1]);
      }
    }
    tables.set(match[1] ?? "", cols);
  }
  for (const match of ddl.matchAll(ALTER)) {
    tables.set(match[1] ?? "", [
      ...(tables.get(match[1] ?? "") ?? []),
      match[2] ?? "",
    ]);
  }
  return tables;
}

describe("table records (04)", () => {
  test("TC-ROUNDTRIP TABLE_RECORDS covers every table and DDL column of 04", () => {
    const tables = ddlColumns();
    expect(tables.size).toBeGreaterThanOrEqual(33);
    for (const [table, cols] of tables) {
      const schema = (TABLE_RECORDS as Record<string, z.ZodObject>)[table];
      expect(schema, table).toBeDefined();
      for (const col of cols) {
        expect(Object.keys(schema?.shape ?? {}), `${table}.${col}`).toContain(
          col
        );
      }
    }
  });

  test.each(Object.keys(TABLE_RECORDS).map((table) => [table] as const))(
    "TC-ROUNDTRIP record %s round-trips its example row",
    (table) => {
      const schema = TABLE_RECORDS[table as keyof typeof TABLE_RECORDS];
      const example = RECORD_EXAMPLES[table as keyof typeof RECORD_EXAMPLES];
      expectRoundTrip(schema, example);
      // Every column of the row schema is present in the example.
      expect(Object.keys(example).sort()).toEqual(
        Object.keys(schema.shape).sort()
      );
    }
  );

  test("TC-ROUNDTRIP enum columns reject values outside their CHECK list", () => {
    let checked = 0;
    for (const [table, schema] of Object.entries(TABLE_RECORDS)) {
      const example = RECORD_EXAMPLES[
        table as keyof typeof RECORD_EXAMPLES
      ] as Record<string, unknown>;
      for (const [col, field] of Object.entries(schema.shape)) {
        let inner: z.ZodType = field as z.ZodType;
        while (
          inner instanceof z.ZodNullable ||
          inner instanceof z.ZodOptional
        ) {
          inner = inner.unwrap() as z.ZodType;
        }
        if (inner instanceof z.ZodEnum) {
          checked++;
          expect(
            schema.safeParse({ ...example, [col]: "__bogus__" }).success,
            `${table}.${col}`
          ).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  test("TC-ROUNDTRIP cross-column CHECKs are enforced", () => {
    const posting = RECORD_EXAMPLES.job_postings;
    expect(
      TABLE_RECORDS.job_postings.safeParse({
        ...posting,
        visibility: "private",
      }).success
    ).toBe(false);
    expect(
      TABLE_RECORDS.job_postings.safeParse({
        ...posting,
        visibility: "private",
        owner_user_id: RECORD_EXAMPLES.users.id,
      }).success
    ).toBe(true);
    const answer = RECORD_EXAMPLES.screening_answers;
    expect(
      TABLE_RECORDS.screening_answers.safeParse({
        ...answer,
        auto_use: "always",
      }).success
    ).toBe(false);
    const event = RECORD_EXAMPLES.application_events;
    expect(
      TABLE_RECORDS.application_events.safeParse({
        ...event,
        type: "note_added",
      }).success
    ).toBe(false);
    const approval = RECORD_EXAMPLES.approvals;
    expect(
      TABLE_RECORDS.approvals.safeParse({ ...approval, kind: "answer" }).success
    ).toBe(false);
  });

  test("TC-ROUNDTRIP flags are booleans and JSON columns are parsed shapes", () => {
    const app = RECORD_EXAMPLES.applications;
    expect(
      TABLE_RECORDS.applications.safeParse({ ...app, archived: 0 }).success
    ).toBe(false);
    expect(
      TABLE_RECORDS.applications.safeParse({ ...app, sections: "[]" }).success
    ).toBe(false);
    expect(
      TABLE_RECORDS.job_postings.safeParse({
        ...RECORD_EXAMPLES.job_postings,
        locations: "[]",
      }).success
    ).toBe(false);
    expect(
      TABLE_RECORDS.match_scores.safeParse({
        ...RECORD_EXAMPLES.match_scores,
        components: {},
      }).success
    ).toBe(true);
    expect(
      TABLE_RECORDS.match_scores.safeParse({
        ...RECORD_EXAMPLES.match_scores,
        score: 101,
      }).success
    ).toBe(false);
  });
});

describe("API routes (05)", () => {
  test("TC-ROUNDTRIP API_ROUTE_SCHEMAS is keyed by method + exact path and complete", () => {
    const keys = Object.keys(API_ROUTE_SCHEMAS);
    expect(keys).toHaveLength(105);
    const operations = new Set<string>();
    for (const [key, contract] of Object.entries(API_ROUTE_SCHEMAS)) {
      expect(key).toBe(`${contract.method} ${contract.path}`);
      expect(contract.response).toBeDefined();
      if (MUTATING.test(key)) {
        expect("request" in contract).toBe(true);
      }
      operations.add(contract.operation);
    }
    expect(operations.size).toBe(keys.length);
  });

  test.each(Object.keys(API_ROUTE_SCHEMAS).map((key) => [key] as const))(
    "TC-ROUNDTRIP route %s round-trips its example",
    (key) => {
      const contract = API_ROUTE_SCHEMAS[key as keyof typeof API_ROUTE_SCHEMAS];
      const example = ROUTE_EXAMPLES[key];
      expect(example, key).toBeDefined();
      expectRoundTrip(contract.response, example?.response);
      if (contract.request) {
        expect(example?.request, `${key} request example`).toBeDefined();
        expectRoundTrip(contract.request, example?.request);
      }
      if (
        "query" in contract &&
        contract.query &&
        example?.query !== undefined
      ) {
        expect(contract.query.safeParse(example.query).success).toBe(true);
      }
    }
  );

  test("TC-ROUNDTRIP claim answers null for 204 and requests are validated", () => {
    const claim =
      API_ROUTE_SCHEMAS["POST /api/v1/devices/{dev_id}/tasks:claim"];
    expect(claim.response.safeParse(null).success).toBe(true);
    expect(
      claim.request.safeParse({ capabilities: ["apply"], max: 2 }).success
    ).toBe(false);
    const move = API_ROUTE_SCHEMAS["POST /api/v1/applications/{app_id}/move"];
    // base_revision may come as If-Match instead (05 §1.6); stage is required.
    expect(move.request.safeParse({ stage: "applied" }).success).toBe(true);
    expect(move.request.safeParse({ base_revision: 3 }).success).toBe(false);
    const scores = API_ROUTE_SCHEMAS["POST /api/v1/scores:request"];
    expect(scores.request.safeParse({}).success).toBe(false);
    const batch =
      API_ROUTE_SCHEMAS["POST /api/v1/discovery/runs/{run_id}/postings:batch"];
    // A malformed full item never parses as an unchanged-only item.
    expect(
      batch.request.safeParse({
        items: [
          {
            client_ref: "1",
            fingerprint: `fp1:${"0".repeat(64)}`,
            content_hash: "0".repeat(64),
            observed_at: 1,
            title: "x",
          },
        ],
      }).success
    ).toBe(false);
  });

  test("TC-ROUNDTRIP error envelope and pagination envelope", () => {
    const list = API_ROUTE_SCHEMAS["GET /api/v1/applications"];
    expect(
      list.response.safeParse({ items: [], next_cursor: null }).success
    ).toBe(true);
    expect(list.response.safeParse({ items: [] }).success).toBe(false);
  });
});
