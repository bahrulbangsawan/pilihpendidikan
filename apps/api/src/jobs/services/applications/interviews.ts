// Interviews (06 §6.1, 05 §5 `/applications/{app_id}/interviews[/{ivw_id}]`).
//
// - The round auto-increments from the application's last round.
// - Creating the FIRST interview of an `applied` application moves it to
//   `interviewing` unless `move_application: false` (06 §3 toggle, default on).
// - An outcome never changes the application: `failed` does not reject it
//   (06 §6.1; rejecting is an explicit second step).

import type {
  CreateInterviewRequest,
  UpdateInterviewRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationRecord,
  InterviewRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { invalidRequest, notFound, revisionConflict } from "../../core/http";
import type { CursorKey, Page } from "../../core/pagination";
import { pageOf } from "../../core/pagination";
import type { UserScope } from "../../core/scope";
import type { InterviewChanges } from "../../repo/applications/interviews";
import {
  deleteInterviewStatements,
  insertInterviewStatements,
  interviewStats,
  listInterviewRows,
  loadInterview,
  updateInterviewStatements,
} from "../../repo/applications/interviews";
import { loadApplication } from "../../repo/core/application-state";
import type { JobsDb } from "../../repo/core/db";
import { appendEvent } from "../../repo/core/events";
import { planStageChange } from "./stage";
import type { WriteContext } from "./update";

export interface InterviewWrite {
  /** Present when the request moved the application's stage. */
  application?: ApplicationRecord;
  interview: InterviewRecord;
  statements: D1PreparedStatement[];
}

/** Throws 400 unless `zone` is an IANA time zone the runtime knows. */
export function assertTimeZone(zone: string | null | undefined): void {
  if (zone === null || zone === undefined) {
    return;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
  } catch {
    throw invalidRequest(`Unknown time zone "${zone}".`);
  }
}

async function ownedApplication(
  db: JobsDb,
  scope: UserScope,
  applicationId: string
): Promise<ApplicationRecord> {
  const app = await loadApplication(db, scope, applicationId);
  if (!app) {
    throw notFound("Application not found.");
  }
  return app;
}

/** One interview of the caller's application; 404 otherwise. */
export async function getInterview(
  db: JobsDb,
  scope: UserScope,
  applicationId: string,
  interviewId: string
): Promise<InterviewRecord> {
  const interview = await loadInterview(db, scope, applicationId, interviewId);
  if (!interview) {
    throw notFound("Interview not found.");
  }
  return interview;
}

/** The application's interviews by round. */
export async function listInterviews(
  db: JobsDb,
  scope: UserScope,
  query: { applicationId: string; cursor: CursorKey | null; limit: number }
): Promise<Page<InterviewRecord>> {
  await ownedApplication(db, scope, query.applicationId);
  const rows = await listInterviewRows(db, scope, query);
  return pageOf(rows, query.limit, (row) => [row.round, row.id]);
}

function eventPayload(interview: InterviewRecord): Record<string, unknown> {
  return {
    interview_id: interview.id,
    kind: interview.kind,
    round: interview.round,
    scheduled_at: interview.scheduled_at,
    outcome: interview.outcome,
  };
}

/** Plans `POST …/interviews`. */
export async function planCreateInterview(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & { applicationId: string; body: CreateInterviewRequest }
): Promise<InterviewWrite> {
  const { body, now } = input;
  assertTimeZone(body.timezone);
  const app = await ownedApplication(db, scope, input.applicationId);
  const stats = await interviewStats(db, scope, app.id);
  const interview: InterviewRecord = {
    id: newId("ivw", now),
    user_id: scope.userId,
    application_id: app.id,
    round: body.round ?? stats.maxRound + 1,
    kind: body.kind,
    scheduled_at: body.scheduled_at ?? null,
    duration_min: body.duration_min ?? null,
    timezone: body.timezone ?? null,
    location: body.location ?? null,
    interviewers: body.interviewers ?? [],
    outcome: body.outcome ?? "pending",
    notes: body.notes ?? "",
    revision: 1,
    created_at: now,
    updated_at: now,
  };
  const statements = [
    ...insertInterviewStatements(db, scope, interview),
    ...appendEvent(
      db,
      scope,
      {
        applicationId: app.id,
        type: "interview_scheduled",
        actorKind: input.actor,
        actorDeviceId: input.actorDeviceId,
        payload: eventPayload(interview),
      },
      now
    ).statements,
  ];
  const move =
    (body.move_application ?? true) &&
    stats.count === 0 &&
    app.stage === "applied";
  if (!move) {
    return { interview, statements };
  }
  const stage = await planStageChange(db, scope, {
    applicationId: app.id,
    to: "interviewing",
    reason: "interview_scheduled",
    actor: input.actor,
    actorDeviceId: input.actorDeviceId,
    source: input.source,
    now,
  });
  return {
    interview,
    application: stage.application,
    statements: [...stage.statements, ...statements],
  };
}

function changedInterviewFields(
  current: InterviewRecord,
  body: Omit<UpdateInterviewRequest, "base_revision" | "move_application">
): InterviewChanges {
  const changes: InterviewChanges = {};
  const keys = [
    "round",
    "kind",
    "scheduled_at",
    "duration_min",
    "timezone",
    "location",
    "outcome",
    "notes",
  ] as const;
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== current[key]) {
      Object.assign(changes, { [key]: value });
    }
  }
  if (
    body.interviewers !== undefined &&
    JSON.stringify(body.interviewers) !== JSON.stringify(current.interviewers)
  ) {
    changes.interviewers = body.interviewers;
  }
  return changes;
}

/** Plans `PATCH …/interviews/{ivw_id}` (strict base_revision). */
export async function planUpdateInterview(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & {
    applicationId: string;
    baseRevision: number;
    body: Omit<UpdateInterviewRequest, "base_revision">;
    interviewId: string;
  }
): Promise<InterviewWrite> {
  const { body, now } = input;
  assertTimeZone(body.timezone);
  const current = await getInterview(
    db,
    scope,
    input.applicationId,
    input.interviewId
  );
  if (current.revision !== input.baseRevision) {
    throw revisionConflict(
      current,
      `Interview changed since revision ${input.baseRevision} (now ${current.revision}).`
    );
  }
  const changes = changedInterviewFields(current, body);
  if (Object.keys(changes).length === 0) {
    return { interview: current, statements: [] };
  }
  const interview: InterviewRecord = {
    ...current,
    ...changes,
    revision: current.revision + 1,
    updated_at: now,
  };
  return {
    interview,
    statements: [
      ...updateInterviewStatements(
        db,
        scope,
        current.id,
        changes,
        current.revision,
        now
      ),
      ...appendEvent(
        db,
        scope,
        {
          applicationId: current.application_id,
          type: "interview_updated",
          actorKind: input.actor,
          actorDeviceId: input.actorDeviceId,
          payload: eventPayload(interview),
        },
        now
      ).statements,
    ],
  };
}

/** Plans `DELETE …/interviews/{ivw_id}` (optional base_revision / If-Match). */
export async function planDeleteInterview(
  db: JobsDb,
  scope: UserScope,
  input: WriteContext & {
    applicationId: string;
    baseRevision: number | null;
    interviewId: string;
  }
): Promise<{ statements: D1PreparedStatement[] }> {
  const current = await getInterview(
    db,
    scope,
    input.applicationId,
    input.interviewId
  );
  if (input.baseRevision !== null && current.revision !== input.baseRevision) {
    throw revisionConflict(
      current,
      `Interview changed since revision ${input.baseRevision} (now ${current.revision}).`
    );
  }
  return {
    statements: [
      ...deleteInterviewStatements(db, scope, current, input.now),
      ...appendEvent(
        db,
        scope,
        {
          applicationId: current.application_id,
          type: "interview_updated",
          actorKind: input.actor,
          actorDeviceId: input.actorDeviceId,
          payload: { interview_id: current.id, deleted: true },
        },
        input.now
      ).statements,
    ],
  };
}
