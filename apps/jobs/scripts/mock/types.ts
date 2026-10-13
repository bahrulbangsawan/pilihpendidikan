// The mock api's request / reply shapes and small reply helpers, shared by
// scripts/mock-api.ts and the per-area route modules in scripts/mock/*.ts.

export interface MockRequest {
  body: Record<string, unknown>;
  /** Header lookup (lower-case names). */
  header: (name: string) => string | undefined;
  ifNoneMatch: string | undefined;
  method: string;
  path: string;
  /** The raw request body (multipart uploads). */
  raw: Buffer;
  url: URL;
}

export interface Reply {
  body?: unknown;
  headers?: Record<string, string>;
  /** Raw bytes instead of a JSON body (file content). */
  raw?: Uint8Array;
  status: number;
}

/** One area's routes: a reply when the request is theirs, else null. */
export type MockRoute = (request: MockRequest) => Reply | null;

export function ok(body: unknown, status = 200): Reply {
  return { status, body };
}

export function apiError(
  status: number,
  error: string,
  message: string,
  details?: Record<string, unknown>
): Reply {
  return {
    status,
    body: {
      error,
      message,
      ...(details ? { details } : {}),
      request_id: "mock",
    },
  };
}

export const NOT_FOUND: Reply = apiError(404, "not_found", "Not found");

export function revisionConflict(current: unknown): Reply {
  return apiError(409, "revision_conflict", "changed", { current });
}

/** `{items, next_cursor}` of a whole list (no paging in the mock). */
export function page<T>(items: readonly T[]): Reply {
  return ok({ items, next_cursor: null });
}

/** Matches `pattern` (a RegExp with groups) against the request path. */
export function match(
  request: MockRequest,
  method: string,
  pattern: RegExp
): string[] | null {
  if (request.method !== method) {
    return null;
  }
  const found = pattern.exec(request.path);
  return found ? found.slice(1).map((value) => value ?? "") : null;
}
