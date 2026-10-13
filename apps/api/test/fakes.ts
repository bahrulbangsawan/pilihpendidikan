// In-memory stand-ins for the Worker bindings, used by `bun test`.
//
// - D1 is real SQLite (bun:sqlite) with the real migrations applied: `DB`
//   gets `migrations/`, `JOBS_DB` gets `migrations-jobs/`, so the SQL in the
//   repo layer, auth.ts, request-log.ts and oauth runs exactly as written.
//   Statements are immutable (`bind` returns a new one, like D1); `batch()`
//   is TRANSACTIONAL (BEGIN / COMMIT, ROLLBACK on the first error) and
//   returns `results` rows for RETURNING statements; `run()` / `all()` report
//   `meta.changes`.
// - KV is a Map honoring `get(key, "json")`, metadata, prefix listing and
//   cursors.
// - R2 (`JOBS_FILES`) keeps objects in memory, verifies a declared `sha256`
//   on `put` (R2 rejects mismatches), and supports get (incl. ranges), head,
//   delete and list (prefix, cursor, delimiter).
// - The `jobs-ai` Queue records every `send` / `sendBatch`; `drain()` runs the
//   real consumer (src/jobs/queue/consumer.ts) until the queue is empty,
//   re-delivering retried messages and moving exhausted ones to the DLQ.
// - EMAIL records every message so tests can follow the emailed link.
// - `createFakeClock()` + `createV1Client(t, {clock})` drive /api/v1 routes
//   through `createApp(...)` as a browser session, a personal token, an MCP
//   OAuth token or a CLI OAuth token bound to a registered device.

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FeatureFlagKey } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { JobsAiMessage } from "@pilihpendidikan/jobs-contracts/queue";
import { createApp } from "../src/app";
import type { Caller } from "../src/auth";
import { createToken, randomSecret } from "../src/auth";
import type { Env } from "../src/env";
import type { Clock } from "../src/jobs/core/clock";
import type { KernelDeps } from "../src/jobs/core/deps";
import { FLAG_DEFAULTS, setFeatureFlag } from "../src/jobs/core/flags";
import type { UserScope } from "../src/jobs/core/scope";
import { trustedScope } from "../src/jobs/core/scope";
import { CLI_BASE_SCOPES, formatScopeList } from "../src/jobs/core/scopes";
import { CLIENT_HEADER } from "../src/jobs/core/version";
import {
  handleJobsAiBatch,
  JOBS_AI_DLQ,
  JOBS_AI_QUEUE,
} from "../src/jobs/queue/consumer";
import type { ConsumerOverrides } from "../src/jobs/queue/consumer";
import { ensureUser } from "../src/jobs/repo/core/users";
import { registerAllTools } from "../src/mcp-tools";
import type { McpHandler } from "../src/routes/mcp";
import { createBrowserSession } from "../src/session";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");
const JOBS_MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations-jobs");

// ---------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// D1 over bun:sqlite
// ---------------------------------------------------------------------------

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

interface Execution {
  changes: number;
  lastRowId: number;
  rows: Record<string, unknown>[];
}

function totalChanges(sqlite: Database): number {
  return (sqlite.query("SELECT total_changes() AS n").get() as { n: number }).n;
}

function execute(sqlite: Database, sql: string, params: SqlValue[]): Execution {
  const before = totalChanges(sqlite);
  const rows = sqlite.query(sql).all(...params) as Record<string, unknown>[];
  const changes = totalChanges(sqlite) - before;
  const lastRowId = (
    sqlite.query("SELECT last_insert_rowid() AS id").get() as { id: number }
  ).id;
  return { rows, changes, lastRowId };
}

function resultOf(execution: Execution) {
  return {
    results: execution.rows,
    success: true as const,
    meta: {
      changes: execution.changes,
      last_row_id: execution.lastRowId,
      changed_db: execution.changes > 0,
      duration: 0,
      rows_read: execution.rows.length,
      rows_written: execution.changes,
      size_after: 0,
    },
  };
}

class FakeStatement {
  readonly params: SqlValue[];
  readonly sql: string;
  readonly #sqlite: Database;

  constructor(sqlite: Database, sql: string, params: SqlValue[] = []) {
    this.#sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]): FakeStatement {
    return new FakeStatement(this.#sqlite, this.sql, toSql(values));
  }

  executeSync(): Execution {
    return execute(this.#sqlite, this.sql, this.params);
  }

  first<T>(column?: string): Promise<T | null> {
    const row = this.executeSync().rows[0] ?? null;
    if (row === null) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      (column === undefined ? row : (row[column] ?? null)) as T | null
    );
  }

  all<T>() {
    return Promise.resolve(
      resultOf(this.executeSync()) as unknown as D1Result<T>
    );
  }

  run<T>() {
    return Promise.resolve(
      resultOf(this.executeSync()) as unknown as D1Result<T>
    );
  }

  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const rows = this.executeSync().rows;
    const values = rows.map((row) => Object.values(row)) as T[];
    if (options?.columnNames) {
      const names = rows[0] ? Object.keys(rows[0]) : [];
      return Promise.resolve([names as T, ...values]);
    }
    return Promise.resolve(values);
  }
}

/** A D1Database over an in-memory SQLite with the `.sql` files of `dir`. */
export function createSqliteD1(dir: string): {
  d1: D1Database;
  sqlite: Database;
} {
  const sqlite = new Database(":memory:");
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith(".sql")) {
      sqlite.exec(readFileSync(join(dir, file), "utf8"));
    }
  }
  const d1 = {
    prepare(sql: string) {
      return new FakeStatement(sqlite, sql);
    },
    // D1 batches are SQL transactions: all statements commit or none do.
    batch(statements: FakeStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) =>
          resultOf(statement.executeSync())
        );
        sqlite.exec("COMMIT");
        return Promise.resolve(results);
      } catch (err) {
        sqlite.exec("ROLLBACK");
        return Promise.reject(err);
      }
    },
    exec(sql: string) {
      sqlite.exec(sql);
      return Promise.resolve({ count: 1, duration: 0 });
    },
    withSession() {
      return d1;
    },
  };
  return { d1: d1 as unknown as D1Database, sqlite };
}

/** The identity database `DB` (migrations/ applied). */
export function createTestD1(): { d1: D1Database; sqlite: Database } {
  return createSqliteD1(MIGRATIONS_DIR);
}

/** The Job Tracker database `JOBS_DB` (migrations-jobs/ applied). */
export function createTestJobsD1(): { d1: D1Database; sqlite: Database } {
  return createSqliteD1(JOBS_MIGRATIONS_DIR);
}

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

interface StoredR2Object {
  body: Uint8Array;
  customMetadata: Record<string, string>;
  etag: string;
  httpMetadata: R2HTTPMetadata;
  key: string;
  sha256: string;
  uploaded: Date;
  version: string;
}

export interface FakeR2 {
  bucket: R2Bucket;
  objects: Map<string, StoredR2Object>;
}

function hex(bytes: ArrayBuffer | ArrayBufferView): string {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = "";
  for (const byte of view) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

function fromHex(value: string): ArrayBuffer {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}

async function bytesOf(value: unknown): Promise<Uint8Array> {
  if (value === null || value === undefined) {
    return new Uint8Array();
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (value instanceof ReadableStream) {
    return new Uint8Array(await new Response(value).arrayBuffer());
  }
  throw new TypeError("unsupported R2 body");
}

function r2Object(stored: StoredR2Object, range?: R2Range): R2Object {
  return {
    key: stored.key,
    version: stored.version,
    size: stored.body.byteLength,
    etag: stored.etag,
    httpEtag: `"${stored.etag}"`,
    uploaded: stored.uploaded,
    httpMetadata: stored.httpMetadata,
    customMetadata: stored.customMetadata,
    checksums: {
      sha256: fromHex(stored.sha256),
      toJSON: () => ({ sha256: stored.sha256 }),
    },
    storageClass: "Standard",
    range,
    writeHttpMetadata(headers: Headers) {
      if (stored.httpMetadata.contentType) {
        headers.set("Content-Type", stored.httpMetadata.contentType);
      }
      if (stored.httpMetadata.contentDisposition) {
        headers.set(
          "Content-Disposition",
          stored.httpMetadata.contentDisposition
        );
      }
    },
  } as unknown as R2Object;
}

function sliceFor(size: number, range: R2Range | undefined): [number, number] {
  if (!range) {
    return [0, size];
  }
  if ("suffix" in range && range.suffix !== undefined) {
    return [Math.max(0, size - range.suffix), size];
  }
  const offset = "offset" in range ? (range.offset ?? 0) : 0;
  const length =
    "length" in range ? (range.length ?? size - offset) : size - offset;
  return [offset, Math.min(size, offset + length)];
}

export function createFakeR2(): FakeR2 {
  const objects = new Map<string, StoredR2Object>();
  const bucket = {
    async put(
      key: string,
      value: unknown,
      options: R2PutOptions = {}
    ): Promise<R2Object> {
      const body = await bytesOf(value);
      const sha256 = hex(await crypto.subtle.digest("SHA-256", body));
      const declared = options.sha256;
      if (declared !== undefined) {
        const expected =
          typeof declared === "string" ? declared.toLowerCase() : hex(declared);
        if (expected !== sha256) {
          throw new Error(
            "put: The SHA-256 checksum you specified did not match what we received. (10037)"
          );
        }
      }
      const md5ish = sha256.slice(0, 32);
      const stored: StoredR2Object = {
        key,
        body,
        sha256,
        etag: md5ish,
        version: crypto.randomUUID(),
        uploaded: new Date(),
        httpMetadata:
          options.httpMetadata instanceof Headers
            ? {
                contentType:
                  options.httpMetadata.get("Content-Type") ?? undefined,
              }
            : { ...(options.httpMetadata ?? {}) },
        customMetadata: { ...(options.customMetadata ?? {}) },
      };
      objects.set(key, stored);
      return r2Object(stored);
    },
    get(key: string, options: R2GetOptions = {}): Promise<R2ObjectBody | null> {
      const stored = objects.get(key);
      if (!stored) {
        return Promise.resolve(null);
      }
      const range =
        options.range instanceof Headers ? undefined : options.range;
      const [start, end] = sliceFor(stored.body.byteLength, range);
      const bytes = stored.body.slice(start, end);
      let used = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      const consume = () => {
        used = true;
        return bytes;
      };
      return Promise.resolve({
        ...r2Object(stored, range),
        body,
        get bodyUsed() {
          return used;
        },
        arrayBuffer: () => Promise.resolve(consume().slice().buffer),
        bytes: () => Promise.resolve(consume().slice()),
        text: () => Promise.resolve(new TextDecoder().decode(consume())),
        json: () =>
          Promise.resolve(JSON.parse(new TextDecoder().decode(consume()))),
        blob: () => Promise.resolve(new Blob([consume().slice()])),
      } as unknown as R2ObjectBody);
    },
    head(key: string): Promise<R2Object | null> {
      const stored = objects.get(key);
      return Promise.resolve(stored ? r2Object(stored) : null);
    },
    delete(keys: string | string[]): Promise<void> {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        objects.delete(key);
      }
      return Promise.resolve();
    },
    list(options: R2ListOptions = {}): Promise<R2Objects> {
      const prefix = options.prefix ?? "";
      const limit = options.limit ?? 1000;
      const start = options.cursor ? Number(options.cursor) : 0;
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort();
      const prefixes = new Set<string>();
      const matching: string[] = [];
      for (const key of keys) {
        if (options.delimiter) {
          const rest = key.slice(prefix.length);
          const cut = rest.indexOf(options.delimiter);
          if (cut !== -1) {
            prefixes.add(
              prefix + rest.slice(0, cut + options.delimiter.length)
            );
            continue;
          }
        }
        matching.push(key);
      }
      const page = matching.slice(start, start + limit);
      const truncated = start + limit < matching.length;
      return Promise.resolve({
        objects: page.map((key) =>
          r2Object(objects.get(key) as StoredR2Object)
        ),
        truncated,
        cursor: truncated ? String(start + limit) : undefined,
        delimitedPrefixes: [...prefixes],
      } as R2Objects);
    },
    createMultipartUpload(): never {
      throw new Error("multipart uploads are not used (14 §5.4)");
    },
    resumeMultipartUpload(): never {
      throw new Error("multipart uploads are not used (14 §5.4)");
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface RecordedMessage {
  attempts: number;
  body: JobsAiMessage;
  delaySeconds?: number;
  id: string;
}

export interface DrainReport {
  acked: number;
  /** Messages handed to the DLQ consumer. */
  deadLettered: number;
  delivered: number;
  /** DLQ messages that failed their own retries. */
  dropped: number;
  retried: number;
}

export interface DrainOptions {
  ctx?: ExecutionContext & { drain?: () => Promise<void> };
  deps?: KernelDeps;
  /** Rounds before giving up (a handler that always retries). */
  maxRounds?: number;
  overrides?: ConsumerOverrides;
}

export interface FakeQueue {
  /** Messages waiting for the consumer. */
  readonly pending: RecordedMessage[];
  queue: Queue<JobsAiMessage>;
  /** Every message ever sent, in order. */
  readonly sent: RecordedMessage[];
  /** Messages the consumer asked to retry (with their delay). */
  readonly retries: Array<{ delaySeconds?: number; id: string }>;
  /** Runs the consumer until both queues are empty. */
  drain(env: Env, options?: DrainOptions): Promise<DrainReport>;
}

const BATCH_SIZE = 10;
const MAX_RETRIES = 5;
const DLQ_MAX_RETRIES = 1;
const SEND_BATCH_LIMIT = 100;
const MESSAGE_LIMIT_BYTES = 128 * 1024;

interface Outcome {
  delaySeconds?: number;
  kind: "ack" | "retry" | "none";
}

export function createFakeQueue(): FakeQueue {
  const sent: RecordedMessage[] = [];
  const pending: RecordedMessage[] = [];
  const deadLetters: RecordedMessage[] = [];
  const retries: Array<{ delaySeconds?: number; id: string }> = [];
  const enqueue = (body: JobsAiMessage, delaySeconds?: number) => {
    const text = JSON.stringify(body);
    if (new TextEncoder().encode(text).byteLength > MESSAGE_LIMIT_BYTES) {
      throw new Error("Queue message exceeds 128 KB");
    }
    const message: RecordedMessage = {
      id: crypto.randomUUID(),
      body: JSON.parse(text) as JobsAiMessage,
      attempts: 1,
      delaySeconds,
    };
    sent.push(message);
    pending.push(message);
  };
  // Async like the binding: limit violations reject instead of throwing.
  const queue = {
    async send(body: JobsAiMessage, options?: { delaySeconds?: number }) {
      await Promise.resolve();
      enqueue(body, options?.delaySeconds);
    },
    async sendBatch(
      messages: Iterable<{ body: JobsAiMessage; delaySeconds?: number }>
    ) {
      await Promise.resolve();
      const list = [...messages];
      if (list.length > SEND_BATCH_LIMIT) {
        throw new Error(`sendBatch takes at most ${SEND_BATCH_LIMIT} messages`);
      }
      for (const message of list) {
        enqueue(message.body, message.delaySeconds);
      }
    },
  };

  async function deliver(
    env: Env,
    queueName: string,
    messages: RecordedMessage[],
    options: DrainOptions
  ): Promise<Map<string, Outcome>> {
    const outcomes = new Map<string, Outcome>(
      messages.map((m) => [m.id, { kind: "none" }])
    );
    const batch = {
      queue: queueName,
      messages: messages.map((m) => ({
        id: m.id,
        timestamp: new Date(),
        body: m.body,
        attempts: m.attempts,
        ack: () => outcomes.set(m.id, { kind: "ack" }),
        retry: (opts?: { delaySeconds?: number }) =>
          outcomes.set(m.id, {
            kind: "retry",
            delaySeconds: opts?.delaySeconds,
          }),
      })),
      ackAll: () => {
        for (const m of messages) {
          outcomes.set(m.id, { kind: "ack" });
        }
      },
      retryAll: () => {
        for (const m of messages) {
          outcomes.set(m.id, { kind: "retry" });
        }
      },
    } as unknown as MessageBatch<unknown>;
    const ctx = options.ctx ?? createCtx();
    try {
      await handleJobsAiBatch(batch, env, ctx, options.deps, options.overrides);
    } catch {
      // A throwing consumer retries the whole batch (Workers semantics).
      for (const m of messages) {
        if (outcomes.get(m.id)?.kind === "none") {
          outcomes.set(m.id, { kind: "retry" });
        }
      }
    }
    await (ctx as { drain?: () => Promise<void> }).drain?.();
    return outcomes;
  }

  // Workers semantics: a retried message is redelivered until it has been
  // retried `max_retries` times, then moves to the DLQ (main queue) or is
  // dropped (DLQ). Anything not retried counts as acked.
  function settle(
    message: RecordedMessage,
    outcome: Outcome,
    fromMain: boolean,
    totals: DrainReport
  ): void {
    totals.delivered += 1;
    if (outcome.kind !== "retry") {
      totals.acked += 1;
      return;
    }
    totals.retried += 1;
    retries.push({ id: message.id, delaySeconds: outcome.delaySeconds });
    const limit = fromMain ? MAX_RETRIES : DLQ_MAX_RETRIES;
    if (message.attempts <= limit) {
      (fromMain ? pending : deadLetters).push({
        ...message,
        attempts: message.attempts + 1,
      });
    } else if (fromMain) {
      totals.deadLettered += 1;
      deadLetters.push({ ...message, attempts: 1 });
    } else {
      totals.dropped += 1;
    }
  }

  return {
    queue: queue as unknown as Queue<JobsAiMessage>,
    sent,
    pending,
    retries,
    async drain(env: Env, options: DrainOptions = {}): Promise<DrainReport> {
      const totals: DrainReport = {
        delivered: 0,
        acked: 0,
        retried: 0,
        deadLettered: 0,
        dropped: 0,
      };
      const maxRounds = options.maxRounds ?? 50;
      for (let round = 0; round < maxRounds; round++) {
        const fromMain = pending.length > 0;
        const source = fromMain ? pending : deadLetters;
        if (source.length === 0) {
          return totals;
        }
        const batch = source.splice(0, BATCH_SIZE);
        const outcomes = await deliver(
          env,
          fromMain ? JOBS_AI_QUEUE : JOBS_AI_DLQ,
          batch,
          options
        );
        for (const message of batch) {
          settle(
            message,
            outcomes.get(message.id) as Outcome,
            fromMain,
            totals
          );
        }
      }
      throw new Error(`queue did not drain within ${maxRounds} rounds`);
    },
  };
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export interface FakeClock extends Clock {
  advance(ms: number): number;
  set(ms: number): number;
}

/** 2026-10-12T00:00:00Z unless told otherwise. */
export const FAKE_CLOCK_START = Date.UTC(2026, 9, 12);

export function createFakeClock(start: number = FAKE_CLOCK_START): FakeClock {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
      return current;
    },
    set(ms: number) {
      current = ms;
      return current;
    },
  };
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface TestEnvOptions {
  /** Flag values written over the migration's dark defaults. */
  flags?: Partial<Record<FeatureFlagKey, boolean | "kv" | "d1">>;
}

export interface TestEnv {
  env: Env;
  /** SQLite behind `DB`. */
  sqlite: Database;
  /** SQLite behind `JOBS_DB`. */
  jobsSqlite: Database;
  kv: Record<
    "AUTH_KV" | "CV_KV" | "INVOICE_KV" | "PORTFOLIO_KV" | "JOBS_KV",
    FakeKv
  >;
  r2: FakeR2;
  queue: FakeQueue;
  sent: SentEmail[];
  /** Writes a feature flag and drops the flag cache. */
  setFlag(key: FeatureFlagKey, value: boolean | "kv" | "d1"): Promise<void>;
}

// The test env turns the Job Tracker on (PLAN C1); everything else keeps the
// migration's dark defaults unless a test says otherwise.
const TEST_FLAGS: Partial<Record<FeatureFlagKey, boolean | "kv" | "d1">> = {
  JOBS_V1_ENABLED: true,
};

export function createTestEnv(
  overrides: Partial<Env> = {},
  options: TestEnvOptions = {}
): TestEnv {
  const { d1, sqlite } = createTestD1();
  const jobs = createTestJobsD1();
  const kv = {
    AUTH_KV: createFakeKv(),
    CV_KV: createFakeKv(),
    INVOICE_KV: createFakeKv(),
    PORTFOLIO_KV: createFakeKv(),
    JOBS_KV: createFakeKv(),
  };
  const r2 = createFakeR2();
  const queue = createFakeQueue();
  const sent: SentEmail[] = [];
  const email = {
    send(message: SentEmail) {
      sent.push(message);
      return Promise.resolve({ messageId: `test-${sent.length}` });
    },
  };
  const flags = { ...TEST_FLAGS, ...options.flags };
  for (const [key, value] of Object.entries(flags)) {
    sqlite
      .query(
        "INSERT INTO feature_flags (key, value, updated_at, updated_by) VALUES (?, ?, 0, 'test') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, JSON.stringify(value));
  }
  const env: Env = {
    DB: d1,
    JOBS_DB: jobs.d1,
    JOBS_FILES: r2.bucket,
    JOBS_AI_QUEUE: queue.queue,
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
    JOBS_MIN_CLI_VERSION: "0.1.0",
    JOBS_RECOMMENDED_CLI_VERSION: "0.1.0",
    JOBS_AI_MODE: "fake",
    JOBS_AI_MONTHLY_BUDGET_USD: "3.00",
    JOBS_APP_ORIGIN: "http://localhost:4007",
    ...overrides,
  };
  return {
    env,
    sqlite,
    jobsSqlite: jobs.sqlite,
    kv,
    r2,
    queue,
    sent,
    setFlag: (key, value) => setFeatureFlag(env, key, value, "test"),
  };
}

/** The flag defaults the migrations seed (for assertions). */
export const DARK_FLAG_DEFAULTS = FLAG_DEFAULTS;

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

// ---------------------------------------------------------------------------
// /api/v1 client
// ---------------------------------------------------------------------------

export const TEST_API_ORIGIN = "https://api.pilihpendidikan.com";

export interface V1Response<T = unknown> {
  /** Parsed JSON body (null for empty / non-JSON bodies). */
  body: T;
  headers: Headers;
  response: Response;
  status: number;
  text: string;
}

export interface V1CallOptions {
  /** JSON body (serialized with Content-Type: application/json). */
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** A raw body sent as is (multipart, binary, malformed JSON). */
  rawBody?: BodyInit;
}

export interface V1Session {
  bearer: string | null;
  /** Default headers of every call (e.g. X-Pilih-Client for the CLI). */
  readonly headers: Record<string, string>;
  deviceId: string | null;
  email: string | null;
  grantId: string | null;
  /** A UserScope for calling repo functions directly in tests. */
  scope: UserScope | null;
  tokenId: string | null;
  userId: string | null;
  call<T = Record<string, unknown>>(
    method: string,
    path: string,
    options?: V1CallOptions
  ): Promise<V1Response<T>>;
  delete<T = Record<string, unknown>>(
    path: string,
    options?: V1CallOptions
  ): Promise<V1Response<T>>;
  get<T = Record<string, unknown>>(
    path: string,
    options?: V1CallOptions
  ): Promise<V1Response<T>>;
  patch<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    options?: V1CallOptions
  ): Promise<V1Response<T>>;
  post<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    options?: V1CallOptions
  ): Promise<V1Response<T>>;
  put<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    options?: V1CallOptions
  ): Promise<V1Response<T>>;
}

export interface CliSessionOptions {
  /** CLI version sent as `X-Pilih-Client: cli/<v>`; null sends no header. */
  cliVersion?: string | null;
  /** Register a device (default) or not (`false`, 17 §6 step 5). */
  device?:
    | false
    | {
        acceptsTasks?: boolean;
        capabilities?: string[];
        name?: string;
        platform?: "macos" | "windows" | "linux";
      };
  /** Granted scopes (default: the 17 §5.1 base set). */
  scopes?: readonly string[];
}

export interface V1Client {
  app: ReturnType<typeof createApp>;
  /** No credentials at all. */
  anonymous(): V1Session;
  /** A browser-session bearer (what the apps/jobs BFF holds). */
  browserSession(email: string): Promise<V1Session>;
  /** A `pilih-jobs-cli` OAuth access token, device-bound by default. */
  cliSession(email: string, options?: CliSessionOptions): Promise<V1Session>;
  clock: Clock;
  env: Env;
  /** Sends any request through the Worker's fetch handler. */
  fetch(request: Request): Promise<Response>;
  /** An MCP OAuth (DCR client) access token. */
  mcpOAuthToken(email: string): Promise<V1Session>;
  /** A `/connect` personal token. */
  personalToken(email: string, scope?: "write" | "read"): Promise<V1Session>;
}

const noMcp: McpHandler = {
  fetch: () => new Response("MCP is not wired in v1 tests", { status: 404 }),
};

export interface V1ClientOptions {
  ai?: KernelDeps["ai"];
  clock?: Clock;
}

function buildV1Request(
  method: string,
  path: string,
  init: {
    bearer: string | null;
    headers: Record<string, string>;
    options: V1CallOptions;
  }
): Request {
  const { options } = init;
  const url = new URL(path, TEST_API_ORIGIN);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  const headers = new Headers({ ...init.headers, ...options.headers });
  if (init.bearer) {
    headers.set("Authorization", `Bearer ${init.bearer}`);
  }
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }
  let body: BodyInit | undefined = options.rawBody;
  if (body === undefined && options.body !== undefined) {
    body = JSON.stringify(options.body);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }
  return new Request(url, { method, headers, body });
}

async function readV1Response<T>(response: Response): Promise<V1Response<T>> {
  const text = await response.clone().text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return {
    status: response.status,
    headers: response.headers,
    body: parsed as T,
    text,
    response,
  };
}

interface MintedCli {
  bearer: string;
  deviceId: string | null;
  grantId: string;
  tokenId: string;
}

// A `pilih-jobs-cli` grant (+ device) and its access token, as leaf-2.2's
// token endpoint and device registration would write them.
async function mintCliToken(
  env: Env,
  email: string,
  userId: string,
  cli: CliSessionOptions
): Promise<MintedCli> {
  const now = Date.now();
  const scopes = formatScopeList(cli.scopes ?? CLI_BASE_SCOPES);
  const grantId = newId("grt", now);
  await env.DB.prepare(
    "INSERT INTO oauth_grants (id, user_id, client_id, scopes, created_at) VALUES (?, ?, 'pilih-jobs-cli', ?, ?)"
  )
    .bind(grantId, userId, scopes, now)
    .run();
  let deviceId: string | null = null;
  if (cli.device !== false) {
    const device = cli.device ?? {};
    deviceId = newId("dev", now);
    await env.DB.prepare(
      "INSERT INTO devices (id, user_id, grant_id, name, platform, arch, cli_version, capabilities, accepts_tasks, created_at) VALUES (?, ?, ?, ?, ?, 'arm64', ?, ?, ?, ?)"
    )
      .bind(
        deviceId,
        userId,
        grantId,
        device.name ?? "Test laptop (macOS)",
        device.platform ?? "macos",
        cli.cliVersion ?? "0.1.0",
        JSON.stringify(
          device.capabilities ?? ["discover", "apply", "render_cv"]
        ),
        device.acceptsTasks === false ? 0 : 1,
        now
      )
      .run();
    await env.DB.prepare("UPDATE oauth_grants SET device_id = ? WHERE id = ?")
      .bind(deviceId, grantId)
      .run();
  }
  const bearer = randomSecret();
  const row = await createToken(env.DB, {
    email,
    token: bearer,
    label: "pilih-jobs CLI",
    kind: "oauth",
    scope: scopes.includes("jobs:write") ? "write" : "read",
    expiresAt: now + 3_600_000,
    userId,
    scopes,
    grantId,
    deviceId,
  });
  return { bearer, deviceId, grantId, tokenId: row.id };
}

/**
 * Drives /api/v1 through `createApp(...)` with real auth: each helper mints a
 * real credential in the fake DB / KV and returns a session that calls routes.
 *
 *   const t = createTestEnv();
 *   const client = createV1Client(t, { clock: createFakeClock() });
 *   const alice = await client.browserSession("alice@example.com");
 *   const res = await alice.get("/api/v1/me");
 *   expect(res.status).toBe(200);
 */
export function createV1Client(
  t: TestEnv | Env,
  options: V1ClientOptions = {}
): V1Client {
  const env = "env" in t ? t.env : t;
  const clock = options.clock ?? createFakeClock(Date.now());
  const app = createApp(
    { sse: noMcp, streamable: noMcp },
    { clock, ai: options.ai }
  );

  async function send(request: Request): Promise<Response> {
    const ctx = createCtx();
    const response = await app.fetch(request, env, ctx);
    await ctx.drain();
    return response;
  }

  function session(init: {
    bearer: string | null;
    deviceId?: string | null;
    email: string | null;
    grantId?: string | null;
    headers?: Record<string, string>;
    tokenId?: string | null;
    userId: string | null;
  }): V1Session {
    const headers = { ...(init.headers ?? {}) };
    const call = async <T>(
      method: string,
      path: string,
      callOptions: V1CallOptions = {}
    ): Promise<V1Response<T>> => {
      const request = buildV1Request(method, path, {
        headers,
        bearer: init.bearer,
        options: callOptions,
      });
      return await readV1Response<T>(await send(request));
    };
    return {
      bearer: init.bearer,
      headers,
      email: init.email,
      userId: init.userId,
      deviceId: init.deviceId ?? null,
      grantId: init.grantId ?? null,
      tokenId: init.tokenId ?? null,
      scope: init.userId ? trustedScope(init.userId, "script") : null,
      call,
      get: (path, o) => call("GET", path, o),
      delete: (path, o) => call("DELETE", path, o),
      post: (path, body, o) => call("POST", path, { ...o, body }),
      patch: (path, body, o) => call("PATCH", path, { ...o, body }),
      put: (path, body, o) => call("PUT", path, { ...o, body }),
    };
  }

  async function userIdOf(email: string): Promise<string> {
    return (await ensureUser(env.DB, email.trim().toLowerCase(), Date.now()))
      .id;
  }

  return {
    app,
    env,
    clock,
    fetch: send,
    anonymous: () => session({ bearer: null, email: null, userId: null }),
    async browserSession(email) {
      const bearer = await createBrowserSession(env, email);
      return session({ bearer, email, userId: await userIdOf(email) });
    },
    async personalToken(email, scope = "write") {
      const bearer = randomSecret();
      const row = await createToken(env.DB, {
        email,
        token: bearer,
        label: `test ${scope} token`,
        kind: "personal",
        scope,
        expiresAt: null,
      });
      return session({
        bearer,
        email,
        userId: await userIdOf(email),
        tokenId: row.id,
      });
    },
    async mcpOAuthToken(email) {
      const bearer = randomSecret();
      const row = await createToken(env.DB, {
        email,
        token: bearer,
        label: "OAuth: Test MCP client",
        kind: "session",
        scope: "write",
        expiresAt: Date.now() + 3_600_000,
      });
      return session({
        bearer,
        email,
        userId: await userIdOf(email),
        tokenId: row.id,
      });
    },
    async cliSession(email, cli = {}) {
      const userId = await userIdOf(email);
      const minted = await mintCliToken(env, email, userId, cli);
      const version = cli.cliVersion === undefined ? "0.1.0" : cli.cliVersion;
      return session({
        ...minted,
        email,
        userId,
        headers: version === null ? {} : { [CLIENT_HEADER]: `cli/${version}` },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// MCP tool doubles
// ---------------------------------------------------------------------------

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
