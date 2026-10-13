// The discovery inbox (05 §4, 12 §4): list + bulk actions.
//
// `GET /api/v1/inbox` — the caller's user_jobs (default states new + seen)
// joined with the posting, the CURRENT profile version's score (07 §6),
// provenance (first run, source label/kind) and the number of other linked
// postings of the same dedupe group (15 §11); one representative per group.
// Filters: state, min_score (ready scores only), source (`src_…` id or a
// source kind), q (title / company), keyset cursor.
//
// `POST /api/v1/inbox:bulk` — ≤ 200 ids, per-id results (20 §6.2):
//   seen     new → seen (other states unchanged)
//   dismiss  new / seen → dismissed; a tracked job is a `conflict` (archive
//            the application instead)
//   restore  dismissed → seen (other states unchanged)
//   track    leaf-2.3's planTrackApplications (set-based: application +
//            created event + inbox_state tracked for all ids in ~30
//            statements); already tracked → its application
//   score    the 07 §7.1 producer (queued / cached)
// Ids that are not the caller's answer `not_found` (11 §6.1 rule 3).

import type {
  InboxBulkRequest,
  InboxItem,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationMode,
  InboxState,
} from "@pilihpendidikan/jobs-contracts/enums";
import { APPLICATION_MODES } from "@pilihpendidikan/jobs-contracts/enums";
import type { UserJobRecord } from "@pilihpendidikan/jobs-contracts/records";
import { RUBRIC_VERSION } from "@pilihpendidikan/jobs-contracts/scoring";
import { pageOf, parsePage } from "../../core/pagination";
import { getProfileVersion } from "../../repo/core/profile-version";
import { enqueueScoring } from "../../repo/core/score-queue";
import { USER_SETTINGS_DEFAULTS } from "../../repo/core/settings";
import {
  defaultModeOf,
  getUserJobs,
  groupSizes,
  inboxStateStatements,
  listInboxIds,
  scoresFor,
} from "../../repo/discovery/inbox";
import { getLinkedPostings } from "../../repo/discovery/postings";
import { sourceLabels } from "../../repo/discovery/sources";
import { planTrackApplications } from "../applications/index";
import { commitPlanned } from "./commit";
import type { DiscoveryContext } from "./context";
import { toScoreSummary } from "./views";

/** Default inbox states (the "to review" list). */
export const DEFAULT_INBOX_STATES: readonly InboxState[] = ["new", "seen"];
/**
 * `track` accepts the whole 05 §4 bulk (≤ 200 ids): planTrackApplications
 * reads set-based and writes multi-row statements, so 200 new cards cost
 * ~35 D1 queries (an invocation may run 1,000, 14 §4).
 */
export const TRACK_BULK_MAX = 200;

export interface InboxQuery {
  min_score?: number;
  q?: string;
  source?: string;
  state?: InboxState;
}

async function currentVersion(c: DiscoveryContext) {
  return {
    profileVersion: await getProfileVersion(c.env, c.db, c.scope, c, {
      email: c.caller.email,
    }),
    rubricVersion: RUBRIC_VERSION,
  };
}

/** Inbox items for user_jobs (in the given order). */
export async function hydrateInboxItems(
  c: DiscoveryContext,
  userJobIds: readonly string[],
  version: { profileVersion: number; rubricVersion: string }
): Promise<InboxItem[]> {
  const userJobs = await getUserJobs(c.db, c.scope, userJobIds);
  const jobs = userJobIds.flatMap((id) => {
    const job = userJobs.get(id);
    return job ? [job] : [];
  });
  const postingIds = jobs.map((job) => job.posting_id);
  const postings = await getLinkedPostings(c.db, c.scope, postingIds);
  const scores = await scoresFor(c.db, c.scope, postingIds, version);
  const labels = await sourceLabels(
    c.db,
    c.scope,
    jobs.flatMap((job) => (job.source_id ? [job.source_id] : []))
  );
  const groups = await groupSizes(
    c.db,
    c.scope,
    [...postings.values()].flatMap((p) =>
      p.dedupe_group ? [p.dedupe_group] : []
    )
  );
  return jobs.flatMap((job) => {
    const posting = postings.get(job.posting_id);
    if (!posting) {
      return [];
    }
    const score = scores.get(job.posting_id);
    const size = posting.dedupe_group
      ? (groups.get(posting.dedupe_group) ?? 1)
      : 1;
    return [
      {
        user_job: job,
        posting,
        score: score ? toScoreSummary(score) : null,
        provenance: {
          run_id: job.first_run_id,
          source_id: job.source_id,
          source_label: job.source_id
            ? (labels.get(job.source_id) ?? null)
            : null,
          source_kind: posting.source_kind,
        },
        duplicates: Math.max(0, size - 1),
      },
    ];
  });
}

/** `GET /api/v1/inbox`. */
export async function listInbox(
  c: DiscoveryContext,
  query: InboxQuery
): Promise<Response> {
  const page = parsePage(c.query);
  const version = await currentVersion(c);
  const rows = await listInboxIds(c.db, c.scope, {
    ...page,
    ...version,
    states: query.state ? [query.state] : DEFAULT_INBOX_STATES,
    minScore: query.min_score ?? null,
    source: query.source ?? null,
    q: query.q?.trim() ? query.q.trim() : null,
  });
  const result = pageOf(rows, page.limit, (row) => [row.created_at, row.id]);
  const items = await hydrateInboxItems(
    c,
    result.items.map((row) => row.id),
    version
  );
  return c.respond({ items, next_cursor: result.next_cursor });
}

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

export interface BulkResult {
  application_id?: string;
  error?: string;
  inbox_state?: InboxState;
  score_status?: "cached" | "queued";
  status: "conflict" | "invalid" | "not_found" | "ok";
  user_job_id: string;
}

type StateAction = "dismiss" | "restore" | "seen";

const STATE_MOVES: Record<
  StateAction,
  { from: readonly InboxState[]; to: InboxState }
> = {
  seen: { from: ["new"], to: "seen" },
  dismiss: { from: ["new", "seen"], to: "dismissed" },
  restore: { from: ["dismissed"], to: "seen" },
};

function stateResult(
  id: string,
  job: UserJobRecord | undefined,
  action: StateAction
): { move: boolean; result: BulkResult } {
  if (!job) {
    return { move: false, result: { user_job_id: id, status: "not_found" } };
  }
  const rule = STATE_MOVES[action];
  if (rule.from.includes(job.inbox_state)) {
    return {
      move: true,
      result: { user_job_id: id, status: "ok", inbox_state: rule.to },
    };
  }
  if (action === "dismiss" && job.inbox_state === "tracked") {
    return {
      move: false,
      result: {
        user_job_id: id,
        status: "conflict",
        inbox_state: "tracked",
        error:
          "This job is tracked; archive its application on the board instead.",
      },
    };
  }
  return {
    move: false,
    result: { user_job_id: id, status: "ok", inbox_state: job.inbox_state },
  };
}

async function bulkState(
  c: DiscoveryContext,
  ids: readonly string[],
  action: StateAction
): Promise<Response> {
  const { response } = await commitPlanned(c, async () => {
    const jobs = await getUserJobs(c.db, c.scope, ids);
    const results: BulkResult[] = [];
    const moving: string[] = [];
    for (const id of ids) {
      const { move, result } = stateResult(id, jobs.get(id), action);
      results.push(result);
      if (move && !moving.includes(id)) {
        moving.push(id);
      }
    }
    const rule = STATE_MOVES[action];
    return {
      status: 200,
      body: { results },
      statements: inboxStateStatements(
        c.db,
        c.scope,
        { ids: moving, from: rule.from, to: rule.to },
        c.now
      ),
      extra: null,
    };
  });
  return response;
}

async function bulkScore(
  c: DiscoveryContext,
  ids: readonly string[]
): Promise<Response> {
  const jobs = await getUserJobs(c.db, c.scope, ids);
  const postingIds = [...jobs.values()].map((job) => job.posting_id);
  const version = await currentVersion(c);
  const queued = await enqueueScoring(c.env, c.db, c.scope, {
    postingIds,
    profileVersion: version.profileVersion,
    now: c.now,
    retryFailed: true,
  });
  const status = new Map<string, "cached" | "queued">();
  for (const id of [...queued.queued, ...queued.pending]) {
    status.set(id, "queued");
  }
  for (const id of queued.cached) {
    status.set(id, "cached");
  }
  const results: BulkResult[] = ids.map((id) => {
    const job = jobs.get(id);
    if (!job) {
      return { user_job_id: id, status: "not_found" };
    }
    const scoreStatus = status.get(job.posting_id);
    return scoreStatus
      ? {
          user_job_id: id,
          status: "ok",
          inbox_state: job.inbox_state,
          score_status: scoreStatus,
        }
      : {
          user_job_id: id,
          status: "invalid",
          inbox_state: job.inbox_state,
          error: "The score could not be queued; retry later.",
        };
  });
  return c.respond({ results });
}

function storedMode(value: string | null): ApplicationMode {
  return (APPLICATION_MODES as readonly string[]).includes(value ?? "")
    ? (value as ApplicationMode)
    : USER_SETTINGS_DEFAULTS.default_mode;
}

interface TrackPlan {
  results: BulkResult[];
  statements: D1PreparedStatement[];
}

async function planTracks(
  c: DiscoveryContext,
  ids: readonly string[]
): Promise<TrackPlan> {
  const mode = storedMode(await defaultModeOf(c.db, c.scope));
  const plan = await planTrackApplications(c.db, c.scope, {
    userJobIds: ids.slice(0, TRACK_BULK_MAX),
    now: c.now,
    actorKind: c.actorKind,
    source: c.changeSource,
    mode,
    idempotencyKey: c.idempotencyKey ?? undefined,
  });
  const results: BulkResult[] = plan.results.map((result) =>
    result.applicationId === null
      ? { user_job_id: result.userJobId, status: "not_found" }
      : {
          user_job_id: result.userJobId,
          status: "ok",
          inbox_state: "tracked",
          application_id: result.applicationId,
        }
  );
  return { results, statements: plan.statements };
}

/** `POST /api/v1/inbox:bulk`. */
export async function inboxBulk(
  c: DiscoveryContext,
  body: InboxBulkRequest
): Promise<Response> {
  const ids = body.user_job_ids;
  if (body.action === "score") {
    return await bulkScore(c, ids);
  }
  if (body.action === "track") {
    const { response } = await commitPlanned(c, async () => {
      const plan = await planTracks(c, ids);
      return {
        status: 200,
        body: { results: plan.results },
        statements: plan.statements,
        extra: null,
      };
    });
    return response;
  }
  return await bulkState(c, ids, body.action);
}
