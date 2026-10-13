// The browser side of the BFF: typed calls to `/api/v1` routes by contract
// key. Every call goes through the `bffRequest` server function (installed as
// the transport by src/lib/api-transport.ts); this module never sees a bearer.
//
//   const board = await api("GET /api/v1/board", { query: { include_archived: "0" } });
//   await api("POST /api/v1/applications/{app_id}/move", {
//     params: { app_id }, body: { base_revision, stage }, idempotencyKey,
//   });

import type { ApiErrorCode } from "@pilihpendidikan/jobs-contracts/enums";
import type { ApiCallInput, ApiResponse, WebRouteKey } from "./api-routes";
import type { BffRequest, BffResult } from "./bff";

export type BffTransport = (request: BffRequest) => Promise<BffResult>;

let transport: BffTransport | null = null;
const unauthorizedListeners = new Set<() => void>();

/** Installs the transport (the server function, or a fake in tests). */
export function setBffTransport(next: BffTransport | null): void {
  transport = next;
}

/** Called whenever a call answers 401 (the session ended). */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/** A failed API call: the API error envelope (05 §1.3) or a network error. */
export class ApiError extends Error {
  readonly code: ApiErrorCode | "network_error" | (string & {});
  readonly details: Record<string, unknown> | undefined;
  readonly reason: string | undefined;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(result: Extract<BffResult, { ok: false }>) {
    super(result.error.message);
    this.name = "ApiError";
    this.status = result.status;
    this.code = result.error.error;
    this.details = result.error.details;
    this.reason = result.error.reason;
    this.requestId = result.error.request_id;
  }

  /** No answer at all: offline, DNS, the API down. Safe to retry. */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** Retrying the same request (same Idempotency-Key) may succeed. */
  get isRetryable(): boolean {
    return (
      this.status === 0 ||
      this.status === 429 ||
      this.status === 502 ||
      this.status === 503 ||
      this.status === 504
    );
  }

  get isRevisionConflict(): boolean {
    return this.status === 409 && this.code === "revision_conflict";
  }

  /** `details.current` of a 409 revision_conflict (05 §1.6). */
  get current(): unknown {
    return this.details?.current;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export interface ApiCallResult<K extends WebRouteKey> {
  /** Null for 204 and for a 304 (`notModified`). */
  data: ApiResponse<K> | null;
  etag: string | null;
  notModified: boolean;
  replayed: boolean;
  status: number;
}

function toEnvelope<K extends WebRouteKey>(
  route: K,
  input: ApiCallInput<K>
): BffRequest {
  const envelope: BffRequest = { route };
  if (input.params) {
    envelope.params = input.params as Record<string, string>;
  }
  if (input.query) {
    const query: Record<string, string | number | boolean> = {};
    for (const [name, value] of Object.entries(input.query)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        query[name] = value;
      }
    }
    envelope.query = query;
  }
  if (input.body !== undefined) {
    envelope.body = input.body;
  }
  if (input.idempotencyKey) {
    envelope.idempotency_key = input.idempotencyKey;
  }
  if (input.ifNoneMatch) {
    envelope.if_none_match = input.ifNoneMatch;
  }
  return envelope;
}

/** Calls route `K` and returns the full result; throws ApiError on failure. */
export async function apiCall<K extends WebRouteKey>(
  route: K,
  input: ApiCallInput<K>
): Promise<ApiCallResult<K>> {
  if (!transport) {
    throw new Error("The BFF transport is not installed.");
  }
  let result: BffResult;
  try {
    result = await transport(toEnvelope(route, input));
  } catch {
    result = {
      ok: false,
      status: 0,
      error: { error: "network_error", message: "Network error." },
    };
  }
  if (!result.ok) {
    if (result.status === 401) {
      for (const listener of unauthorizedListeners) {
        listener();
      }
    }
    throw new ApiError(result);
  }
  return {
    data: result.data as ApiResponse<K> | null,
    etag: result.etag,
    notModified: result.notModified,
    replayed: result.replayed,
    status: result.status,
  };
}

/** Calls route `K` and returns its body (a 204 gives null). */
export async function api<K extends WebRouteKey>(
  route: K,
  input: ApiCallInput<K>
): Promise<ApiResponse<K>> {
  const result = await apiCall(route, input);
  return result.data as ApiResponse<K>;
}
