// Request body and query handling for /api/v1 (05 §1.3, §1.4).
//
// - JSON bodies are capped at 1 MB (`413 payload_too_large`), checked against
//   `Content-Length` first and then while streaming, so a missing or lying
//   header cannot get a larger body into memory.
// - A non-empty JSON body must be sent as `application/json` (`+json` also
//   accepted); that keeps every cross-origin write behind a CORS preflight.
// - Zod failures answer `400 invalid_request` with `details.issues`.

import type { z } from "zod";
import { ApiError, invalidRequest } from "./http";

/** 05 §1.3: JSON bodies ≤ 1 MB. */
export const JSON_BODY_LIMIT_BYTES = 1_048_576;

const JSON_TYPE_RE = /^application\/([a-z0-9.+-]*\+)?json\b/i;

export function payloadTooLarge(limit: number): ApiError {
  return new ApiError(
    "payload_too_large",
    `The request body exceeds ${limit} bytes.`,
    { details: { limit_bytes: limit } }
  );
}

/** Reads the body as UTF-8 text with a hard byte cap. */
export async function readBodyText(
  request: Request,
  maxBytes: number = JSON_BODY_LIMIT_BYTES
): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw payloadTooLarge(maxBytes);
  }
  if (!request.body) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw payloadTooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function isJsonContentType(value: string | null): boolean {
  return value !== null && JSON_TYPE_RE.test(value.trim());
}

/**
 * Parses a JSON body text. An empty body is `{}` (routes whose fields are all
 * optional accept a bodiless POST).
 */
export function parseJsonBody(
  text: string,
  contentType: string | null
): unknown {
  if (text.trim().length === 0) {
    return {};
  }
  if (!isJsonContentType(contentType)) {
    throw invalidRequest(
      "Send the request body as Content-Type: application/json."
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidRequest("The request body is not valid JSON.");
  }
}

/** Zod issues in a JSON-safe shape for `details.issues`. */
export function issuesOf(error: z.ZodError): Array<{
  code: string;
  message: string;
  path: Array<string | number>;
}> {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map((part) =>
      typeof part === "symbol" ? String(part) : part
    ),
  }));
}

/** Validates `value`; `400 invalid_request` with the issues on failure. */
export function validateWith<T>(
  schema: z.ZodType<T>,
  value: unknown,
  what: "body" | "query" | "params" = "body"
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw invalidRequest(`Invalid request ${what}.`, issuesOf(result.error));
  }
  return result.data;
}

/**
 * The query string as a plain object: one value per key, or an array when a
 * key repeats. Contract query schemas coerce numbers and split lists.
 */
export function queryObject(
  params: URLSearchParams
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length === 1 ? values[0] : values;
  }
  return out;
}
