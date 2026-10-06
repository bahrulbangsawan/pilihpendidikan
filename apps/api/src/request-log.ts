// Append-only log of MCP tool calls in D1 `request_log`, one row per call,
// tagged with the tool family (cv | invoice | portfolio | jobs). Rows carry
// a retention deadline; the daily cron deletes expired ones.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type LogCategory = "cv" | "invoice" | "portfolio" | "jobs";

export const DEFAULT_LOG_RETENTION_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const PARAMS_MAX_LEN = 2000;
const RESOURCE_KEYS = [
  "cv_id",
  "invoice_id",
  "job_id",
  "portfolio_id",
] as const;

export interface LogEntry {
  ts: number;
  caller_email: string;
  tool: string;
  category: LogCategory;
  resource_id: string | null;
  status: "ok" | "error";
  duration_ms: number;
  params: string | null;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  let hex = "";
  for (const b of new Uint8Array(digest)) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function extractResourceId(
  args: Record<string, unknown> | undefined
): string | null {
  if (!args) {
    return null;
  }
  for (const key of RESOURCE_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function serializeParams(
  args: Record<string, unknown> | undefined
): string | null {
  if (!args) {
    return null;
  }
  try {
    const raw = JSON.stringify(args);
    return raw.length > PARAMS_MAX_LEN
      ? `${raw.slice(0, PARAMS_MAX_LEN)}…`
      : raw;
  } catch {
    return null;
  }
}

export function retentionDays(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_LOG_RETENTION_DAYS;
}

export async function insertLog(
  db: D1Database,
  entry: LogEntry,
  days = DEFAULT_LOG_RETENTION_DAYS
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO request_log (ts, caller_email, caller_email_hash, tool, category, resource_id, status, duration_ms, params, retention_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      entry.ts,
      entry.caller_email,
      (await sha256Hex(entry.caller_email)).slice(0, 16),
      entry.tool,
      entry.category,
      entry.resource_id,
      entry.status,
      entry.duration_ms,
      entry.params,
      entry.ts + days * MS_PER_DAY
    )
    .run();
}

export async function purgeExpiredLogs(db: D1Database): Promise<number> {
  const result = await db
    .prepare("DELETE FROM request_log WHERE retention_until < ?")
    .bind(Date.now())
    .run();
  return result.meta?.changes ?? 0;
}

export interface LoggerContext {
  db: D1Database | undefined;
  callerEmail: string | null;
  retentionDays?: number;
  fireAndForget: (promise: Promise<unknown>) => void;
}

// Call setCategory() before each register block: tools are tagged with the
// category current at registration time.
export interface ToolLoggerHandle {
  setCategory: (category: LogCategory) => void;
}

function isToolArguments(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Wraps server.registerTool() so every handler call is logged, including
// calls the ownership guard (installed after, so inside) turns away.
export function installToolLogger(
  server: McpServer,
  ctx: LoggerContext
): ToolLoggerHandle {
  let currentCategory: LogCategory = "cv";
  const original = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) => {
    const category = currentCategory;
    const wrapped = new Proxy(handler, {
      async apply(target, thisArg, args: unknown[]) {
        const toolArgs = isToolArguments(args[0]) ? args[0] : undefined;
        const startedAt = Date.now();
        let status: "ok" | "error" = "ok";
        try {
          return await Reflect.apply(target, thisArg, args);
        } catch (err) {
          status = "error";
          throw err;
        } finally {
          if (ctx.db && ctx.callerEmail) {
            const entry: LogEntry = {
              ts: startedAt,
              caller_email: ctx.callerEmail,
              tool: name,
              category,
              resource_id: extractResourceId(toolArgs),
              status,
              duration_ms: Date.now() - startedAt,
              params: serializeParams(toolArgs),
            };
            ctx.fireAndForget(
              insertLog(ctx.db, entry, ctx.retentionDays).catch(
                (writeErr: unknown) => {
                  console.error("request log write failed", { writeErr });
                }
              )
            );
          }
        }
      },
    });
    return original(name, config, wrapped);
  };
  return {
    setCategory(category) {
      currentCategory = category;
    },
  };
}
