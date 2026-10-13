import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, run } from "../../../../scripts/analytics-rebuild";
import { dailyRows, Story } from "./support.test";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A";
const MIGRATIONS = join(import.meta.dir, "../../../../migrations-jobs");

function localDb(): string {
  const path = join(
    mkdtempSync(join(tmpdir(), "pj-analytics-")),
    "jobs.sqlite"
  );
  const sqlite = new Database(path);
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (file.endsWith(".sql")) {
      sqlite.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    }
  }
  new Story(sqlite, USER, { createdAt: Date.UTC(2026, 8, 1, 9) }).to(
    "applied",
    Date.UTC(2026, 8, 2, 9)
  );
  sqlite.close();
  return path;
}

describe("analytics:rebuild script (10 §4)", () => {
  it("is a dry run unless --execute, refuses --remote and needs --user", async () => {
    expect(() => parseArgs(["--user", USER, "--remote"])).toThrow("remote");
    expect(() => parseArgs([])).toThrow("--user");
    expect(parseArgs(["--user", USER]).execute).toBe(false);
    const path = localDb();
    const lines: string[] = [];
    const dry = await run(
      { ...parseArgs(["--user", USER]), db: path },
      (line) => lines.push(line)
    );
    expect(dry).toEqual({ days: 2, executed: false });
    expect(lines.join("\n")).toContain("Dry run: 2 day(s)");
    const check = new Database(path);
    expect(dailyRows(check, USER)).toEqual({});
    check.close();
    const done = await run(
      { ...parseArgs(["--user", USER, "--execute"]), db: path },
      () => undefined
    );
    expect(done).toEqual({ days: 2, executed: true });
    const after = new Database(path);
    expect(dailyRows(after, USER)).toMatchObject({
      "2026-09-01": { tracked: 1 },
      "2026-09-02": { applied: 1 },
    });
    after.close();
  });
});
