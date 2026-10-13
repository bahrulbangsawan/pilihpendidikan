// Keyset pagination (05 §1.5, 14 §4): `?limit=` 1–200 (default 50) and an
// opaque `?cursor=` (base64url of the last row's sort key). Responses are
// `{items, next_cursor}`; `next_cursor` is null on the last page. Never
// OFFSET.
//
// Pattern in a repo list function:
//
//   const page = parsePage(c.query);                       // route
//   const where = keysetAfter(["created_at", "id"], page.cursor, "desc");
//   const rows = await queryAll(db,
//     `SELECT … FROM interviews WHERE user_id = ? AND application_id = ?
//      ${where.sql ? `AND ${where.sql}` : ""}
//      ORDER BY created_at DESC, id DESC LIMIT ?`,
//     scope.userId, appId, ...where.binds, page.limit + 1);
//   return pageOf(rows, page.limit, (r) => [r.created_at, r.id]);

import {
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
} from "@pilihpendidikan/jobs-contracts";
import { invalidRequest } from "./http";

export type CursorKey = readonly (string | number)[];

export interface PageRequest {
  cursor: CursorKey | null;
  limit: number;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

const BASE64_PLUS_RE = /\+/g;
const BASE64_SLASH_RE = /\//g;
const BASE64_PAD_RE = /=+$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const INTEGER_RE = /^\d+$/;
const MAX_CURSOR_LENGTH = 512;

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(BASE64_PLUS_RE, "-")
    .replace(BASE64_SLASH_RE, "_")
    .replace(BASE64_PAD_RE, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Opaque cursor of a sort key. */
export function encodeCursor(key: CursorKey): string {
  return toBase64Url(JSON.stringify(key));
}

/** Decodes a cursor; `400 invalid_request` when it is not one of ours. */
export function decodeCursor(cursor: string): CursorKey {
  if (cursor.length > MAX_CURSOR_LENGTH || !BASE64URL_RE.test(cursor)) {
    throw invalidRequest("Malformed cursor.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw invalidRequest("Malformed cursor.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((v) => typeof v === "string" || typeof v === "number")
  ) {
    throw invalidRequest("Malformed cursor.");
  }
  return parsed as CursorKey;
}

/** Reads `limit` / `cursor` from a query (URLSearchParams or parsed object). */
export function parsePage(
  query:
    | URLSearchParams
    | { cursor?: string | null; limit?: number | string | null }
): PageRequest {
  const rawLimit =
    query instanceof URLSearchParams ? query.get("limit") : query.limit;
  const rawCursor =
    query instanceof URLSearchParams ? query.get("cursor") : query.cursor;
  let limit = PAGE_LIMIT_DEFAULT;
  if (rawLimit !== null && rawLimit !== undefined && rawLimit !== "") {
    const text = String(rawLimit);
    const value = Number(text);
    if (!(INTEGER_RE.test(text) && value >= 1 && value <= PAGE_LIMIT_MAX)) {
      throw invalidRequest(
        `limit must be an integer from 1 to ${PAGE_LIMIT_MAX}.`
      );
    }
    limit = value;
  }
  return {
    limit,
    cursor: rawCursor ? decodeCursor(rawCursor) : null,
  };
}

/**
 * Turns `limit + 1` fetched rows into a page: the extra row only signals that
 * another page exists; the cursor is the key of the last returned row.
 */
export function pageOf<T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => CursorKey
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(keyOf(last))
        : null,
  };
}

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * SQL fragment selecting rows strictly after `cursor` in `(col1, col2, …)`
 * order, using a row-value comparison. Column names must be literal
 * identifiers from the repo (never user input); they are checked anyway.
 */
export function keysetAfter(
  columns: readonly string[],
  cursor: CursorKey | null,
  direction: "asc" | "desc"
): { binds: Array<string | number>; sql: string } {
  for (const column of columns) {
    if (!IDENTIFIER_RE.test(column)) {
      throw new Error(`keysetAfter: "${column}" is not a column identifier`);
    }
  }
  if (cursor === null) {
    return { sql: "", binds: [] };
  }
  if (cursor.length !== columns.length) {
    throw invalidRequest("Cursor does not match this list.");
  }
  const op = direction === "asc" ? ">" : "<";
  const placeholders = columns.map(() => "?").join(", ");
  return {
    sql: `(${columns.join(", ")}) ${op} (${placeholders})`,
    binds: [...cursor],
  };
}
