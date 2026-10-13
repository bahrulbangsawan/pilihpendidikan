// The JOBS_DB backend of the legacy facade (`JOBS_LEGACY_BACKEND = d1`,
// phases P2/P3 of 06 §12.5; 06 §12.6, 05 §14).
//
//   - Reads: `toJobData` over the application, its posting and its pending
//     interviews (lossy stage → status). The URL key is the legacy id, or the
//     `app_` id of applications created elsewhere.
//   - Writes go through the board services (03 §5.1 transitions via
//     `changeStage` / `planSubmission`, so an illegal status is 422
//     `Invalid status`; "applied" is `mark_applied`), in ONE batch with the
//     posting, interview and checklist changes. A legacy PUT needs no
//     revision but is refused (409) when another source changed the
//     application in the last 5 s.
//   - Private postings are edited in place; a PUBLIC posting is forked into a
//     private `manual` copy and the user's user_job re-pointed at it.
//   - Create = a private `manual` posting + user_job + application with
//     `legacy_job_id` = the client id. Delete = archive (06 §8, never purge);
//     the archived row stays the id's tombstone until the id is re-created.
//   - P3 grace: a D1 miss for a legacy id reads `job:{id}` from KV and, when
//     the caller's stamp is on it, migrates that one job on the fly (the same
//     rows as scripts/migrate-jobs-kv-to-d1.ts).
//   - Not owned = not found. No admin bypass (D-26).

import type {
  ActorKind,
  ChangeSource,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  contentHash,
  legacyFingerprint,
  sha256Hex,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { LegacyJobSection } from "@pilihpendidikan/jobs-contracts/records";
import { canTransition } from "@pilihpendidikan/jobs-contracts/stage";
import { normalizeEmail } from "../../auth";
import type { JobData } from "../../types";
import { normalizeJobData } from "../../types";
import { isApiError } from "../core/http";
import type { UserScope } from "../core/scope";
import { scopeFromCaller } from "../core/scope";
import type { ApplicationFieldChanges } from "../repo/applications/applications";
import {
  rankRewriteStatements,
  updateFieldsStatements,
} from "../repo/applications/applications";
import type { JobsDb } from "../repo/core/db";
import {
  GuardFailedError,
  retryOnGuardFailure,
  UniqueViolationError,
} from "../repo/core/db";
import { ensureUser } from "../repo/core/users";
import { legacyFacadeDb } from "../repo/legacy/db";
import { legacyImportStatements } from "../repo/legacy/import";
import {
  findLegacyView,
  lastInterviewRound,
  legacyIdHolder,
  listLegacyRows,
} from "../repo/legacy/read";
import {
  cancelInterviewStatements,
  commitLegacyBatch,
  forkPostingStatements,
  insertInterviewStatements,
  LEGACY_STALE_WINDOW_MS,
  renameArchivedLegacyIdStatements,
  rescheduleInterviewStatements,
  staleGuardStatement,
  updatePrivatePostingStatements,
} from "../repo/legacy/write";
import { changeStage } from "../services/applications";
import { placeAtEnd } from "../services/applications/placement";
import { planSubmission } from "../services/applications/submission";
import {
  assertSectionsWithinCaps,
  planArchive,
} from "../services/applications/update";
import type { LegacyDiff, LegacyFieldInput, LegacyView } from "./mapping";
import {
  calendarDate,
  diffJobData,
  isEmptyDiff,
  isJobStatus,
  isoOf,
  legacyCompany,
  legacyKeyOf,
  legacyTitle,
  parseLegacyDate,
  planLegacyRows,
  STATUS_FOR_STAGE,
  toJobData,
  viewOfRows,
} from "./mapping";
import type {
  LegacyContext,
  LegacyJobs,
  LegacyListItem,
  LegacyPatch,
  SectionEdit,
} from "./types";
import {
  actorOf,
  CONCURRENT_WRITE,
  changeSourceOf,
  INVALID_INTERVIEW_DATE,
  INVALID_STATUS,
  LegacyError,
  STALE_WRITE,
} from "./types";

interface D1Call {
  actor: ActorKind;
  ctx: LegacyContext;
  db: JobsDb;
  scope: UserScope;
  source: ChangeSource;
}

async function callerScope(ctx: LegacyContext): Promise<UserScope> {
  const userId =
    ctx.caller.userId ??
    (await ensureUser(ctx.env.DB, normalizeEmail(ctx.caller.email), ctx.now))
      .id;
  return scopeFromCaller({ userId });
}

/** Maps kernel errors of a facade write to the legacy status + message. */
function legacyErrorOf(err: unknown): LegacyError | null {
  if (err instanceof LegacyError) {
    return err;
  }
  if (err instanceof GuardFailedError || err instanceof UniqueViolationError) {
    return new LegacyError(409, CONCURRENT_WRITE);
  }
  if (!isApiError(err)) {
    return null;
  }
  switch (err.code) {
    case "invalid_transition": {
      const reason = (err.details as { reason?: string } | undefined)?.reason;
      return new LegacyError(
        422,
        reason === "submission_in_flight" ? err.message : INVALID_STATUS
      );
    }
    case "payload_too_large":
      return new LegacyError(413, err.message);
    case "revision_conflict":
      return new LegacyError(409, CONCURRENT_WRITE);
    default:
      return new LegacyError(err.status, err.message);
  }
}

async function rethrowLegacy<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const mapped = legacyErrorOf(err);
    if (mapped?.status === 404) {
      throw new LegacyError(404, "Job not found.");
    }
    throw mapped ?? err;
  }
}

// ---------------------------------------------------------------------------
// P3: on-the-fly migration of one KV job (06 §12.5)
// ---------------------------------------------------------------------------

async function readKvJob(call: D1Call, id: string): Promise<JobData | null> {
  const kv = call.ctx.env.JOBS_KV;
  let raw: unknown;
  try {
    raw = await kv.get(`job:${id}`, "json");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const owner = await kv.get(`owner:job:${id}`);
  if (
    !owner ||
    normalizeEmail(owner) !== normalizeEmail(call.ctx.caller.email)
  ) {
    return null;
  }
  const job = normalizeJobData(raw as Partial<JobData>);
  return isJobStatus(job.status) ? job : null;
}

/**
 * Migrates `job:{id}` from KV when the caller's stamp is on it. True when the
 * job now exists in JOBS_DB (migrated here or concurrently).
 */
async function migrateFromKv(call: D1Call, id: string): Promise<boolean> {
  const job = await readKvJob(call, id);
  if (!job) {
    return false;
  }
  const { db, scope, ctx } = call;
  const rows = await planLegacyRows({
    job,
    legacyId: id,
    userId: scope.userId,
    now: ctx.now,
    rank: "i",
    mode: "import",
    actorKind: "legacy_migration",
    source: "legacy_migration",
    userJobOrigin: "legacy",
  });
  const placement = await placeAtEnd(
    db,
    scope,
    rows.application.stage,
    rows.application.id
  );
  rows.application.board_rank = placement.rank;
  const statements = legacyImportStatements(db, scope, rows);
  if (placement.rebalance) {
    statements.push(
      ...rankRewriteStatements(
        db,
        scope,
        placement.rebalance,
        rows.application.id,
        ctx.now
      )
    );
  }
  try {
    await commitLegacyBatch(db, statements);
  } catch (err) {
    if (
      !(err instanceof GuardFailedError || err instanceof UniqueViolationError)
    ) {
      throw err;
    }
    // Migrated concurrently (or the id is held): fall through to the re-read.
  }
  // Ids only: never log emails or job content (11 §8).
  console.warn({
    evt: "legacy_kv_fallback",
    job: (await sha256Hex(id)).slice(0, 12),
  });
  return true;
}

/**
 * The caller's live application for a legacy key; on a D1 miss, the P3 KV
 * fallback (never for an id whose tombstone exists: a deleted job stays
 * deleted).
 */
async function resolve(call: D1Call, key: string): Promise<LegacyView | null> {
  const view = await findLegacyView(call.db, call.scope, key);
  if (view) {
    return view;
  }
  if (await legacyIdHolder(call.db, call.scope, key)) {
    return null;
  }
  if (!(await migrateFromKv(call, key))) {
    return null;
  }
  return await findLegacyView(call.db, call.scope, key);
}

// ---------------------------------------------------------------------------
// Write planning
// ---------------------------------------------------------------------------

async function postingStatements(
  call: D1Call,
  view: LegacyView,
  diff: LegacyDiff
): Promise<D1PreparedStatement[]> {
  if (!diff.postingChanged) {
    return [];
  }
  const { db, scope, ctx } = call;
  const { posting, application } = view;
  const changes = diff.posting;
  const hash = await contentHash(
    changes.title ?? posting.title,
    changes.description_text ?? posting.description_text
  );
  if (
    posting.visibility === "private" &&
    posting.owner_user_id === scope.userId
  ) {
    return updatePrivatePostingStatements(
      db,
      scope,
      posting,
      changes,
      hash,
      ctx.now
    );
  }
  // A shared public posting is never written: fork a private copy. The
  // copy keeps every column the legacy shape does not show; an unchanged
  // empty title/company of a public posting is copied, not placeholdered.
  const newPostingId = newId("pst", ctx.now);
  return forkPostingStatements(db, scope, {
    sourcePostingId: posting.id,
    newPostingId,
    fingerprint: await legacyFingerprint(
      scope.userId,
      `fork|${posting.id}|${newPostingId}`
    ),
    changes,
    contentHash: hash,
    userJobId: application.user_job_id,
    now: ctx.now,
  });
}

async function interviewStatements(
  call: D1Call,
  view: LegacyView,
  diff: LegacyDiff
): Promise<D1PreparedStatement[]> {
  if (diff.interviewDate === undefined) {
    return [];
  }
  const { db, scope, ctx } = call;
  if (diff.interviewDate === "") {
    // Clearing the date cancels the interview the legacy view showed.
    const shown = view.interviews.find((i) => i.scheduled_at !== null);
    return shown ? cancelInterviewStatements(db, scope, shown, ctx.now) : [];
  }
  const at = parseLegacyDate(diff.interviewDate);
  if (at === null) {
    throw new LegacyError(422, INVALID_INTERVIEW_DATE);
  }
  const next = view.interviews[0];
  if (next) {
    return rescheduleInterviewStatements(db, scope, next, at, ctx.now);
  }
  const round = (await lastInterviewRound(db, scope, view.application.id)) + 1;
  return insertInterviewStatements(db, scope, {
    id: newId("ivw", ctx.now),
    applicationId: view.application.id,
    round,
    scheduledAt: at,
    now: ctx.now,
  });
}

async function applicationStatements(
  call: D1Call,
  view: LegacyView,
  stage: Stage | undefined,
  fields: ApplicationFieldChanges
): Promise<D1PreparedStatement[]> {
  const { db, scope, ctx, source, actor } = call;
  const app = view.application;
  const write = { now: ctx.now, source };
  if (stage === undefined) {
    // Posting / interview / checklist edits still bump the card (legacy
    // `updatedAt` moves on every save).
    return updateFieldsStatements(db, scope, app.id, fields, {
      ...write,
      bump: true,
      expectRevision: app.revision,
    });
  }
  if (!canTransition(app.stage, stage, "user")) {
    throw new LegacyError(422, INVALID_STATUS);
  }
  if (stage === "applied") {
    // 06 §11: a legacy "applied" is `mark_applied` (user attestation).
    const submission = await planSubmission(db, scope, {
      actor,
      actorDeviceId: null,
      now: ctx.now,
      source,
      applicationId: app.id,
      baseRevision: app.revision,
      body: { action: "mark_applied", method: "manual" },
    });
    return [
      ...submission.statements,
      ...updateFieldsStatements(db, scope, app.id, fields, {
        ...write,
        bump: false,
        expectRevision: submission.application.revision,
      }),
    ];
  }
  const plan = await changeStage(db, scope, {
    actor,
    applicationId: app.id,
    baseRevision: app.revision,
    now: ctx.now,
    source,
    to: stage,
    fields,
  });
  return plan.statements;
}

function isStale(call: D1Call, view: LegacyView): boolean {
  const app = view.application;
  return (
    app.updated_at > call.ctx.now - LEGACY_STALE_WINDOW_MS &&
    app.last_change_source !== call.source
  );
}

interface WriteInput extends LegacyFieldInput {
  followUpAt?: number | null;
}

/** The batch of one legacy write; null when it changes nothing. */
async function planWrite(
  call: D1Call,
  view: LegacyView,
  input: WriteInput,
  options: { staleGuard: boolean }
): Promise<D1PreparedStatement[] | null> {
  const diff = diffJobData(view, input);
  const fields: ApplicationFieldChanges = {};
  if (diff.sections) {
    assertSectionsWithinCaps(diff.sections);
    fields.sections = diff.sections;
  }
  if (
    input.followUpAt !== undefined &&
    input.followUpAt !== view.application.follow_up_at
  ) {
    fields.follow_up_at = input.followUpAt;
  }
  if (isEmptyDiff(diff) && fields.follow_up_at === undefined) {
    return null;
  }
  const statements: D1PreparedStatement[] = [];
  if (options.staleGuard) {
    statements.push(
      staleGuardStatement(
        call.db,
        call.scope,
        view.application.id,
        call.source,
        call.ctx.now
      )
    );
  }
  statements.push(
    ...(await postingStatements(call, view, diff)),
    ...(await interviewStatements(call, view, diff)),
    ...(await applicationStatements(call, view, diff.stage, fields))
  );
  return statements;
}

async function writeJob(
  call: D1Call,
  key: string,
  input: WriteInput,
  options: { staleGuard: boolean }
): Promise<JobData | null> {
  if (
    input.interviewDate !== undefined &&
    input.interviewDate !== "" &&
    parseLegacyDate(input.interviewDate) === null
  ) {
    throw new LegacyError(422, INVALID_INTERVIEW_DATE);
  }
  return await rethrowLegacy(() =>
    retryOnGuardFailure(async () => {
      const view = await resolve(call, key);
      if (!view) {
        return null;
      }
      if (options.staleGuard && isStale(call, view)) {
        throw new LegacyError(409, STALE_WRITE);
      }
      const statements = await planWrite(call, view, input, options);
      if (statements === null) {
        return toJobData(view);
      }
      await commitLegacyBatch(call.db, statements);
      const after = await findLegacyView(
        call.db,
        call.scope,
        legacyKeyOf(view.application)
      );
      return after ? toJobData(after) : null;
    })
  );
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

function listItemOf(row: {
  company_name: string;
  id: string;
  legacy_job_id: string | null;
  next_interview_at: number | null;
  next_interview_tz: string | null;
  source_kind: string;
  stage: Stage;
  title: string;
  updated_at: number;
}): LegacyListItem {
  return {
    id: legacyKeyOf(row),
    title: legacyTitle(row.title, row.source_kind),
    status: STATUS_FOR_STAGE[row.stage],
    company: legacyCompany(row.company_name, row.source_kind),
    interviewDate:
      row.next_interview_at === null
        ? ""
        : calendarDate(row.next_interview_at, row.next_interview_tz),
    updatedAt: isoOf(row.updated_at),
  };
}

export function createD1Backend(ctx: LegacyContext): LegacyJobs {
  let pending: Promise<D1Call> | null = null;
  const call = (): Promise<D1Call> => {
    pending ??= callerScope(ctx).then((scope) => ({
      ctx,
      scope,
      db: legacyFacadeDb(ctx.env),
      source: changeSourceOf(ctx),
      actor: actorOf(ctx),
    }));
    return pending;
  };

  return {
    kind: "d1",

    async list() {
      const c = await call();
      const rows = await listLegacyRows(c.db, c.scope);
      // KV listed keys in key order; keep that order for MCP clients.
      return rows
        .map(listItemOf)
        .sort((a, b) => (a.id < b.id ? -1 : Number(a.id > b.id)));
    },

    async get(id) {
      const view = await resolve(await call(), id);
      return view ? toJobData(view) : null;
    },

    async owns(id) {
      return (await resolve(await call(), id)) !== null;
    },

    async create(job) {
      const c = await call();
      if (job.interviewDate && parseLegacyDate(job.interviewDate) === null) {
        throw new LegacyError(422, INVALID_INTERVIEW_DATE);
      }
      return await rethrowLegacy(() =>
        retryOnGuardFailure(async () => {
          if (await resolve(c, job.id)) {
            return "exists" as const;
          }
          const holder = await legacyIdHolder(c.db, c.scope, job.id);
          const rows = await planLegacyRows({
            job,
            legacyId: job.id,
            userId: c.scope.userId,
            now: ctx.now,
            rank: "i",
            mode: "create",
            nonce: crypto.randomUUID(),
            actorKind: c.actor,
            source: c.source,
            userJobOrigin: ctx.surface === "mcp" ? "mcp" : "manual",
          });
          const placement = await placeAtEnd(
            c.db,
            c.scope,
            rows.application.stage,
            rows.application.id
          );
          rows.application.board_rank = placement.rank;
          const statements: D1PreparedStatement[] = [];
          if (holder?.archived) {
            // The id belonged to a deleted (archived) job: free it.
            statements.push(
              ...renameArchivedLegacyIdStatements(
                c.db,
                c.scope,
                holder,
                job.id,
                ctx.now
              )
            );
          }
          statements.push(...legacyImportStatements(c.db, c.scope, rows));
          if (placement.rebalance) {
            statements.push(
              ...rankRewriteStatements(
                c.db,
                c.scope,
                placement.rebalance,
                rows.application.id,
                ctx.now
              )
            );
          }
          await commitLegacyBatch(c.db, statements);
          return toJobData(viewOfRows(rows));
        })
      );
    },

    async save(id, body) {
      return await writeJob(
        await call(),
        id,
        {
          title: body.title,
          status: body.status,
          company: body.company ?? "",
          companyUrl: body.companyUrl ?? "",
          salaryRange: body.salaryRange ?? "",
          jobDescription: body.jobDescription ?? [],
          requirements: body.requirements ?? [],
          interviewDate: body.interviewDate ?? "",
          sections: body.sections,
        },
        { staleGuard: true }
      );
    },

    async update(id, patch: LegacyPatch) {
      return await writeJob(await call(), id, patch, { staleGuard: false });
    },

    async remove(id) {
      const c = await call();
      return await rethrowLegacy(() =>
        retryOnGuardFailure(async () => {
          const view = await resolve(c, id);
          if (!view) {
            return false;
          }
          // 06 §11: delete = archive; purge is never exposed here.
          const write = await planArchive(c.db, c.scope, {
            actor: c.actor,
            actorDeviceId: null,
            now: ctx.now,
            source: c.source,
            applicationId: view.application.id,
            baseRevision: view.application.revision,
          });
          await commitLegacyBatch(c.db, write.statements);
          return true;
        })
      );
    },

    async editSections<T>(
      id: string,
      edit: (sections: LegacyJobSection[]) => SectionEdit<T>
    ): Promise<T | null> {
      const c = await call();
      return await rethrowLegacy(() =>
        retryOnGuardFailure(async () => {
          const view = await resolve(c, id);
          if (!view) {
            return null;
          }
          const outcome = edit(structuredClone(view.application.sections));
          if (outcome.sections) {
            assertSectionsWithinCaps(outcome.sections);
            await commitLegacyBatch(
              c.db,
              updateFieldsStatements(
                c.db,
                c.scope,
                view.application.id,
                { sections: outcome.sections },
                {
                  bump: true,
                  expectRevision: view.application.revision,
                  now: ctx.now,
                  source: c.source,
                }
              )
            );
          }
          return outcome.result;
        })
      );
    },
  };
}

/**
 * The caller's live application behind a legacy key or `app_` id, for the
 * new MCP tools (they act on JOBS_DB in both backend modes). The KV fallback
 * runs only when the facade is on D1 (in `kv` mode KV is still the source of
 * truth for legacy ids).
 */
export async function resolveApplication(
  ctx: LegacyContext,
  key: string,
  options: { kvFallback: boolean }
): Promise<{ scope: UserScope; db: JobsDb; view: LegacyView | null }> {
  const c: D1Call = {
    ctx,
    scope: await callerScope(ctx),
    db: legacyFacadeDb(ctx.env),
    source: changeSourceOf(ctx),
    actor: actorOf(ctx),
  };
  const view = options.kvFallback
    ? await resolve(c, key)
    : await findLegacyView(c.db, c.scope, key);
  return { scope: c.scope, db: c.db, view };
}

/** The caller's scope and JOBS_DB handle (new MCP tools without an id). */
export async function facadeScope(
  ctx: LegacyContext
): Promise<{ db: JobsDb; scope: UserScope }> {
  return { scope: await callerScope(ctx), db: legacyFacadeDb(ctx.env) };
}
