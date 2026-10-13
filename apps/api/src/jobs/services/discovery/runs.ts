// Discovery runs (05 §4, 15 §9 / §15, 03 §1, 03 §4.3).
//
//   create    client-generated `run_<ULID>` (its timestamp within ±24 h of
//             server time, 03 §1), idempotent by id, bound to the calling
//             device (`device_id` must be the token's device)
//   complete  status/stats/errors + `complete_sources[]`: for each fully
//             enumerated source the caller's linked postings it did not see
//             get `missed_runs + 1`, closing at 2; sources get last_run_id /
//             last_success_at / cursor_state (never overwriting a newer
//             run's). A completed run answers its current record again.
//   list      newest first, keyset cursor

import type {
  CreateRunRequest,
  CompleteRunRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import { isIdWithinClockSkew } from "@pilihpendidikan/jobs-contracts/ids";
import type { DiscoveryRunRecord } from "@pilihpendidikan/jobs-contracts/records";
import { apiError, invalidRequest } from "../../core/http";
import { pageOf, parsePage } from "../../core/pagination";
import { UniqueViolationError } from "../../repo/core/db";
import {
  ownedSourceIds,
  postingFanoutStatements,
} from "../../repo/discovery/postings";
import type {
  CompleteSourceFilter,
  MissedCandidate,
} from "../../repo/discovery/runs";
import {
  CLOSE_AFTER_MISSED_RUNS,
  completeRunStatements,
  getRun,
  insertRunStatements,
  listRuns,
  missedCandidates,
  missedRunStatements,
  ownsTask,
  sourceRunStatements,
} from "../../repo/discovery/runs";
import { loadDeviceRun } from "./batch";
import { commitPlanned } from "./commit";
import type { DiscoveryContext } from "./context";
import {
  CLIENT_CLOCK_SKEW_MS,
  clampClientTime,
  findForbiddenString,
  FORBIDDEN_TEXT,
} from "./validation";

/** Per-call caps of `complete` (D1 statement budget, 14 §4). */
export const COMPLETE_SOURCES_MAX = 100;
/** 15 §9: `detail_etags` keeps at most 2,000 entries (LRU, CLI side). */
export const DETAIL_ETAGS_MAX = 2000;

export function assertCursorState(
  state: Record<string, unknown>,
  path: string
): void {
  const etags = state.detail_etags;
  if (
    etags !== null &&
    typeof etags === "object" &&
    Object.keys(etags).length > DETAIL_ETAGS_MAX
  ) {
    throw invalidRequest(
      `${path}.detail_etags holds at most ${DETAIL_ETAGS_MAX} entries (15 §9).`
    );
  }
  if (findForbiddenString(state) !== null) {
    throw invalidRequest(`${path} contains ${FORBIDDEN_TEXT}.`);
  }
}

/** `POST /api/v1/discovery/runs` (201 created, 200 when it exists). */
export async function createRun(
  c: DiscoveryContext,
  body: CreateRunRequest
): Promise<Response> {
  if (body.device_id !== c.caller.deviceId) {
    throw invalidRequest("device_id must be the calling device.");
  }
  if (!isIdWithinClockSkew(body.id, c.now)) {
    throw invalidRequest(
      "The run id's timestamp must be within 24 h of server time (03 §1)."
    );
  }
  const startedAt = body.started_at ?? c.now;
  if (Math.abs(startedAt - c.now) > CLIENT_CLOCK_SKEW_MS) {
    throw invalidRequest("started_at must be within 24 h of server time.");
  }
  if (findForbiddenString(body) !== null) {
    throw invalidRequest(`The run contains ${FORBIDDEN_TEXT}.`);
  }
  const existing = await getRun(c.db, c.scope, body.id);
  if (existing) {
    return c.respond({ run: existing }, 200);
  }
  const owned = await ownedSourceIds(
    c.db,
    c.scope,
    body.sources.flatMap((s) => (s.source_id ? [s.source_id] : []))
  );
  const taskId =
    body.task_id && (await ownsTask(c.db, c.scope, body.task_id))
      ? body.task_id
      : null;
  const run: DiscoveryRunRecord = {
    id: body.id,
    user_id: c.scope.userId,
    device_id: body.device_id,
    task_id: taskId,
    sources: body.sources.map((s) => ({
      source_id: s.source_id && owned.has(s.source_id) ? s.source_id : null,
      adapter: s.adapter,
      label: s.label,
    })),
    status: "running",
    started_at: Math.min(startedAt, c.now),
    finished_at: null,
    stats: {},
    errors: [],
    engine_version: body.engine_version,
    revision: 1,
  };
  try {
    const { response } = await commitPlanned(c, async () => ({
      status: 201,
      body: { run },
      statements: insertRunStatements(c.db, c.scope, run, c.now),
      extra: null,
    }));
    return response;
  } catch (err) {
    if (
      !(err instanceof UniqueViolationError && err.table === "discovery_runs")
    ) {
      throw err;
    }
    const raced = await getRun(c.db, c.scope, body.id);
    if (raced) {
      return c.respond({ run: raced }, 200);
    }
    throw apiError("duplicate", "This run id is already in use.");
  }
}

function completeFilters(
  body: CompleteRunRequest,
  owned: ReadonlyMap<string, unknown>
): CompleteSourceFilter[] {
  const filters: CompleteSourceFilter[] = [];
  for (const source of body.complete_sources) {
    if (source.source_id) {
      if (owned.has(source.source_id)) {
        filters.push({
          sourceId: source.source_id,
          sourceKind: source.source_kind,
          sourceOrg: source.source_org,
        });
      }
    } else if (source.source_org) {
      // Without a source id, only (kind, org) can say which postings were
      // the source's; a null org would match every board of that kind.
      filters.push({
        sourceId: null,
        sourceKind: source.source_kind,
        sourceOrg: source.source_org,
      });
    }
  }
  return filters;
}

async function candidatesOf(
  c: DiscoveryContext,
  runId: string,
  filters: readonly CompleteSourceFilter[]
): Promise<MissedCandidate[]> {
  const byId = new Map<string, MissedCandidate>();
  for (const filter of filters) {
    for (const candidate of await missedCandidates(
      c.db,
      c.scope,
      runId,
      filter
    )) {
      byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()];
}

function validateComplete(body: CompleteRunRequest): void {
  if (body.complete_sources.length > COMPLETE_SOURCES_MAX) {
    throw invalidRequest(
      `complete_sources holds at most ${COMPLETE_SOURCES_MAX} sources.`
    );
  }
  if ((body.cursor_states?.length ?? 0) > COMPLETE_SOURCES_MAX) {
    throw invalidRequest(
      `cursor_states holds at most ${COMPLETE_SOURCES_MAX} entries.`
    );
  }
  for (const [i, entry] of (body.cursor_states ?? []).entries()) {
    assertCursorState(entry.cursor_state, `cursor_states[${i}].cursor_state`);
  }
  if (
    findForbiddenString({ stats: body.stats, errors: body.errors }) !== null
  ) {
    throw invalidRequest(`stats / errors contain ${FORBIDDEN_TEXT}.`);
  }
}

interface SourceEffect {
  cursorState: Record<string, unknown> | null;
  success: boolean;
}

function sourceEffects(
  run: DiscoveryRunRecord,
  body: CompleteRunRequest,
  owned: ReadonlyMap<string, unknown>
): Map<string, SourceEffect> {
  const effects = new Map<string, SourceEffect>();
  const touch = (id: string | null | undefined): SourceEffect | null => {
    if (!(id && owned.has(id))) {
      return null;
    }
    let effect = effects.get(id);
    if (!effect) {
      effect = { cursorState: null, success: false };
      effects.set(id, effect);
    }
    return effect;
  };
  for (const source of run.sources) {
    touch(source.source_id);
  }
  const succeeded = body.status === "completed" || body.status === "partial";
  for (const source of body.complete_sources) {
    const effect = touch(source.source_id);
    if (effect && succeeded) {
      effect.success = true;
    }
  }
  for (const entry of body.cursor_states ?? []) {
    const effect = touch(entry.source_id);
    if (effect) {
      effect.cursorState = entry.cursor_state;
    }
  }
  return effects;
}

/** `POST /api/v1/discovery/runs/{run_id}/complete`. */
export async function completeRun(
  c: DiscoveryContext,
  runId: string,
  body: CompleteRunRequest
): Promise<Response> {
  const initial = await loadDeviceRun(c, runId);
  validateComplete(body);
  const owned = await ownedSourceIds(c.db, c.scope, [
    ...initial.sources.flatMap((s) => (s.source_id ? [s.source_id] : [])),
    ...body.complete_sources.flatMap((s) => (s.source_id ? [s.source_id] : [])),
    ...(body.cursor_states ?? []).map((s) => s.source_id),
  ]);
  const { response } = await commitPlanned(c, async () => {
    const run = (await getRun(c.db, c.scope, runId)) ?? initial;
    if (run.status !== "running") {
      return {
        status: 200,
        body: { run, closed_postings: 0 },
        statements: [],
        extra: null,
      };
    }
    const finishedAt = Math.max(
      run.started_at,
      clampClientTime(body.finished_at ?? c.now, c.now).value
    );
    const candidates = await candidatesOf(
      c,
      run.id,
      completeFilters(body, owned)
    );
    const closing = candidates.filter(
      (candidate) => candidate.missed_runs + 1 >= CLOSE_AFTER_MISSED_RUNS
    );
    const statements = [
      ...completeRunStatements(
        c.db,
        c.scope,
        run.id,
        {
          status: body.status,
          finishedAt,
          stats: body.stats,
          errors: body.errors,
          revision: run.revision,
        },
        c.now
      ),
      ...missedRunStatements(c.db, c.scope, run.id, candidates, c.now),
      ...postingFanoutStatements(
        c.db,
        closing.map((candidate) => candidate.id),
        c.now
      ),
    ];
    for (const [sourceId, effect] of sourceEffects(run, body, owned)) {
      statements.push(
        ...sourceRunStatements(
          c.db,
          c.scope,
          { id: run.id, startedAt: run.started_at, finishedAt },
          { sourceId, ...effect },
          c.now
        )
      );
    }
    const completed: DiscoveryRunRecord = {
      ...run,
      status: body.status,
      finished_at: finishedAt,
      stats: body.stats,
      errors: body.errors,
      revision: run.revision + 1,
    };
    return {
      status: 200,
      body: { run: completed, closed_postings: closing.length },
      statements,
      extra: null,
    };
  });
  return response;
}

/** `GET /api/v1/discovery/runs`. */
export async function listRunsPage(c: DiscoveryContext): Promise<Response> {
  const page = parsePage(c.query);
  const rows = await listRuns(c.db, c.scope, page);
  return c.respond(pageOf(rows, page.limit, (run) => [run.started_at, run.id]));
}
