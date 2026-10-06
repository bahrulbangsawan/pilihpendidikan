import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlStore } from "./cloudflare";
import { migrateTokens } from "./migrate-tokens";

const WRITE_RE = /^\s*(insert|update|delete|replace|create|drop|alter)/i;

// The old backend's token table (after its hash + session migrations) and
// its admin allowlist, which the script reads from the source database.
const OLD_SCHEMA = `
CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY, user_email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  label TEXT, status TEXT NOT NULL DEFAULT 'active', kind TEXT NOT NULL DEFAULT 'personal',
  created_at INTEGER NOT NULL, revoked_at INTEGER, last_used_at INTEGER
);
CREATE TABLE admin_grant (email TEXT PRIMARY KEY, revoked_at INTEGER);`;

interface FakeSql extends SqlStore {
  db: Database;
  writes: string[];
}

function sqlStore(db: Database): FakeSql {
  const writes: string[] = [];
  return {
    db,
    writes,
    query<T>(sql: string, params: unknown[] = []) {
      if (WRITE_RE.test(sql)) {
        writes.push(sql);
      }
      return Promise.resolve(
        db.query(sql).all(...(params as Array<string | number | null>)) as T[]
      );
    },
    run(sql: string, params: unknown[] = []) {
      if (WRITE_RE.test(sql)) {
        writes.push(sql);
      }
      db.query(sql).run(...(params as Array<string | number | null>));
      return Promise.resolve();
    },
  };
}

function oldDatabase(): FakeSql {
  const db = new Database(":memory:");
  db.exec(OLD_SCHEMA);
  const insert = db.query(
    "INSERT INTO mcp_tokens (id, user_email, token_hash, label, status, kind, created_at, revoked_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insert.run(
    "t1",
    "Alice@Example.com",
    "h1",
    "Laptop",
    "active",
    "personal",
    1,
    null,
    5
  );
  insert.run(
    "t2",
    "bob@example.com",
    "h2",
    null,
    "active",
    "personal",
    2,
    null,
    null
  );
  insert.run(
    "t3",
    "bob@example.com",
    "h3",
    null,
    "revoked",
    "personal",
    3,
    4,
    null
  );
  insert.run(
    "t4",
    "bob@example.com",
    "h4",
    "sess",
    "active",
    "session",
    4,
    null,
    null
  );
  insert.run(
    "t5",
    "owner@site.example",
    "h5",
    null,
    "active",
    "personal",
    5,
    null,
    null
  );
  insert.run(
    "t6",
    "carol@example.com",
    "h6",
    null,
    "active",
    "personal",
    6,
    null,
    null
  );
  db.query("INSERT INTO admin_grant (email, revoked_at) VALUES (?, ?)").run(
    "owner@site.example",
    null
  );
  return sqlStore(db);
}

function newDatabase(): FakeSql {
  const db = new Database(":memory:");
  db.exec(
    readFileSync(
      join(import.meta.dir, "..", "migrations", "0001_initial.sql"),
      "utf8"
    )
  );
  return sqlStore(db);
}

function hashes(store: FakeSql): string[] {
  return (
    store.db
      .query("SELECT token_hash FROM mcp_tokens ORDER BY token_hash")
      .all() as Array<{
      token_hash: string;
    }>
  ).map((r) => r.token_hash);
}

describe("migrate-tokens", () => {
  it("dry run reports candidates and writes nothing", async () => {
    const source = oldDatabase();
    const dest = newDatabase();
    const report = await migrateTokens({
      source,
      dest,
      execute: false,
      excludeEmails: ["carol@example.com"],
    });
    expect(report.mode).toBe("dry-run");
    // t1 + t2 qualify; t3 revoked, t4 session, t5 admin, t6 excluded.
    expect(report.candidates).toBe(2);
    expect(report.skippedAdmins).toBe(2);
    expect(report.users).toBe(2);
    expect(report.inserted).toBe(0);
    expect(dest.writes).toEqual([]);
    expect(source.writes).toEqual([]);
    expect(hashes(dest)).toEqual([]);
  });

  it("--execute copies non-admin personal tokens as write scope and verifies", async () => {
    const source = oldDatabase();
    const dest = newDatabase();
    const report = await migrateTokens({ source, dest, execute: true });
    expect(report.inserted).toBe(3);
    expect(report.verified).toBe(3);
    expect(report.missing).toEqual([]);
    expect(hashes(dest)).toEqual(["h1", "h2", "h6"]);
    const alice = dest.db
      .query("SELECT * FROM mcp_tokens WHERE token_hash = 'h1'")
      .get() as Record<string, unknown>;
    expect(alice).toMatchObject({
      user_email: "alice@example.com",
      kind: "personal",
      scope: "write",
      status: "active",
      label: "Laptop",
      expires_at: null,
    });
    expect(source.writes).toEqual([]);
  });

  it("is idempotent", async () => {
    const source = oldDatabase();
    const dest = newDatabase();
    await migrateTokens({ source, dest, execute: true });
    const again = await migrateTokens({ source, dest, execute: true });
    expect(again.alreadyPresent).toBe(3);
    expect(again.inserted).toBe(0);
    expect(hashes(dest)).toEqual(["h1", "h2", "h6"]);
  });
});
