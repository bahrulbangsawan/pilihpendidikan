import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FEATURE_FLAG_KEYS } from "@pilihpendidikan/jobs-contracts/enums";
import { TABLE_RECORDS } from "@pilihpendidikan/jobs-contracts/records";
import type { z } from "zod";
import { createTestJobsD1 } from "../../../test/fakes";
import { ROW_CODECS } from "../repo/core/db";

const API_DIR = join(import.meta.dir, "..", "..", "..");
const MIGRATIONS = join(API_DIR, "migrations");
const JOBS_MIGRATION = join(API_DIR, "migrations-jobs", "0001_jobs_core.sql");
const SPEC_04 = join(
  API_DIR,
  "..",
  "..",
  "job-tracker-spec",
  "04-DATABASE-SCHEMA.md"
);

const JOBS_TABLES = Object.keys(ROW_CODECS);
const SUBSECTION_RE = /^-- 2\.\d /;
const SQL_BLOCK_RE = /```sql\n([\s\S]*?)```/g;

function sql(file: string): string {
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function columns(db: Database, table: string): string[] {
  return (
    db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((c) => c.name);
}

describe("TCORE-MIGRATION identity migrations 0002/0003 (04 §1, 17 §3.2)", () => {
  function legacyDb(): Database {
    const db = new Database(":memory:");
    db.exec(sql("0001_initial.sql"));
    const insert = db.query(
      "INSERT INTO mcp_tokens (id, user_email, token_hash, label, status, kind, scope, created_at, revoked_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    insert.run(
      "t-personal",
      "a@x.com",
      "h1",
      "laptop",
      "active",
      "personal",
      "read",
      1,
      null,
      7,
      null
    );
    insert.run(
      "t-session",
      "a@x.com",
      "h2",
      "Browser session",
      "active",
      "session",
      "write",
      2,
      null,
      null,
      99
    );
    insert.run(
      "t-oauth",
      "b@x.com",
      "h3",
      "OAuth: Claude",
      "revoked",
      "session",
      "write",
      3,
      4,
      5,
      6
    );
    db.query(
      "INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method, created_at) VALUES ('dcr-1', '', 'Claude', '[\"https://claude.ai/cb\"]', 'none', 1)"
    ).run();
    return db;
  }

  function migrate(db: Database): void {
    for (const file of readdirSync(MIGRATIONS).sort()) {
      if (file.endsWith(".sql") && file !== "0001_initial.sql") {
        db.exec(sql(file));
      }
    }
  }

  it("TCORE-MIGRATION rebuilds mcp_tokens keeping every row and column", () => {
    const db = legacyDb();
    const before = db.query("SELECT * FROM mcp_tokens ORDER BY id").all();
    migrate(db);
    const after = db
      .query(
        "SELECT id, user_email, token_hash, label, status, kind, scope, created_at, revoked_at, last_used_at, expires_at FROM mcp_tokens ORDER BY id"
      )
      .all();
    expect(after).toEqual(before);
    expect(columns(db, "mcp_tokens")).toEqual([
      "id",
      "user_email",
      "token_hash",
      "label",
      "status",
      "kind",
      "scope",
      "created_at",
      "revoked_at",
      "last_used_at",
      "expires_at",
      "user_id",
      "scopes",
      "grant_id",
      "device_id",
    ]);
    const extra = db
      .query("SELECT user_id, scopes, grant_id, device_id FROM mcp_tokens")
      .all();
    expect(
      extra.every((row) =>
        Object.values(row as object).every((v) => v === null)
      )
    ).toBe(true);
    db.query(
      "INSERT INTO mcp_tokens (id, user_email, token_hash, kind, scope, created_at, scopes) VALUES ('t-cli', 'c@x.com', 'h4', 'oauth', 'write', 5, 'jobs:read')"
    ).run();
    expect(() =>
      db
        .query(
          "INSERT INTO mcp_tokens (id, user_email, token_hash, kind, created_at) VALUES ('t-x', 'c@x.com', 'h5', 'bogus', 5)"
        )
        .run()
    ).toThrow("CHECK constraint failed");
    expect(() =>
      db
        .query(
          "INSERT INTO mcp_tokens (id, user_email, token_hash, kind, created_at) VALUES ('t-y', 'c@x.com', 'h4', 'personal', 5)"
        )
        .run()
    ).toThrow("UNIQUE");
    const indexes = (
      db.query("PRAGMA index_list(mcp_tokens)").all() as Array<{ name: string }>
    ).map((i) => i.name);
    expect(indexes).toContain("idx_mcp_tokens_user_kind");
    expect(indexes).toContain("idx_mcp_tokens_grant");
  });

  it("TCORE-MIGRATION creates users, grants, refresh tokens, devices, flags and the support log", () => {
    const db = legacyDb();
    migrate(db);
    expect(columns(db, "users")).toEqual([
      "id",
      "email",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);
    expect(columns(db, "oauth_grants")).toContain("revoked_reason");
    expect(columns(db, "oauth_refresh_tokens")).toEqual([
      "id",
      "grant_id",
      "token_hash",
      "parent_id",
      "created_at",
      "expires_at",
      "used_at",
      "revoked_at",
    ]);
    expect(columns(db, "devices")).toContain("last_ip_hash");
    expect(columns(db, "support_access_log")).toEqual([
      "id",
      "operator_email",
      "subject_user_id",
      "reason",
      "ticket_ref",
      "scope",
      "created_at",
    ]);
    expect(columns(db, "oauth_clients")).toEqual(
      expect.arrayContaining([
        "first_party",
        "allowed_scopes",
        "loopback_any_port",
      ])
    );
    expect(() =>
      db
        .query(
          "INSERT INTO devices (id, user_id, grant_id, name, platform, arch, cli_version, created_at) VALUES ('d', 'u', 'g', 'n', 'beos', 'x', '0.1.0', 1)"
        )
        .run()
    ).toThrow("CHECK constraint failed");
  });

  it("TCORE-MIGRATION seeds every D-33 flag dark (incl. the 24 cloud flags) and the CLI client of 17 §3.2", () => {
    const db = legacyDb();
    migrate(db);
    const flags = Object.fromEntries(
      (
        db
          .query("SELECT key, value, updated_by FROM feature_flags")
          .all() as Array<{ key: string; value: string }>
      ).map((row) => [row.key, row.value])
    );
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_FLAG_KEYS].sort());
    expect(flags).toEqual({
      JOBS_V1_ENABLED: "false",
      JOBS_CLI_LOGIN_ENABLED: "false",
      JOBS_AUTOMATION_ENABLED: "false",
      JOBS_AUTO_MODE_ENABLED: "false",
      JOBS_EMAIL_SERVER_SEND_ENABLED: "false",
      AI_DISABLED: "false",
      JOBS_LEGACY_BACKEND: '"kv"',
      JOBS_CLOUD_DISCOVERY_ENABLED: "false",
      JOBS_CLOUD_AI_ENABLED: "false",
    });
    const cli = db
      .query("SELECT * FROM oauth_clients WHERE client_id = 'pilih-jobs-cli'")
      .get() as Record<string, unknown>;
    expect(cli).toMatchObject({
      client_secret_hash: "",
      client_name: "pilih-jobs CLI",
      token_endpoint_auth_method: "none",
      first_party: 1,
      loopback_any_port: 1,
      allowed_scopes:
        "jobs:read jobs:write discovery:write automation:execute automation:manage cv:read cv:write files:read files:write ai:invoke devices:manage offline_access",
    });
    expect(JSON.parse(cli.redirect_uris as string)).toEqual([
      "http://127.0.0.1/callback",
      "http://[::1]/callback",
    ]);
    expect(
      db
        .query(
          "SELECT allowed_scopes FROM oauth_clients WHERE client_id = 'dcr-1'"
        )
        .get()
    ).toEqual({ allowed_scopes: "mcp" });
  });
});

function specBlocks(): string {
  const text = readFileSync(SPEC_04, "utf8");
  const section = text.slice(
    text.indexOf("## 2. `JOBS_DB`"),
    text.indexOf("## 3.")
  );
  const blocks: string[] = [];
  for (const match of section.matchAll(SQL_BLOCK_RE)) {
    blocks.push(match[1]);
  }
  return blocks.join("\n");
}

function normalize(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
}

type AnySchema = z.ZodType & {
  _zod: { def: Record<string, unknown> & { type: string } };
};

function baseType(schema: AnySchema): string {
  let def = schema._zod.def;
  while (
    def.type === "nullable" ||
    def.type === "optional" ||
    def.type === "default"
  ) {
    def = (def.innerType as AnySchema)._zod.def;
  }
  return def.type;
}

const JSON_TYPES = new Set([
  "object",
  "array",
  "record",
  "union",
  "intersection",
  "tuple",
]);

describe("TCORE-JOBS-SCHEMA JOBS_DB migration 0001 (04 §2)", () => {
  it("TCORE-JOBS-SCHEMA is the 04 §2 DDL verbatim", () => {
    const migration = readFileSync(JOBS_MIGRATION, "utf8");
    const body = migration
      .slice(migration.indexOf("-- 2.1"))
      .split("\n")
      .filter((line) => !SUBSECTION_RE.test(line))
      .join("\n");
    expect(normalize(body)).toBe(normalize(specBlocks()));
  });

  it("TCORE-JOBS-SCHEMA has every table, index and partial unique index", () => {
    const { sqlite } = createTestJobsD1();
    const tables = (
      sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as Array<{ name: string }>
    )
      .map((t) => t.name)
      .sort();
    expect(tables).toEqual([...JOBS_TABLES].sort());
    const indexSql = sqlite
      .query(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL"
      )
      .all() as Array<{
      name: string;
      sql: string;
    }>;
    const names = indexSql.map((i) => i.name);
    for (const name of [
      "ux_postings_public_fp",
      "ux_postings_private_fp",
      "ux_apps_legacy",
      "ux_tasks_live_apply",
      "ix_apps_board",
      "ix_tasks_claim",
      "ix_change_user_seq",
    ]) {
      expect(names).toContain(name);
    }
    expect(
      indexSql.find((i) => i.name === "ux_tasks_live_apply")?.sql
    ).toContain("WHERE kind = 'apply'");
  });

  it("TCORE-JOBS-SCHEMA columns match the contracts' records, and the row codecs match their JSON/boolean fields", () => {
    const { sqlite } = createTestJobsD1();
    for (const table of JOBS_TABLES) {
      const schema = TABLE_RECORDS[
        table as keyof typeof TABLE_RECORDS
      ] as unknown as { shape: Record<string, AnySchema> };
      expect(columns(sqlite, table).sort()).toEqual(
        Object.keys(schema.shape).sort()
      );
      const bools = Object.entries(schema.shape)
        .filter(([, field]) => baseType(field) === "boolean")
        .map(([name]) => name)
        .sort();
      expect([...ROW_CODECS[table].bool].sort()).toEqual(bools);
      const jsons = Object.entries(schema.shape)
        .filter(([, field]) => JSON_TYPES.has(baseType(field)))
        .map(([name]) => name)
        .sort();
      expect(Object.keys(ROW_CODECS[table].json).sort()).toEqual(jsons);
    }
  });

  it("TCORE-JOBS-SCHEMA enforces the CHECKs and partial unique indexes", () => {
    const { sqlite } = createTestJobsD1();
    const posting = (
      id: string,
      visibility: string,
      owner: string | null,
      fp: string
    ) =>
      sqlite
        .query(
          "INSERT INTO job_postings (id, fingerprint, visibility, owner_user_id, source_kind, company_name, title, content_hash, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual', 'A', 'T', 'h', 1, 1, 1, 1)"
        )
        .run(id, fp, visibility, owner);
    posting("p1", "public", null, "fp1:a");
    expect(() => posting("p2", "public", null, "fp1:a")).toThrow("UNIQUE");
    posting("p3", "private", "u1", "fp1:a");
    posting("p4", "private", "u2", "fp1:a");
    expect(() => posting("p5", "private", "u1", "fp1:a")).toThrow("UNIQUE");
    expect(() => posting("p6", "private", null, "fp1:b")).toThrow("CHECK");
    expect(() =>
      sqlite
        .query(
          "INSERT INTO screening_answers (id, user_id, question_key, answer, answer_kind, sensitivity, auto_use, created_at, updated_at) VALUES ('a', 'u', 'gender', 'x', 'text', 'protected', 'always', 1, 1)"
        )
        .run()
    ).toThrow("CHECK");
    const task = (id: string, state: string) =>
      sqlite
        .query(
          "INSERT INTO automation_tasks (id, user_id, kind, application_id, state, not_before, expires_at, created_by, idempotency_key, created_at, updated_at) VALUES (?, 'u', 'apply', 'app1', ?, 1, 2, 'web', ?, 1, 1)"
        )
        .run(id, state, id);
    task("t1", "queued");
    expect(() => task("t2", "running")).toThrow("UNIQUE");
    task("t3", "failed");
  });
});
