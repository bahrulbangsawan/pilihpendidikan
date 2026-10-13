// Static isolation checks (04 §5, 11 §6.1, 11 §13):
//
// T11-JOBSDB  `JOBS_DB` is referenced only by src/jobs/repo/**, src/env.ts
//             and tests; outside repo/** the JOBS_DB helpers of
//             repo/core/db.ts may not be imported (only the opaque `JobsDb`
//             type, the error classes, `retryOnGuardFailure`, and — in the
//             kernel wiring files — `jobsDb` / `runBatch`).
// T11-SQL     every SQL statement in src/jobs/repo/** that touches a
//             user-scoped JOBS_DB table carries a `user_id` predicate (an
//             INSERT names the `user_id` column). Exceptions are explicit:
//             a `// sql-allow: system|public-posting|anonymous — why`
//             comment on the statement that holds the SQL.
//
// Sources are parsed with @babel/parser, so comments and string contents
// never produce false hits.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";
import { ROW_CODECS } from "./repo/core/db";

const SRC = join(import.meta.dir, "..");

interface AstNode {
  [key: string]: unknown;
  leadingComments?: Array<{ value: string }> | null;
  loc?: { start: { line: number } };
  type: string;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walkFiles(path, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "range",
]);

function visit(
  node: unknown,
  ancestors: AstNode[],
  fn: (node: AstNode, ancestors: AstNode[]) => void
): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      visit(child, ancestors, fn);
    }
    return;
  }
  if (
    !node ||
    typeof node !== "object" ||
    typeof (node as AstNode).type !== "string"
  ) {
    return;
  }
  const current = node as AstNode;
  fn(current, ancestors);
  ancestors.push(current);
  for (const [key, value] of Object.entries(current)) {
    if (!SKIP_KEYS.has(key)) {
      visit(value, ancestors, fn);
    }
  }
  ancestors.pop();
}

function parseSource(code: string): AstNode {
  return parse(code, {
    sourceType: "module",
    plugins: ["typescript"],
  }) as unknown as AstNode;
}

function literalText(node: AstNode): string | null {
  if (node.type === "StringLiteral") {
    return node.value as string;
  }
  if (node.type === "TemplateLiteral") {
    const quasis = node.quasis as Array<{
      value: { cooked: string | null; raw: string };
    }>;
    return quasis.map((q) => q.value.cooked ?? q.value.raw).join("__EXPR__");
  }
  return null;
}

// ---------------------------------------------------------------------------
// T11-SQL
// ---------------------------------------------------------------------------

/** User-scoped JOBS_DB tables: every table but the anonymous telemetry. */
const USER_SCOPED = new Set(
  Object.keys(ROW_CODECS).filter((t) => t !== "telemetry_daily")
);
const STATEMENT_RE = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
const TABLE_RE = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+|__EXPR__)/gi;
const PREDICATE_RE = /\b(?:owner_)?user_id\s*(?:=|IN\s*\(|IS\b)/i;
const INSERT_COLUMNS_RE =
  /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+\S+\s*\(([^)]*)\)/i;
const USER_ID_COLUMN_RE = /\buser_id\b/;
const ALLOW_RE = /sql-allow:\s*(system|public-posting|anonymous)\b/;

export interface SqlViolation {
  line: number;
  sql: string;
  tables: string[];
}

function hasAllowMarker(ancestors: AstNode[], node: AstNode): boolean {
  return [...ancestors, node].some((n) =>
    (n.leadingComments ?? []).some((c) => ALLOW_RE.test(c.value))
  );
}

function scopedTables(sql: string): string[] {
  const tables: string[] = [];
  for (const match of sql.matchAll(TABLE_RE)) {
    const table = match[1].toLowerCase();
    if (table === "__expr__" || USER_SCOPED.has(table)) {
      tables.push(table);
    }
  }
  return tables;
}

function statementIsScoped(sql: string): boolean {
  if (PREDICATE_RE.test(sql)) {
    return true;
  }
  const insert = INSERT_COLUMNS_RE.exec(sql);
  return insert !== null && USER_ID_COLUMN_RE.test(insert[1]);
}

/** SQL statements on user-scoped tables without a user_id predicate. */
export function lintSql(code: string): SqlViolation[] {
  const violations: SqlViolation[] = [];
  visit(parseSource(code), [], (node, ancestors) => {
    const sql = literalText(node);
    if (sql === null || !STATEMENT_RE.test(sql)) {
      return;
    }
    const tables = scopedTables(sql);
    if (
      tables.length === 0 ||
      statementIsScoped(sql) ||
      hasAllowMarker(ancestors, node)
    ) {
      return;
    }
    violations.push({
      line: node.loc?.start.line ?? 0,
      sql: sql.slice(0, 120),
      tables,
    });
  });
  return violations;
}

// ---------------------------------------------------------------------------
// T11-JOBSDB
// ---------------------------------------------------------------------------

const DB_MODULE_RE = /repo\/core\/db$/;
const ANYWHERE_ALLOWED = new Set([
  "JobsDb",
  "GuardFailedError",
  "UniqueViolationError",
  "retryOnGuardFailure",
]);
const WIRING_ALLOWED = new Set(["jobsDb", "runBatch"]);
const WIRING_FILES = new Set([
  "jobs/core/router.ts",
  "jobs/core/context.ts",
  "jobs/queue/consumer.ts",
  "jobs/cron/index.ts",
]);

export interface AccessViolation {
  line: number;
  what: string;
}

function referencedName(node: AstNode): string | null {
  if (node.type === "Identifier") {
    return node.name as string;
  }
  if (node.type === "StringLiteral") {
    return node.value as string;
  }
  return null;
}

function forbiddenImports(node: AstNode, file: string): string[] {
  const source = (node.source as { value: string }).value;
  if (!DB_MODULE_RE.test(source)) {
    return [];
  }
  const specifiers = node.specifiers as Array<{ imported?: { name: string } }>;
  return specifiers
    .map((specifier) => specifier.imported?.name ?? "*")
    .filter(
      (name) =>
        !(
          ANYWHERE_ALLOWED.has(name) ||
          (WIRING_FILES.has(file) && WIRING_ALLOWED.has(name))
        )
    )
    .map((name) => `imports ${name} from ${source}`);
}

/** `JOBS_DB` references and forbidden repo/core/db imports in one file. */
export function lintJobsDbAccess(
  code: string,
  file: string
): AccessViolation[] {
  const violations: AccessViolation[] = [];
  const inRepo = file.startsWith("jobs/repo/");
  const mayReference = inRepo || file === "env.ts";
  visit(parseSource(code), [], (node) => {
    const line = node.loc?.start.line ?? 0;
    if (!mayReference && referencedName(node) === "JOBS_DB") {
      violations.push({ line, what: "references JOBS_DB" });
    }
    if (node.type === "ImportDeclaration" && !inRepo) {
      for (const what of forbiddenImports(node, file)) {
        violations.push({ line, what });
      }
    }
  });
  return violations;
}

const sourceFiles = walkFiles(SRC)
  .map((path) => relative(SRC, path))
  .filter((file) => !file.endsWith(".test.ts"));

// The static scans read every source file; they get 60 s so a loaded
// full-suite run cannot time them out (bun test defaults to 5 s).
describe("T11-SQL user_id predicates in the repo layer (04 §5)", () => {
  it("T11-SQL every repo statement on a user-scoped table has a user_id predicate or an explicit allow marker", () => {
    const repoFiles = sourceFiles.filter((file) =>
      file.startsWith("jobs/repo/")
    );
    expect(repoFiles.length).toBeGreaterThan(0);
    const report: string[] = [];
    let statements = 0;
    for (const file of repoFiles) {
      const code = readFileSync(join(SRC, file), "utf8");
      statements += (code.match(/\b(SELECT|INSERT|UPDATE|DELETE)\b/g) ?? [])
        .length;
      for (const violation of lintSql(code)) {
        report.push(
          `${file}:${violation.line} [${violation.tables.join(",")}] ${violation.sql}`
        );
      }
    }
    expect(statements).toBeGreaterThan(20);
    expect(report).toEqual([]);
  }, 60_000);

  it("T11-SQL the lint catches missing predicates and honours markers", () => {
    const bad = `
      const a = "SELECT * FROM applications WHERE id = ?";
      const b = \`UPDATE automation_tasks SET state = 'x' WHERE id = \${id}\`;
      const c = "INSERT INTO change_log (entity, entity_id) VALUES (?, ?)";
      const d = \`SELECT * FROM \${table} WHERE id = ?\`;
      const e = "SELECT p.title FROM job_postings p WHERE p.id = ?";
    `;
    expect(lintSql(bad).map((v) => v.line)).toEqual([2, 3, 4, 5, 6]);
    const good = `
      const a = "SELECT * FROM applications WHERE id = ? AND user_id = ?";
      const b = "INSERT INTO change_log (user_id, entity) VALUES (?, ?)";
      const c = "SELECT p.title FROM job_postings p JOIN user_jobs u ON u.posting_id = p.id WHERE u.user_id = ?";
      const d = "SELECT 1 FROM job_postings WHERE owner_user_id = ? AND id = ?";
      // sql-allow: system — the cron reaper scans every user
      const e = "SELECT id FROM automation_tasks WHERE lease_expires_at <= ?";
      const f = "INSERT INTO telemetry_daily (day) VALUES (?)";
      const g = "SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_master) THEN 1 END";
      const h = "Select the application"; // prose, not SQL on a table
    `;
    expect(lintSql(good)).toEqual([]);
    // A marker with an unknown reason does not count.
    expect(
      lintSql(
        `// sql-allow: because\nconst x = "DELETE FROM files WHERE id = ?";`
      )
    ).toHaveLength(1);
  });
});

describe("T11-JOBSDB JOBS_DB is reached only through the repo layer (04 §5)", () => {
  it("T11-JOBSDB no source outside src/jobs/repo/** and env.ts touches JOBS_DB or the repo SQL helpers", () => {
    const report: string[] = [];
    for (const file of sourceFiles) {
      for (const violation of lintJobsDbAccess(
        readFileSync(join(SRC, file), "utf8"),
        file
      )) {
        report.push(`${file}:${violation.line} ${violation.what}`);
      }
    }
    expect(report).toEqual([]);
  }, 60_000);

  it("T11-JOBSDB the lint catches direct access and helper imports", () => {
    expect(
      lintJobsDbAccess(
        "export const x = (env) => env.JOBS_DB.prepare('x');",
        "jobs/services/applications/index.ts"
      )
    ).toHaveLength(1);
    expect(
      lintJobsDbAccess(
        'import { stmt } from "../../repo/core/db";',
        "jobs/services/applications/index.ts"
      )
    ).toHaveLength(1);
    expect(
      lintJobsDbAccess(
        'import { jobsDb } from "../repo/core/db";',
        "jobs/routes/meta/index.ts"
      )
    ).toHaveLength(1);
    expect(
      lintJobsDbAccess(
        'import type { JobsDb } from "../../repo/core/db";',
        "jobs/services/x/index.ts"
      )
    ).toEqual([]);
    expect(
      lintJobsDbAccess(
        'import { jobsDb, runBatch } from "../repo/core/db";',
        "jobs/core/router.ts"
      )
    ).toEqual([]);
    expect(
      lintJobsDbAccess(
        "// JOBS_DB is the jobs database\nconst y = 1;",
        "jobs/core/x.ts"
      )
    ).toEqual([]);
    expect(
      lintJobsDbAccess("const e = env.JOBS_DB;", "jobs/repo/core/x.ts")
    ).toEqual([]);
  });
});
