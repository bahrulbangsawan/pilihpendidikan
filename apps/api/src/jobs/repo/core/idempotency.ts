// `Idempotency-Key` storage (05 §1.4, 04 §2.7 `idempotency_keys`).
//
//   1. look up (user_id, key)          → `findIdempotency`
//   2. same request_hash               → replay status + body, `Idempotent-Replayed: true`
//   3. different request_hash          → 409 idempotency_mismatch
//   4. not found                       → execute, and store the result in the
//                                        SAME batch as the mutation
//                                        (`idempotencyStatements`)
//
// The `(user_id, key)` primary key doubles as a lock: when two requests with
// the same key race, the second batch fails on the primary key and is rolled
// back as a whole, so the mutation runs exactly once. The router turns that
// failure into a replay of the winner's stored response.
//
// Rows live 7 days (longer than the CLI outbox's max age, 20 §5); an expired
// row is deleted in the same batch before the new insert. Bodies over 64 KB
// are stored as a pointer (see `storedBody`).

import type { UserScope } from "../../core/scope";
import type { JobsDb } from "./db";
import { queryFirst, stmt } from "./db";

export const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_KEY_MAX = 128;
/** 04 §2.7: response bodies are stored up to 64 KB. */
export const IDEMPOTENCY_BODY_MAX_BYTES = 65_536;

const KEY_RE = /^[\x21-\x7e]{1,128}$/;

/** Printable ASCII without spaces, 1–128 characters (05 §1.4). */
export function isValidIdempotencyKey(value: string): boolean {
  return KEY_RE.test(value);
}

/** SHA-256 hex of `METHOD\npath?query\nbody` (04 §2.7 request_hash). */
export async function requestHash(
  method: string,
  pathAndQuery: string,
  body: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${method.toUpperCase()}\n${pathAndQuery}\n${body}`
    )
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export interface StoredIdempotency {
  created_at: number;
  expires_at: number;
  request_hash: string;
  response_body: string;
  status_code: number;
}

/** The live stored result of `(user, key)`, ignoring expired rows. */
export async function findIdempotency(
  db: JobsDb,
  scope: UserScope,
  key: string,
  now: number
): Promise<StoredIdempotency | null> {
  return await queryFirst<StoredIdempotency>(
    db,
    "SELECT request_hash, status_code, response_body, created_at, expires_at FROM idempotency_keys WHERE user_id = ? AND key = ? AND expires_at > ?",
    scope.userId,
    key,
    now
  );
}

export interface IdempotencyRecord {
  /** JSON-serializable response body (undefined for bodiless 204). */
  body: unknown;
  key: string;
  now: number;
  requestHash: string;
  status: number;
}

/** Marker stored instead of a body larger than 64 KB. */
export interface OmittedBody {
  $omitted: true;
  bytes: number;
}

/** The text stored in `response_body` (a 64 KB cap; larger → `OmittedBody`). */
export function storedBody(body: unknown): string {
  if (body === undefined) {
    return "";
  }
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes <= IDEMPOTENCY_BODY_MAX_BYTES) {
    return text;
  }
  const omitted: OmittedBody = { $omitted: true, bytes };
  return JSON.stringify(omitted);
}

/**
 * The two statements that record a result: drop an expired row with the
 * same key, then INSERT (fails on a live duplicate → the batch rolls back).
 */
export function idempotencyStatements(
  db: JobsDb,
  scope: UserScope,
  record: IdempotencyRecord
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "DELETE FROM idempotency_keys WHERE user_id = ? AND key = ? AND expires_at <= ?",
      scope.userId,
      record.key,
      record.now
    ),
    stmt(
      db,
      "INSERT INTO idempotency_keys (user_id, key, request_hash, status_code, response_body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      scope.userId,
      record.key,
      record.requestHash,
      record.status,
      storedBody(record.body),
      record.now,
      record.now + IDEMPOTENCY_TTL_MS
    ),
  ];
}

/**
 * Like `idempotencyStatements`, but the stored status and body come from a
 * SELECT evaluated inside the batch (after the mutation), for responses that
 * depend on what the batch wrote (e.g. the task a claim picked, 21 §5.1).
 * `selectSql` must return exactly the columns `status_code, response_body`
 * and carry its own `user_id = ?` predicate; when it returns no row, nothing
 * is stored.
 */
export function idempotencyStatementsFromSelect(
  db: JobsDb,
  scope: UserScope,
  record: Omit<IdempotencyRecord, "body" | "status">,
  selectSql: string,
  ...selectBinds: readonly unknown[]
): D1PreparedStatement[] {
  return [
    stmt(
      db,
      "DELETE FROM idempotency_keys WHERE user_id = ? AND key = ? AND expires_at <= ?",
      scope.userId,
      record.key,
      record.now
    ),
    stmt(
      db,
      `INSERT INTO idempotency_keys (user_id, key, request_hash, status_code, response_body, created_at, expires_at) SELECT ?, ?, ?, s.status_code, s.response_body, ?, ? FROM (${selectSql}) AS s`,
      scope.userId,
      record.key,
      record.requestHash,
      record.now,
      record.now + IDEMPOTENCY_TTL_MS,
      ...selectBinds
    ),
  ];
}
