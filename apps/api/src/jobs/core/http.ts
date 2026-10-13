// Responses and errors of the `/api/v1` surface (05 §1.3).
//
// Handlers and services signal failures by THROWING an `ApiError`; the router
// renders it as the error envelope `{error, message, details?, request_id}`
// (+ `reason` on 401, `scope` on 403 insufficient_scope) with the status of
// 05 §1.3. Successful responses go through `apiJson` (or `c.json`/`c.commit`
// on the route context), which sets `Cache-Control: private, no-store` and
// `X-Request-Id`.
//
//   throw notFound("Application not found");
//   throw revisionConflict(currentRecord);
//   throw apiError("invalid_transition", "saved → offer is not allowed", {
//     details: { from: "saved", to: "offer" },
//   });

import type {
  ApiErrorCode,
  InvalidTokenReason,
} from "@pilihpendidikan/jobs-contracts/enums";
import { API_ERROR_STATUS } from "@pilihpendidikan/jobs-contracts/enums";

export const REQUEST_ID_HEADER = "X-Request-Id";
export const REPLAYED_HEADER = "Idempotent-Replayed";
const NO_STORE = "private, no-store";

export interface ApiErrorOptions {
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** `reason` of 401 invalid_token. */
  reason?: InvalidTokenReason;
  /** `scope` of 403 insufficient_scope (space-delimited when several). */
  scope?: string;
  /** Overrides the status of 05 §1.3 (only for 405, which has no code). */
  status?: number;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string>;
  readonly reason: InvalidTokenReason | undefined;
  readonly scope: string | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: ApiErrorOptions = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options.status ?? API_ERROR_STATUS[code];
    this.details = options.details;
    this.headers = options.headers ?? {};
    this.reason = options.reason;
    this.scope = options.scope;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Builds an `ApiError` to throw. */
export function apiError(
  code: ApiErrorCode,
  message: string,
  options: ApiErrorOptions = {}
): ApiError {
  return new ApiError(code, message, options);
}

/** 404 not_found — missing **or not owned** (ids never leak, 11 §6.1). */
export function notFound(message = "Not found."): ApiError {
  return new ApiError("not_found", message);
}

/** 400 invalid_request; `issues` are Zod issues (05 §1.3). */
export function invalidRequest(
  message: string,
  issues?: readonly unknown[]
): ApiError {
  return new ApiError(
    "invalid_request",
    message,
    issues ? { details: { issues } } : {}
  );
}

/** 409 revision_conflict with the full current resource (05 §1.6, D-21). */
export function revisionConflict(
  current: unknown,
  message = "The resource changed since your base_revision."
): ApiError {
  return new ApiError("revision_conflict", message, {
    details: { current },
  });
}

/** 422 invalid_transition (03 §5.1). */
export function invalidTransition(
  message: string,
  details?: Record<string, unknown>
): ApiError {
  return new ApiError(
    "invalid_transition",
    message,
    details ? { details } : {}
  );
}

/** 403 insufficient_scope with `scope` and the RFC 6750 challenge. */
export function insufficientScope(needed: readonly string[]): ApiError {
  const scope = needed.join(" ");
  return new ApiError(
    "insufficient_scope",
    `This credential lacks the scope "${scope}".`,
    {
      scope,
      headers: {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scope}"`,
      },
    }
  );
}

/** 401 invalid_token with `reason` (05 §1.3, 17). */
export function invalidToken(
  reason: InvalidTokenReason,
  details?: Record<string, unknown>
): ApiError {
  const messages: Record<InvalidTokenReason, string> = {
    no_bearer: "Send an Authorization: Bearer token.",
    unknown_token: "The bearer token is not recognized.",
    expired_token: "The bearer token has expired.",
    revoked_token: "The bearer token was revoked.",
  };
  return new ApiError("invalid_token", messages[reason], {
    reason,
    details,
    headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' },
  });
}

/** 503 upstream_unavailable (retryable; AI provider or D1 degraded, 02 §9). */
export function upstreamUnavailable(
  message = "A backing service is temporarily unavailable. Retry with backoff."
): ApiError {
  return new ApiError("upstream_unavailable", message, {
    headers: { "Retry-After": "5" },
  });
}

/** 429 rate_limited with Retry-After. */
export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError("rate_limited", "Too many requests. Slow down.", {
    details: { retry_after: retryAfterSeconds },
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

function baseHeaders(
  requestId: string,
  extra: Record<string, string> | Headers | undefined
): Headers {
  const headers = new Headers(extra);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", NO_STORE);
  }
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
}

/** The error envelope as a Response. */
export function errorResponse(error: ApiError, requestId: string): Response {
  const body: Record<string, unknown> = {
    error: error.code,
    message: error.message,
  };
  if (error.details) {
    body.details = error.details;
  }
  if (error.reason) {
    body.reason = error.reason;
  }
  if (error.scope) {
    body.scope = error.scope;
  }
  body.request_id = requestId;
  return Response.json(body, {
    status: error.status,
    headers: baseHeaders(requestId, error.headers),
  });
}

export interface ApiJsonInit {
  headers?: Record<string, string> | Headers;
  requestId: string;
  status?: number;
}

/** A JSON success response (`204` sends no body). */
export function apiJson(body: unknown, init: ApiJsonInit): Response {
  const status = init.status ?? 200;
  const headers = baseHeaders(init.requestId, init.headers);
  if (status === 204 || body === undefined) {
    return new Response(null, { status, headers });
  }
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

/** Re-sends a stored idempotent response (05 §1.4). */
export function replayResponse(
  status: number,
  bodyText: string,
  requestId: string
): Response {
  const headers = baseHeaders(requestId, { [REPLAYED_HEADER]: "true" });
  if (status === 204 || bodyText.length === 0) {
    return new Response(null, { status, headers });
  }
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(bodyText, { status, headers });
}

/** Adds `X-Request-Id` (and `no-store` when unset) to any handler response. */
export function withRequestId(response: Response, requestId: string): Response {
  if (response.headers.get(REQUEST_ID_HEADER) === requestId) {
    return response;
  }
  const headers = baseHeaders(requestId, response.headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
