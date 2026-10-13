// 05 §5 — the Kanban board, applications, timeline, interviews and offers
// (06). Owner: leaf-2.3. Logic lives in services/applications; every write
// is one batch through `c.commit` (mutation + change_log + idempotency row).
// A guard that fails at commit time (a concurrent write between planning and
// commit) answers 409 `revision_conflict` with the re-read `details.current`.

import { normalizeEmail } from "../../../auth";
import { resolveOwner } from "../../../ownership";
import type { RouteContext } from "../../core/context";
import type { CommitResponse } from "../../core/context";
import { etagOf, ifNoneMatches, notModified } from "../../core/etag";
import { apiError, notFound, revisionConflict } from "../../core/http";
import { parsePage } from "../../core/pagination";
import { baseRevision } from "../../core/revision";
import { defineRoute, fromContract } from "../../core/router";
import { postingTitleOf } from "../../repo/applications/applications";
import { loadApplication } from "../../repo/core/application-state";
import { GuardFailedError, UniqueViolationError } from "../../repo/core/db";
import { getProfileVersion } from "../../repo/core/profile-version";
import {
  getApplicationDetail,
  getBoard,
  planTrackApplication,
} from "../../services/applications";
import { listCards } from "../../services/applications/board";
import {
  eventForKey,
  listTimeline,
  planNoteEvent,
} from "../../services/applications/events";
import { interviewIcs } from "../../services/applications/ics";
import {
  getInterview,
  listInterviews,
  planCreateInterview,
  planDeleteInterview,
  planUpdateInterview,
} from "../../services/applications/interviews";
import {
  getOffer,
  listOffers,
  planCreateOffer,
  planDeleteOffer,
  planUpdateOffer,
} from "../../services/applications/offers";
import {
  planPurge,
  removePurgedObjects,
} from "../../services/applications/purge";
import { planSubmission } from "../../services/applications/submission";
import type { WriteContext } from "../../services/applications/update";
import {
  planArchive,
  planMove,
  planUpdate,
} from "../../services/applications/update";

type AnyContext = RouteContext<unknown, unknown, unknown>;

/** Who writes: MCP OAuth credentials act as `mcp`, everything else as the user. */
function writer(c: AnyContext): WriteContext {
  return {
    actor: c.changeSource === "mcp" ? "mcp" : c.actorKind,
    actorDeviceId: c.device?.id ?? null,
    now: c.now,
    source: c.changeSource,
  };
}

function profileVersionOf(c: AnyContext): Promise<number> {
  return getProfileVersion(c.env, c.db, c.scope, c, {
    email: c.caller.email,
  });
}

/**
 * Commits a planned write (or answers without one). A guard failure means
 * the record changed after it was read: 409 with the current record.
 */
async function commitPlanned(
  c: AnyContext,
  statements: readonly D1PreparedStatement[],
  response: CommitResponse,
  current: () => Promise<unknown>
): Promise<Response> {
  if (statements.length === 0) {
    return c.respond(response.body, response.status ?? 200, response.headers);
  }
  try {
    return await c.commit(statements, response);
  } catch (err) {
    if (!(err instanceof GuardFailedError)) {
      throw err;
    }
    const latest = await current();
    if (latest === null || latest === undefined) {
      throw notFound();
    }
    throw revisionConflict(
      latest,
      "The resource changed while this request ran. Re-read it and retry."
    );
  }
}

function currentApplication(c: AnyContext, id: string) {
  return () => loadApplication(c.db, c.scope, id);
}

async function assertOwnsBaseCv(c: AnyContext, cvId: string): Promise<void> {
  const owner = await resolveOwner(c.env, "cv", cvId);
  if (!owner || normalizeEmail(owner) !== normalizeEmail(c.caller.email)) {
    throw notFound("Base CV not found.");
  }
}

export const routes = [
  // --- board and lists ---------------------------------------------------------
  defineRoute({
    ...fromContract("GET /api/v1/board"),
    async handler(c) {
      const body = await getBoard(c.db, c.scope, {
        now: c.now,
        profileVersion: await profileVersionOf(c),
        includeArchived: c.queryData.include_archived === "1",
        identityDb: c.env.DB,
      });
      // The tag ignores `generated_at`, so an unchanged board answers 304.
      const etag = await etagOf({ ...body, generated_at: 0 });
      if (ifNoneMatches(c.request, etag)) {
        return notModified(etag, c.requestId);
      }
      return c.respond(body, 200, { ETag: etag });
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/applications"),
    async handler(c) {
      const page = parsePage(c.queryData);
      const body = await listCards(c.db, c.scope, {
        ...page,
        now: c.now,
        profileVersion: await profileVersionOf(c),
        includeArchived: c.queryData.include_archived === "1",
        stage: c.queryData.stage ?? null,
        q: c.queryData.q?.trim() ? c.queryData.q.trim() : null,
        identityDb: c.env.DB,
      });
      return c.respond(body);
    },
  }),

  // --- track, detail, edit, move, submission -----------------------------------
  defineRoute({
    ...fromContract("POST /api/v1/applications"),
    async handler(c) {
      const input = {
        userJobId: c.body.user_job_id,
        stage: c.body.stage,
        mode: c.body.mode,
        now: c.now,
        actorKind: writer(c).actor,
        source: c.changeSource,
        idempotencyKey: c.idempotencyKey ?? undefined,
      };
      const plan = await planTrackApplication(c.db, c.scope, input);
      if (!plan.created) {
        return c.respond({ application: plan.application }, 200);
      }
      try {
        return await c.commit(plan.statements, {
          status: 201,
          body: { application: plan.application },
        });
      } catch (err) {
        if (
          !(err instanceof UniqueViolationError && err.table === "applications")
        ) {
          throw err;
        }
        // A concurrent request tracked the same user_job first.
        const winner = await planTrackApplication(c.db, c.scope, input);
        return c.respond({ application: winner.application }, 200);
      }
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/applications/{app_id}"),
    async handler(c) {
      const detail = await getApplicationDetail(
        c.db,
        c.scope,
        c.params.app_id,
        { profileVersion: await profileVersionOf(c) }
      );
      return c.respond(detail);
    },
  }),
  defineRoute({
    ...fromContract("PATCH /api/v1/applications/{app_id}"),
    async handler(c) {
      const base = c.baseRevision(c.body.base_revision);
      const { base_revision: _base, ...body } = c.body;
      if (body.base_cv_id) {
        await assertOwnsBaseCv(c, body.base_cv_id);
      }
      const write = await planUpdate(c.db, c.scope, {
        ...writer(c),
        applicationId: c.params.app_id,
        baseRevision: base,
        body,
      });
      return await commitPlanned(
        c,
        write.statements,
        { body: { application: write.application } },
        currentApplication(c, c.params.app_id)
      );
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/applications/{app_id}/move"),
    async handler(c) {
      const base = c.baseRevision(c.body.base_revision);
      const write = await planMove(c.db, c.scope, {
        ...writer(c),
        applicationId: c.params.app_id,
        baseRevision: base,
        body: {
          stage: c.body.stage,
          before_id: c.body.before_id ?? null,
          after_id: c.body.after_id ?? null,
        },
      });
      return await commitPlanned(
        c,
        write.statements,
        { body: { application: write.application } },
        currentApplication(c, c.params.app_id)
      );
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/applications/{app_id}/submission"),
    async handler(c) {
      const base = c.baseRevision(c.body.base_revision);
      const write = await planSubmission(c.db, c.scope, {
        ...writer(c),
        applicationId: c.params.app_id,
        baseRevision: base,
        body: c.body,
      });
      return await commitPlanned(
        c,
        write.statements,
        { body: { application: write.application, evidence: write.evidence } },
        currentApplication(c, c.params.app_id)
      );
    },
  }),
  defineRoute({
    ...fromContract("DELETE /api/v1/applications/{app_id}"),
    async handler(c) {
      const base = baseRevision(c.request, c.queryData.base_revision, {
        optional: true,
      });
      const id = c.params.app_id;
      if (c.queryData.purge !== "1") {
        const write = await planArchive(c.db, c.scope, {
          ...writer(c),
          applicationId: id,
          baseRevision: base,
        });
        return await commitPlanned(
          c,
          write.statements,
          {
            body: {
              id,
              archived: true,
              purged: false,
              application: write.application,
            },
          },
          currentApplication(c, id)
        );
      }
      if (c.changeSource === "mcp") {
        // 06 §11: purge is never exposed to MCP clients.
        throw apiError(
          "policy_violation",
          "Purging an application is not available to MCP clients."
        );
      }
      const plan = await planPurge(c.db, c.scope, {
        applicationId: id,
        baseRevision: base,
        now: c.now,
      });
      const response = await commitPlanned(
        c,
        plan.statements,
        { body: { id, archived: false, purged: true, application: null } },
        currentApplication(c, id)
      );
      await removePurgedObjects(c.env, c.scope, plan, {
        ownerEmail: c.caller.email,
        requestId: c.requestId,
      });
      return response;
    },
  }),

  // --- timeline ----------------------------------------------------------------
  defineRoute({
    ...fromContract("GET /api/v1/applications/{app_id}/events"),
    async handler(c) {
      const page = parsePage(c.queryData);
      const body = await listTimeline(c.db, c.scope, {
        applicationId: c.params.app_id,
        ...page,
        includeHidden: c.query.get("include_hidden") === "1",
      });
      return c.respond(body);
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/applications/{app_id}/events"),
    async handler(c) {
      const w = writer(c);
      const plan = await planNoteEvent(c.db, c.scope, {
        applicationId: c.params.app_id,
        body: c.body,
        actor: w.actor,
        actorDeviceId: w.actorDeviceId,
        now: c.now,
      });
      if (plan.replay) {
        return c.respond({ event: plan.event }, 201);
      }
      try {
        return await c.commit(plan.statements, {
          status: 201,
          body: { event: plan.event },
        });
      } catch (err) {
        if (
          !(err instanceof UniqueViolationError) ||
          err.table !== "application_events"
        ) {
          throw err;
        }
        const winner = await eventForKey(c.db, c.scope, c.body.idempotency_key);
        if (
          winner?.application_id !== c.params.app_id ||
          winner.type !== c.body.type
        ) {
          throw apiError(
            "duplicate",
            "This idempotency_key already belongs to another event."
          );
        }
        return c.respond({ event: winner }, 201);
      }
    },
  }),

  // --- interviews ----------------------------------------------------------------
  defineRoute({
    ...fromContract("GET /api/v1/applications/{app_id}/interviews"),
    async handler(c) {
      const page = parsePage(c.queryData);
      return c.respond(
        await listInterviews(c.db, c.scope, {
          applicationId: c.params.app_id,
          ...page,
        })
      );
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/applications/{app_id}/interviews"),
    async handler(c) {
      const write = await planCreateInterview(c.db, c.scope, {
        ...writer(c),
        applicationId: c.params.app_id,
        body: c.body,
      });
      const body = write.application
        ? { interview: write.interview, application: write.application }
        : { interview: write.interview };
      return await commitPlanned(
        c,
        write.statements,
        { status: 201, body },
        currentApplication(c, c.params.app_id)
      );
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/applications/{app_id}/interviews/{ivw_id}"),
    async handler(c) {
      const interview = await getInterview(
        c.db,
        c.scope,
        c.params.app_id,
        c.params.ivw_id
      );
      return c.respond({ interview });
    },
  }),
  defineRoute({
    ...fromContract(
      "GET /api/v1/applications/{app_id}/interviews/{ivw_id}.ics"
    ),
    async handler(c) {
      const interview = await getInterview(
        c.db,
        c.scope,
        c.params.app_id,
        c.params.ivw_id
      );
      const posting = await postingTitleOf(c.db, c.scope, c.params.app_id);
      if (!posting || interview.scheduled_at === null) {
        throw notFound("This interview has no scheduled time to export.");
      }
      return new Response(interviewIcs(interview, posting, c.now), {
        status: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="interview-${interview.id}.ics"`,
          "Cache-Control": "private, no-store",
        },
      });
    },
  }),
  defineRoute({
    ...fromContract("PATCH /api/v1/applications/{app_id}/interviews/{ivw_id}"),
    async handler(c) {
      const base = c.baseRevision(c.body.base_revision);
      const { base_revision: _base, ...body } = c.body;
      const write = await planUpdateInterview(c.db, c.scope, {
        ...writer(c),
        applicationId: c.params.app_id,
        interviewId: c.params.ivw_id,
        baseRevision: base,
        body,
      });
      return await commitPlanned(
        c,
        write.statements,
        { body: { interview: write.interview } },
        () =>
          getInterview(c.db, c.scope, c.params.app_id, c.params.ivw_id).catch(
            () => null
          )
      );
    },
  }),
  defineRoute({
    ...fromContract("DELETE /api/v1/applications/{app_id}/interviews/{ivw_id}"),
    async handler(c) {
      const write = await planDeleteInterview(c.db, c.scope, {
        ...writer(c),
        applicationId: c.params.app_id,
        interviewId: c.params.ivw_id,
        baseRevision: baseRevision(c.request, c.queryData.base_revision, {
          optional: true,
        }),
      });
      return await commitPlanned(
        c,
        write.statements,
        { body: { id: c.params.ivw_id, deleted: true } },
        () =>
          getInterview(c.db, c.scope, c.params.app_id, c.params.ivw_id).catch(
            () => null
          )
      );
    },
  }),

  // --- offers ----------------------------------------------------------------------
  defineRoute({
    ...fromContract("GET /api/v1/applications/{app_id}/offers"),
    async handler(c) {
      const page = parsePage(c.queryData);
      return c.respond(
        await listOffers(c.db, c.scope, {
          applicationId: c.params.app_id,
          ...page,
        })
      );
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/applications/{app_id}/offers"),
    async handler(c) {
      const write = await planCreateOffer(c.db, c.scope, {
        ...writer(c),
        applicationId: c.params.app_id,
        body: c.body,
      });
      const body = write.application
        ? { offer: write.offer, application: write.application }
        : { offer: write.offer };
      return await commitPlanned(
        c,
        write.statements,
        { status: 201, body },
        currentApplication(c, c.params.app_id)
      );
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/applications/{app_id}/offers/{ofr_id}"),
    async handler(c) {
      const offer = await getOffer(
        c.db,
        c.scope,
        c.params.app_id,
        c.params.ofr_id
      );
      return c.respond({ offer });
    },
  }),
  defineRoute({
    ...fromContract("PATCH /api/v1/applications/{app_id}/offers/{ofr_id}"),
    async handler(c) {
      const base = c.baseRevision(c.body.base_revision);
      const { base_revision: _base, ...body } = c.body;
      const write = await planUpdateOffer(c.db, c.scope, {
        ...writer(c),
        applicationId: c.params.app_id,
        offerId: c.params.ofr_id,
        baseRevision: base,
        body,
      });
      const responseBody = write.application
        ? { offer: write.offer, application: write.application }
        : { offer: write.offer };
      return await commitPlanned(
        c,
        write.statements,
        { body: responseBody },
        () =>
          getOffer(c.db, c.scope, c.params.app_id, c.params.ofr_id).catch(
            () => null
          )
      );
    },
  }),
  defineRoute({
    ...fromContract("DELETE /api/v1/applications/{app_id}/offers/{ofr_id}"),
    async handler(c) {
      const write = await planDeleteOffer(c.db, c.scope, {
        ...writer(c),
        applicationId: c.params.app_id,
        offerId: c.params.ofr_id,
        baseRevision: baseRevision(c.request, c.queryData.base_revision, {
          optional: true,
        }),
      });
      return await commitPlanned(
        c,
        write.statements,
        { body: { id: c.params.ofr_id, deleted: true } },
        () =>
          getOffer(c.db, c.scope, c.params.app_id, c.params.ofr_id).catch(
            () => null
          )
      );
    },
  }),
];
