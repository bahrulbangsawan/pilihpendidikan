// In-memory stand-ins for the Worker bindings, used by `bun test`.
//
// - D1 is real SQLite (bun:sqlite) with the real migrations applied, so the
//   SQL in auth.ts / request-log.ts / oauth runs exactly as written.
// - KV is a Map honoring `get(key, "json")`, metadata, prefix listing and
//   cursors.
// - EMAIL records every message so tests can follow the emailed link.

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Caller } from "../src/auth";
import type { Env } from "../src/env";
import { registerAllTools } from "../src/mcp-tools";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

interface KvEntry {
  value: string;
  metadata?: unknown;
}

export interface FakeKv {
  kv: KVNamespace;
  store: Map<string, KvEntry>;
}

export function createFakeKv(): FakeKv {
  const store = new Map<string, KvEntry>();
  const kv = {
    get(key: string, typeOrOptions?: unknown): Promise<unknown> {
      const entry = store.get(key);
      if (!entry) {
        return Promise.resolve(null);
      }
      const type =
        typeof typeOrOptions === "string"
          ? typeOrOptions
          : (typeOrOptions as { type?: string } | undefined)?.type;
      return Promise.resolve(
        type === "json" ? JSON.parse(entry.value) : entry.value
      );
    },
    put(
      key: string,
      value: string,
      options?: { metadata?: unknown }
    ): Promise<void> {
      store.set(key, { value, metadata: options?.metadata });
      return Promise.resolve();
    },
    delete(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
    list(options?: {
      prefix?: string;
      limit?: number;
      cursor?: string;
    }): Promise<unknown> {
      const prefix = options?.prefix ?? "";
      const limit = options?.limit ?? 1000;
      const start = options?.cursor ? Number(options.cursor) : 0;
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const page = all.slice(start, start + limit);
      const done = start + limit >= all.length;
      return Promise.resolve({
        keys: page.map((name) => ({
          name,
          metadata: store.get(name)?.metadata,
        })),
        list_complete: done,
        cursor: done ? undefined : String(start + limit),
        cacheStatus: null,
      });
    },
  };
  return { kv: kv as unknown as KVNamespace, store };
}

type SqlValue = string | number | null;

function toSql(values: unknown[]): SqlValue[] {
  return values.map((v) => {
    if (v === undefined) {
      return null;
    }
    if (typeof v === "boolean") {
      return v ? 1 : 0;
    }
    return v as SqlValue;
  });
}

export function createTestD1(): { d1: D1Database; sqlite: Database } {
  const sqlite = new Database(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (file.endsWith(".sql")) {
      sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
  }
  const prepare = (sql: string) => {
    let params: SqlValue[] = [];
    const statement = {
      bind(...values: unknown[]) {
        params = toSql(values);
        return statement;
      },
      first<T>(): Promise<T | null> {
        return Promise.resolve(
          (sqlite.query(sql).get(...params) as T | null) ?? null
        );
      },
      all<T>(): Promise<{ results: T[]; success: true; meta: object }> {
        return Promise.resolve({
          results: sqlite.query(sql).all(...params) as T[],
          success: true,
          meta: {},
        });
      },
      run(): Promise<{ success: true; meta: { changes: number } }> {
        const result = sqlite.query(sql).run(...params);
        return Promise.resolve({
          success: true,
          meta: { changes: result.changes },
        });
      },
    };
    return statement;
  };
  const d1 = {
    prepare,
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
      const results: unknown[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    },
  };
  return { d1: d1 as unknown as D1Database, sqlite };
}

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface TestEnv {
  env: Env;
  sqlite: Database;
  kv: Record<
    "AUTH_KV" | "CV_KV" | "INVOICE_KV" | "PORTFOLIO_KV" | "JOBS_KV",
    FakeKv
  >;
  sent: SentEmail[];
}

export function createTestEnv(overrides: Partial<Env> = {}): TestEnv {
  const { d1, sqlite } = createTestD1();
  const kv = {
    AUTH_KV: createFakeKv(),
    CV_KV: createFakeKv(),
    INVOICE_KV: createFakeKv(),
    PORTFOLIO_KV: createFakeKv(),
    JOBS_KV: createFakeKv(),
  };
  const sent: SentEmail[] = [];
  const email = {
    send(message: SentEmail) {
      sent.push(message);
      return Promise.resolve({ messageId: `test-${sent.length}` });
    },
  };
  const env: Env = {
    DB: d1,
    AUTH_KV: kv.AUTH_KV.kv,
    CV_KV: kv.CV_KV.kv,
    INVOICE_KV: kv.INVOICE_KV.kv,
    PORTFOLIO_KV: kv.PORTFOLIO_KV.kv,
    JOBS_KV: kv.JOBS_KV.kv,
    RATE_LIMIT_KV: createFakeKv().kv,
    MCP_OBJECT: {} as DurableObjectNamespace,
    EMAIL: email as unknown as SendEmail,
    ADMIN_EMAILS: "admin@example.com",
    EMAIL_FROM: "noreply@pilihpendidikan.com",
    ...overrides,
  };
  return { env, sqlite, kv, sent };
}

// ExecutionContext whose waitUntil promises can be awaited by the test.
export function createCtx(): ExecutionContext & { drain: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {
      // not used
    },
    props: {},
    async drain() {
      while (pending.length > 0) {
        await Promise.allSettled(pending.splice(0));
      }
    },
  } as unknown as ExecutionContext & { drain: () => Promise<void> };
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

type ToolHandler = (
  args: Record<string, unknown>,
  extra: unknown
) => Promise<ToolResult>;

export interface RecordedTool {
  name: string;
  config: { description?: string; annotations?: { readOnlyHint?: boolean } };
  handler: ToolHandler;
}

// Minimal McpServer double: records registerTool() calls and exposes the
// low-level request-handler map installToolAliases() patches.
export function createRecordingServer() {
  const tools = new Map<string, RecordedTool>();
  const calls: Array<{ name: string | undefined }> = [];
  const requestHandlers = new Map<
    string,
    (request: unknown, extra: unknown) => unknown
  >();
  requestHandlers.set("tools/call", (request: unknown) => {
    const name = (request as { params?: { name?: string } }).params?.name;
    calls.push({ name });
    return { routedTo: name };
  });
  const server = {
    registerTool(
      name: string,
      config: RecordedTool["config"],
      handler: ToolHandler
    ) {
      tools.set(name, { name, config, handler });
      return {};
    },
    server: { _requestHandlers: requestHandlers },
  };
  return {
    server: server as unknown as McpServer,
    tools,
    calls,
    requestHandlers,
  };
}

export function textOf(result: ToolResult): string {
  return result.content[0]?.text ?? "";
}

// One MCP session for `caller`, wired exactly like the Durable Object does
// (scope filter → logger → ownership guard → handler).
export function createToolSession(env: Env, caller: Caller | null) {
  const recording = createRecordingServer();
  const pending: Promise<unknown>[] = [];
  const aliasesInstalled = registerAllTools(recording.server, env, caller, {
    fireAndForget: (promise) => pending.push(promise),
  });
  return {
    ...recording,
    aliasesInstalled,
    async call(
      name: string,
      args: Record<string, unknown> = {}
    ): Promise<ToolResult> {
      const tool = recording.tools.get(name);
      if (!tool) {
        throw new Error(`tool "${name}" not registered`);
      }
      const result = await tool.handler(args, {});
      await Promise.all(pending.splice(0));
      return result;
    },
  };
}

export function jsonOf<T = Record<string, unknown>>(result: ToolResult): T {
  return JSON.parse(textOf(result)) as T;
}
