// Job sources (05 §4, 15 §14, D-17, 11 T-08).
//
// A source names an adapter of `adapters.json` and a config validated by that
// adapter's schema. Excluded platforms (LinkedIn, Indeed) are refused with
// `422 unsupported_source` — by adapter id and by any URL in the config that
// points at their hosts (a career page or custom URL on linkedin.com). URLs
// are syntax-checked only (http/https, no userinfo, ≤ 2048); the server never
// fetches them.

import type {
  CreateSourceRequest,
  UpdateSourceRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  EXCLUDED_SOURCES,
  isAdapterId,
  parseAdapterConfig,
} from "@pilihpendidikan/jobs-contracts/adapters";
import type { AdapterId } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { JobSourceRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  apiError,
  invalidRequest,
  notFound,
  revisionConflict,
} from "../../core/http";
import { pageOf, parsePage } from "../../core/pagination";
import { assertRevision, baseRevision } from "../../core/revision";
import { issuesOf } from "../../core/validate";
import { GuardFailedError } from "../../repo/core/db";
import {
  deleteSourceStatements,
  getSource,
  insertSourceStatements,
  listSources,
  updateSourceStatements,
} from "../../repo/discovery/sources";
import { commitPlanned } from "./commit";
import type { DiscoveryContext } from "./context";
import { assertCursorState } from "./runs";
import {
  checkUrl,
  excludedHostOf,
  findForbiddenString,
  FORBIDDEN_TEXT,
  urlProblemMessage,
  urlsInConfig,
} from "./validation";

function unsupported(message: string, details: Record<string, unknown>) {
  return apiError("unsupported_source", message, { details });
}

/** The adapter id, or `422 unsupported_source` (excluded / unknown, D-17). */
export function assertSupportedAdapter(adapter: string): AdapterId {
  const excluded = EXCLUDED_SOURCES.find((entry) => entry.id === adapter);
  if (excluded) {
    throw unsupported(
      `${excluded.display_name} is not supported: ${excluded.reason}`,
      {
        adapter,
        reason: excluded.reason,
      }
    );
  }
  if (!isAdapterId(adapter)) {
    throw unsupported(`Unknown source adapter "${adapter}".`, { adapter });
  }
  return adapter;
}

/** Validates a config for `adapter` (400 / 422); returns the parsed config. */
export function validateSourceConfig(
  adapter: AdapterId,
  config: Record<string, unknown>
): Record<string, unknown> {
  const parsed = parseAdapterConfig(adapter, config);
  if (!parsed.success) {
    throw invalidRequest(
      `Invalid ${adapter} config.`,
      issuesOf(parsed.error).map((issue) => ({
        ...issue,
        path: ["config", ...issue.path],
      }))
    );
  }
  const bad = findForbiddenString(parsed.data);
  if (bad !== null) {
    throw invalidRequest(`config.${bad} contains ${FORBIDDEN_TEXT}.`);
  }
  for (const { path, url } of urlsInConfig(parsed.data)) {
    const excluded = excludedHostOf(url);
    if (excluded) {
      throw unsupported(
        `${excluded} URLs are not supported: their terms prohibit automated access (D-17).`,
        { adapter, path, excluded }
      );
    }
    const problem = checkUrl(url, { allowHttp: true });
    if (problem) {
      throw invalidRequest(`${path}: ${urlProblemMessage(problem)}`);
    }
  }
  return parsed.data;
}

function assertCleanText(value: unknown, what: string): void {
  if (findForbiddenString(value) !== null) {
    throw invalidRequest(`${what} contains ${FORBIDDEN_TEXT}.`);
  }
}

/** `GET /api/v1/sources`. */
export async function listSourcesPage(
  c: DiscoveryContext,
  query: { enabled?: "0" | "1" }
): Promise<Response> {
  const page = parsePage(c.query);
  const rows = await listSources(c.db, c.scope, {
    ...page,
    enabled: query.enabled === undefined ? null : query.enabled === "1",
  });
  return c.respond(
    pageOf(rows, page.limit, (source) => [source.created_at, source.id])
  );
}

/** `POST /api/v1/sources`. */
export async function createSource(
  c: DiscoveryContext,
  body: CreateSourceRequest
): Promise<Response> {
  const adapter = assertSupportedAdapter(body.adapter);
  const config = validateSourceConfig(adapter, body.config);
  assertCleanText(
    { label: body.label, schedule: body.schedule },
    "label / schedule"
  );
  const source: JobSourceRecord = {
    id: newId("src", c.now),
    user_id: c.scope.userId,
    adapter,
    label: body.label,
    config,
    enabled: body.enabled ?? true,
    schedule: body.schedule ?? null,
    last_run_id: null,
    last_success_at: null,
    cursor_state: {},
    revision: 1,
    created_at: c.now,
    updated_at: c.now,
  };
  const { response } = await commitPlanned(c, async () => ({
    status: 201,
    body: { source },
    statements: insertSourceStatements(c.db, c.scope, source, c.now),
    extra: null,
  }));
  return response;
}

async function currentOrThrow(
  c: DiscoveryContext,
  id: string
): Promise<JobSourceRecord> {
  const current = await getSource(c.db, c.scope, id);
  if (!current) {
    throw notFound("Source not found.");
  }
  return current;
}

async function conflictFrom(
  c: DiscoveryContext,
  id: string,
  err: unknown
): Promise<never> {
  if (err instanceof GuardFailedError) {
    const current = await getSource(c.db, c.scope, id);
    if (!current) {
      throw notFound("Source not found.");
    }
    throw revisionConflict(current);
  }
  throw err;
}

/** `PATCH /api/v1/sources/{src_id}` (base_revision, D-21). */
export async function updateSource(
  c: DiscoveryContext,
  id: string,
  body: UpdateSourceRequest
): Promise<Response> {
  const base = c.baseRevision(body.base_revision);
  const current = await currentOrThrow(c, id);
  assertRevision(current, base);
  const adapter = assertSupportedAdapter(current.adapter);
  assertCleanText(
    { label: body.label, schedule: body.schedule },
    "label / schedule"
  );
  if (body.cursor_state) {
    assertCursorState(body.cursor_state, "cursor_state");
  }
  const next: JobSourceRecord = {
    ...current,
    label: body.label ?? current.label,
    config:
      body.config === undefined
        ? current.config
        : validateSourceConfig(adapter, body.config),
    enabled: body.enabled ?? current.enabled,
    schedule: body.schedule === undefined ? current.schedule : body.schedule,
    cursor_state: body.cursor_state ?? current.cursor_state,
    revision: base + 1,
    updated_at: c.now,
  };
  try {
    const { response } = await commitPlanned(
      c,
      async () => ({
        status: 200,
        body: { source: next },
        statements: updateSourceStatements(c.db, c.scope, next, base, c.now),
        extra: null,
      }),
      { attempts: 1 }
    );
    return response;
  } catch (err) {
    return await conflictFrom(c, id, err);
  }
}

/** `DELETE /api/v1/sources/{src_id}` (optional base_revision / If-Match). */
export async function deleteSource(
  c: DiscoveryContext,
  id: string,
  query: { base_revision?: number }
): Promise<Response> {
  const base = baseRevision(c.request, query.base_revision, { optional: true });
  const current = await currentOrThrow(c, id);
  if (base !== null) {
    assertRevision(current, base);
  }
  try {
    const { response } = await commitPlanned(
      c,
      async () => ({
        status: 200,
        body: { id, deleted: true },
        statements: deleteSourceStatements(
          c.db,
          c.scope,
          id,
          current.revision,
          c.now
        ),
        extra: null,
      }),
      { attempts: 1 }
    );
    return response;
  } catch (err) {
    return await conflictFrom(c, id, err);
  }
}
