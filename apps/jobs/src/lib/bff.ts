// The BFF core (D-15, PLAN C7): every API call of the web app goes through
// here, server-side, with the session bearer the browser never sees. Pure
// functions over an injected `fetchApi`, so the whole proxy is testable
// without the Worker runtime; `src/server/runtime.server.ts` wires the real
// service binding and the cookie.
//
// Guarantees:
// - the request (route, params, query, body) is validated against the route's
//   contract before anything leaves the Worker; a bad request is a 400 here;
// - only WEB_ROUTE_KEYS are reachable, and path params are plain ids;
// - nothing returned to the client contains the bearer: the body text is
//   scrubbed of it before parsing, whatever the API answers.

import { API_ROUTE_SCHEMAS } from "@pilihpendidikan/jobs-contracts/api";
import { z } from "zod";
import type { WebRouteKey } from "./api-routes";
import {
  buildApiPath,
  buildQueryString,
  isWebRouteKey,
  WEB_ROUTE_KEYS,
} from "./api-routes";
import { SESSION_TTL_SECONDS } from "./cookies";
import type { BffSession } from "./session-crypto";

/** `X-Pilih-Client` of the web BFF (05 §1.7 names the CLI's form). */
export const BFF_CLIENT = "web/1";
const MAX_ERROR_TEXT = 300;
const REDACTED = "[redacted]";

/** What the browser sends to the `bffRequest` server function. */
export const BffRequestSchema = z.object({
  route: z.enum(WEB_ROUTE_KEYS),
  params: z.record(z.string(), z.string().max(200)).optional(),
  query: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  body: z.unknown().optional(),
  idempotency_key: z.string().min(1).max(128).optional(),
  if_none_match: z.string().min(1).max(200).optional(),
});
export type BffRequest = z.infer<typeof BffRequestSchema>;

/** A parsed JSON value (what crosses the server-function boundary). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** The error half of a BFF result: the API envelope (05 §1.3) or ours. */
export interface BffError {
  details?: { [key: string]: JsonValue };
  error: string;
  message: string;
  reason?: string;
  request_id?: string;
  scope?: string;
}

export type BffResult =
  | {
      ok: true;
      status: number;
      /** The parsed JSON body; null for 204 and 304. */
      data: JsonValue;
      etag: string | null;
      notModified: boolean;
      /** `Idempotent-Replayed: true` (05 §1.4). */
      replayed: boolean;
    }
  | { ok: false; status: number; error: BffError };

/** A per-isolate cache of successful GET results (keys include the user). */
export interface ResponseCache {
  get(key: string): BffResult | undefined;
  set(key: string, value: BffResult): void;
}

/**
 * GET routes the BFF caches per user for 60 s (10 §6: analytics responses
 * are `private, max-age=60` and the BFF caches them per user).
 */
export const CACHED_ROUTES: ReadonlySet<WebRouteKey> = new Set([
  "GET /api/v1/analytics/summary",
  "GET /api/v1/analytics/timeseries",
  "GET /api/v1/analytics/breakdown",
]);
export const BFF_CACHE_TTL_MS = 60_000;

/** A small TTL + LRU map; `now` is injectable for tests. */
export function createTtlCache(
  ttlMs: number,
  maxEntries: number,
  now: () => number = () => Date.now()
): ResponseCache {
  const entries = new Map<string, { at: number; value: BffResult }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) {
        return;
      }
      if (now() - entry.at >= ttlMs) {
        entries.delete(key);
        return;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { at: now(), value });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
    },
  };
}

/** Hex SHA-256 of a string (cache keys: never the bearer itself). */
async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface BffDeps {
  /** Per-user cache of CACHED_ROUTES answers (none in tests by default). */
  cache?: ResponseCache;
  /** Calls the api Worker; `path` starts with `/` and includes the query. */
  fetchApi: (path: string, init: RequestInit) => Promise<Response>;
  /** The visitor's IP, forwarded for the api's rate limits. */
  clientIp?: string | null;
  /** Report responses that do not match their contract (dev). */
  onContractMismatch?: (route: WebRouteKey, issues: unknown) => void;
  /** Validate responses against the contract (dev / tests). */
  validateResponses?: boolean;
}

const ErrorEnvelopeShape = z.object({
  error: z.string().min(1).max(100),
  message: z.string().max(2000).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  request_id: z.string().max(200).optional(),
  reason: z.string().max(100).optional(),
  scope: z.string().max(200).optional(),
});

/** Status → error code when the API body carries no envelope. */
function codeForStatus(status: number): string {
  if (status === 401) {
    return "invalid_token";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 409) {
    return "conflict";
  }
  if (status === 429) {
    return "rate_limited";
  }
  return status >= 500 ? "upstream_unavailable" : "invalid_request";
}

function failure(
  status: number,
  error: string,
  message: string,
  details?: { [key: string]: JsonValue }
): BffResult {
  return {
    ok: false,
    status,
    error: details ? { error, message, details } : { error, message },
  };
}

/** Removes every occurrence of `secret` from `text`. */
export function redactSecret(text: string, secret: string | null): string {
  if (!secret || secret.length < 8 || !text.includes(secret)) {
    return text;
  }
  return text.split(secret).join(REDACTED);
}

function parseJson(text: string): JsonValue | undefined {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

function issuesOf(error: z.ZodError): JsonValue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
    code: issue.code,
  }));
}

interface PreparedRequest {
  body: string | undefined;
  method: string;
  path: string;
  route: WebRouteKey;
}

/** Validates the envelope against the route's contract; a 400 on failure. */
export function prepareApiRequest(input: unknown):
  | { ok: true; request: PreparedRequest; envelope: BffRequest }
  | {
      ok: false;
      result: BffResult;
    } {
  const envelope = BffRequestSchema.safeParse(input);
  if (!envelope.success) {
    return {
      ok: false,
      result: failure(400, "invalid_request", "Malformed request.", {
        issues: issuesOf(envelope.error),
      }),
    };
  }
  const { route, params, query, body } = envelope.data;
  if (!isWebRouteKey(route)) {
    return { ok: false, result: failure(404, "not_found", "Unknown route.") };
  }
  const contract = API_ROUTE_SCHEMAS[route];
  const path = buildApiPath(route, params ?? {});
  if (path === null) {
    return {
      ok: false,
      result: failure(400, "invalid_request", "Invalid route parameters."),
    };
  }
  let search = "";
  if ("query" in contract && contract.query) {
    const parsed = contract.query.safeParse(query ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        result: failure(400, "invalid_request", "Invalid query.", {
          issues: issuesOf(parsed.error),
        }),
      };
    }
    search = buildQueryString(parsed.data as Record<string, unknown>);
  } else if (query && Object.keys(query).length > 0) {
    return {
      ok: false,
      result: failure(400, "invalid_request", "This route takes no query."),
    };
  }
  let text: string | undefined;
  if (contract.request) {
    const parsed = contract.request.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        result: failure(400, "invalid_request", "Invalid request body.", {
          issues: issuesOf(parsed.error),
        }),
      };
    }
    // Send what the client sent (validated), not the parsed copy, so an
    // open schema never drops a field the API understands.
    text = JSON.stringify(body);
  } else if (body !== undefined && body !== null) {
    return {
      ok: false,
      result: failure(400, "invalid_request", "This route takes no body."),
    };
  }
  return {
    ok: true,
    envelope: envelope.data,
    request: {
      route,
      method: contract.method,
      path: `${path}${search}`,
      body: text,
    },
  };
}

function apiHeaders(
  prepared: PreparedRequest,
  envelope: BffRequest,
  bearer: string,
  clientIp: string | null | undefined
): Headers {
  const contract = API_ROUTE_SCHEMAS[prepared.route];
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${bearer}`,
    "X-Pilih-Client": BFF_CLIENT,
  });
  if (prepared.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (envelope.idempotency_key && contract.idempotency !== "none") {
    headers.set("Idempotency-Key", envelope.idempotency_key);
  }
  if (envelope.if_none_match && prepared.method === "GET") {
    headers.set("If-None-Match", envelope.if_none_match);
  }
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
  }
  return headers;
}

function errorResult(
  status: number,
  json: JsonValue | undefined,
  text: string
): BffResult {
  const envelope = ErrorEnvelopeShape.safeParse(json);
  if (!envelope.success) {
    return failure(
      status,
      codeForStatus(status),
      text.slice(0, MAX_ERROR_TEXT) || `HTTP ${status}`
    );
  }
  const { message, details, ...rest } = envelope.data;
  return {
    ok: false,
    status,
    error: {
      ...rest,
      message: message ?? rest.error,
      ...(details ? { details: details as { [key: string]: JsonValue } } : {}),
    },
  };
}

/**
 * Calls one `/api/v1` route as the signed-in user and returns a result that
 * is safe to hand to the browser.
 */
export async function proxyApiRequest(
  input: unknown,
  bearer: string,
  deps: BffDeps
): Promise<BffResult> {
  const prepared = prepareApiRequest(input);
  if (!prepared.ok) {
    return prepared.result;
  }
  const { request, envelope } = prepared;
  const cacheKey =
    deps.cache && CACHED_ROUTES.has(request.route)
      ? `${await sha256Text(bearer)}|${request.path}`
      : null;
  if (cacheKey) {
    const hit = deps.cache?.get(cacheKey);
    if (hit) {
      return hit;
    }
  }
  let response: Response;
  try {
    response = await deps.fetchApi(request.path, {
      method: request.method,
      headers: apiHeaders(request, envelope, bearer, deps.clientIp),
      body: request.body,
    });
  } catch {
    return failure(0, "network_error", "The API could not be reached.");
  }

  const text = redactSecret(await response.text(), bearer);
  const etag = response.headers.get("ETag");
  if (response.status === 304) {
    return {
      ok: true,
      status: 304,
      data: null,
      etag: etag ?? envelope.if_none_match ?? null,
      notModified: true,
      replayed: false,
    };
  }
  const json = parseJson(text);
  if (!response.ok) {
    return errorResult(response.status, json, text);
  }
  if (json === undefined) {
    return failure(502, "upstream_unavailable", "The API sent invalid JSON.");
  }
  if (deps.validateResponses && json !== null) {
    const checked = API_ROUTE_SCHEMAS[request.route].response.safeParse(json);
    if (!checked.success) {
      deps.onContractMismatch?.(request.route, issuesOf(checked.error));
    }
  }
  const result: BffResult = {
    ok: true,
    status: response.status,
    data: json,
    etag,
    notModified: false,
    replayed: response.headers.get("Idempotent-Replayed") === "true",
  };
  if (cacheKey && response.status === 200) {
    deps.cache?.set(cacheKey, result);
  }
  return result;
}

// ── Sign-in (12 §1.1) ──────────────────────────────────────────────────────

export type SignInRequestResult =
  | { ok: true }
  | { ok: false; status: number; message: string; retryAfter?: number };

/**
 * `POST /auth/request {email, returnTo}`: the api emails a link whose
 * confirmation redirects to `returnTo/?code=…` (`returnTo` must be on the
 * api's app-origin allowlist, 05 §1.8).
 */
export async function requestSignInLink(
  email: string,
  returnTo: string,
  deps: Pick<BffDeps, "fetchApi" | "clientIp">
): Promise<SignInRequestResult> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (deps.clientIp) {
    headers.set("X-Forwarded-For", deps.clientIp);
  }
  let response: Response;
  try {
    response = await deps.fetchApi("/auth/request", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, returnTo }),
    });
  } catch {
    return { ok: false, status: 0, message: "network_error" };
  }
  if (response.ok) {
    return { ok: true };
  }
  const body = parseJson(await response.text());
  const message =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error
      : `HTTP ${response.status}`;
  const retryAfter = Number(response.headers.get("Retry-After"));
  return {
    ok: false,
    status: response.status,
    message,
    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
  };
}

const ExchangeResponseSchema = z.object({
  email: z.string().min(3).max(254),
  token: z.string().min(16).max(512),
  expiresAt: z.string().optional(),
});

export type ExchangeResult =
  | { ok: true; session: BffSession }
  | { ok: false; status: number };

/**
 * `POST /auth/exchange {code}` → the browser-session bearer. The session
 * expires with the bearer (7 days), never later.
 */
export async function exchangeSignInCode(
  code: string,
  deps: Pick<BffDeps, "fetchApi" | "clientIp">,
  nowMs: number
): Promise<ExchangeResult> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (deps.clientIp) {
    headers.set("X-Forwarded-For", deps.clientIp);
  }
  let response: Response;
  try {
    response = await deps.fetchApi("/auth/exchange", {
      method: "POST",
      headers,
      body: JSON.stringify({ code }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  const parsed = ExchangeResponseSchema.safeParse(
    parseJson(await response.text())
  );
  if (!parsed.success) {
    return { ok: false, status: 502 };
  }
  const ceiling = nowMs + SESSION_TTL_SECONDS * 1000;
  const announced = parsed.data.expiresAt
    ? Date.parse(parsed.data.expiresAt)
    : Number.NaN;
  const exp =
    Number.isFinite(announced) && announced > nowMs
      ? Math.min(announced, ceiling)
      : ceiling;
  return {
    ok: true,
    session: { bearer: parsed.data.token, email: parsed.data.email, exp },
  };
}

/** `POST /auth/logout` with the bearer; failures are ignored (best effort). */
export async function revokeApiSession(
  bearer: string,
  deps: Pick<BffDeps, "fetchApi">
): Promise<void> {
  try {
    await deps.fetchApi("/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}` },
    });
  } catch {
    // The cookie is cleared either way; the bearer expires on its own.
  }
}
