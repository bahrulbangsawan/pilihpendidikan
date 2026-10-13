import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  BoardResponse,
  CreateOfferRequest,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  CreateInterviewRequestSchema,
  CreateOfferRequestSchema,
  MoveApplicationRequestSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  INTERVIEW_KINDS,
  OFFER_STATUSES,
  SALARY_PERIODS,
  STAGES,
} from "@pilihpendidikan/jobs-contracts/enums";
import { z } from "zod";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { json, text } from "../helpers";
import { facadeScope, resolveApplication } from "../jobs/legacy/d1";
import { legacyBackendKind } from "../jobs/legacy/facade";
import type { LegacyView } from "../jobs/legacy/mapping";
import { STATUS_FOR_STAGE } from "../jobs/legacy/mapping";
import type { ToolText } from "../jobs/legacy/mcp";
import {
  isoOrNull,
  jobTrackerOff,
  mcpContext,
  parseWhen,
  withJobErrors,
} from "../jobs/legacy/mcp";
import type { LegacyContext } from "../jobs/legacy/types";
import { getProfileVersion } from "../jobs/repo/core/profile-version";
import type { JobsDb } from "../jobs/repo/core/db";
import { commitLegacyBatch } from "../jobs/repo/legacy/write";
import type { UserScope } from "../jobs/core/scope";
import { getBoard } from "../jobs/services/applications";
import { planNoteEvent } from "../jobs/services/applications/events";
import { planCreateInterview } from "../jobs/services/applications/interviews";
import { planCreateOffer } from "../jobs/services/applications/offers";
import { planMove } from "../jobs/services/applications/update";

// The board tools of 06 §11 / 05 §14 (`jobs_board`, `jobs_move`,
// `jobs_note_add`, `jobs_interview_add`, `jobs_offer_add`). They act on the
// Job Tracker (JOBS_DB) and call the same board services as the web and the
// CLI, as the `mcp` actor. `job_id` is a legacy job id (as `jobs_list` shows
// it) or an application id (`app_…`, as `jobs_board` shows it). MCP never
// purges, never creates automation tasks and never enables rules.

const NOT_SIGNED_IN = text("Not signed in.");

const JOB_ID = z
  .string()
  .min(1)
  .describe(
    "Job identifier: a legacy job id (as jobs_list shows it) or an application id (app_…, as jobs_board shows it)"
  );

interface Resolved {
  ctx: LegacyContext;
  db: JobsDb;
  scope: UserScope;
  view: LegacyView;
}

/** The caller's live application behind `jobId`, or the refusal to return. */
async function applicationOf(
  env: Env,
  caller: Caller,
  jobId: string
): Promise<Resolved | ToolText> {
  const ctx = mcpContext(env, caller);
  const off = await jobTrackerOff(env, ctx.now);
  if (off) {
    return off;
  }
  const kind = await legacyBackendKind(env, ctx.now);
  const found = await resolveApplication(ctx, jobId, {
    kvFallback: kind === "d1",
  });
  if (!found.view) {
    return text(`Job "${jobId}" not found.`);
  }
  return { ctx, db: found.db, scope: found.scope, view: found.view };
}

function isRefusal(value: Resolved | ToolText): value is ToolText {
  return "content" in value;
}

function issuesText(error: z.ZodError): string {
  return `Invalid input: ${error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ")}`;
}

type BoardCard = BoardResponse["columns"][number]["cards"][number];

function compactCard(card: BoardCard) {
  return {
    application_id: card.id,
    job_id: card.legacy_job_id ?? card.id,
    title: card.posting.title,
    company: card.posting.company_name,
    stage: card.stage,
    status: STATUS_FOR_STAGE[card.stage],
    submission_status: card.submission_status,
    priority: card.priority,
    revision: card.revision,
    follow_up_at: isoOrNull(card.follow_up_at),
    follow_up_due: card.follow_up_due,
    next_interview_at: isoOrNull(card.next_interview_at),
    latest_offer_status: card.latest_offer_status,
    score: card.score?.score ?? null,
    live_task: card.live_task?.state ?? null,
    archived: card.archived,
  };
}

function applicationSummary(app: {
  id: string;
  legacy_job_id: string | null;
  revision: number;
  stage: (typeof STAGES)[number];
}) {
  return {
    application_id: app.id,
    job_id: app.legacy_job_id ?? app.id,
    stage: app.stage,
    status: STATUS_FOR_STAGE[app.stage],
    revision: app.revision,
  };
}

interface OfferArgs {
  base?: number;
  bonus?: string;
  currency?: string;
  deadline_at?: string;
  equity?: string;
  move_application?: boolean;
  notes?: string;
  period?: (typeof SALARY_PERIODS)[number];
  raw?: string;
  received_at?: string;
  status?: (typeof OFFER_STATUSES)[number];
}

/** The validated `POST …/offers` body of a jobs_offer_add call, or a refusal. */
function offerBody(
  args: OfferArgs,
  now: number
): CreateOfferRequest | ToolText {
  const receivedAt =
    args.received_at === undefined ? now : parseWhen(args.received_at);
  const deadlineAt =
    args.deadline_at === undefined ? null : parseWhen(args.deadline_at);
  if (receivedAt === null || (args.deadline_at && deadlineAt === null)) {
    return text("received_at / deadline_at must be ISO dates or date-times.");
  }
  const compensation = Object.fromEntries(
    Object.entries({
      base: args.base,
      currency: args.currency,
      period: args.period,
      bonus: args.bonus,
      equity: args.equity,
      raw: args.raw,
    }).filter(([, value]) => value !== undefined)
  );
  const body = CreateOfferRequestSchema.safeParse({
    received_at: receivedAt,
    compensation,
    deadline_at: deadlineAt,
    status: args.status,
    notes: args.notes,
    move_application: args.move_application,
  });
  return body.success ? body.data : text(issuesText(body.error));
}

export function registerJobsBoardTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  server.registerTool(
    "jobs_board",
    {
      description:
        "Show your Job Tracker board: your applications by stage (saved, preparing, ready, applied, interviewing, offer, accepted, rejected, withdrawn; empty stages are omitted) with counts, follow-ups and next interviews.",
      inputSchema: {
        stage: z
          .enum(STAGES)
          .optional()
          .describe("Only this column (default: every column)"),
        include_archived: z
          .boolean()
          .optional()
          .describe("Include archived cards (default: false)"),
      },
    },
    ({ stage, include_archived }) =>
      withJobErrors(async () => {
        if (!caller) {
          return NOT_SIGNED_IN;
        }
        const ctx = mcpContext(env, caller);
        const off = await jobTrackerOff(env, ctx.now);
        if (off) {
          return off;
        }
        const { db, scope } = await facadeScope(ctx);
        const board = await getBoard(db, scope, {
          now: ctx.now,
          profileVersion: await getProfileVersion(env, db, scope, ctx, {
            email: caller.email,
          }),
          includeArchived: include_archived === true,
          identityDb: env.DB,
        });
        return json({
          generated_at: isoOrNull(board.generated_at),
          counts: board.counts,
          columns: board.columns
            // One stage when asked; otherwise the non-empty columns.
            .filter((column) =>
              stage === undefined ? column.total > 0 : column.stage === stage
            )
            .map((column) => ({
              stage: column.stage,
              total: column.total,
              has_more: column.has_more,
              cards: column.cards.map(compactCard),
            })),
        });
      })
  );

  server.registerTool(
    "jobs_move",
    {
      description:
        "Move a job to another board stage and/or position (the board rules apply: e.g. saved → applied → interviewing → offer → accepted; any open job → rejected or withdrawn). Omit base_revision to move the job as it is now.",
      inputSchema: {
        job_id: JOB_ID,
        stage: z.enum(STAGES).describe("Target stage"),
        before_id: z
          .string()
          .optional()
          .describe("Application id (app_…) of the card to place it below"),
        after_id: z
          .string()
          .optional()
          .describe("Application id (app_…) of the card to place it above"),
        base_revision: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("The revision you last saw (409-style refusal if stale)"),
      },
    },
    (args) =>
      withJobErrors(async () => {
        if (!caller) {
          return NOT_SIGNED_IN;
        }
        const found = await applicationOf(env, caller, args.job_id);
        if (isRefusal(found)) {
          return found;
        }
        const body = MoveApplicationRequestSchema.safeParse({
          stage: args.stage,
          before_id: args.before_id ?? null,
          after_id: args.after_id ?? null,
        });
        if (!body.success) {
          return text(issuesText(body.error));
        }
        const write = await planMove(found.db, found.scope, {
          actor: "mcp",
          actorDeviceId: null,
          now: found.ctx.now,
          source: "mcp",
          applicationId: found.view.application.id,
          baseRevision: args.base_revision ?? found.view.application.revision,
          body: {
            stage: body.data.stage,
            before_id: body.data.before_id ?? null,
            after_id: body.data.after_id ?? null,
          },
        });
        await commitLegacyBatch(found.db, write.statements);
        return json(applicationSummary(write.application));
      })
  );

  server.registerTool(
    "jobs_note_add",
    {
      description:
        "Add a timestamped note to a job's timeline (e.g. a recruiter call). Notes are kept in the job's history.",
      inputSchema: {
        job_id: JOB_ID,
        text: z.string().min(1).max(10_000).describe("The note"),
      },
    },
    (args) =>
      withJobErrors(async () => {
        if (!caller) {
          return NOT_SIGNED_IN;
        }
        const found = await applicationOf(env, caller, args.job_id);
        if (isRefusal(found)) {
          return found;
        }
        const plan = await planNoteEvent(found.db, found.scope, {
          actor: "mcp",
          actorDeviceId: null,
          applicationId: found.view.application.id,
          now: found.ctx.now,
          body: {
            type: "note_added",
            payload: { text: args.text },
            idempotency_key: `mcp:${crypto.randomUUID()}`,
          },
        });
        await commitLegacyBatch(found.db, plan.statements);
        return text(
          `Note added to job "${args.job_id}" (event id: ${plan.event.id}).`
        );
      })
  );

  server.registerTool(
    "jobs_interview_add",
    {
      description:
        "Record an interview for a job. The first interview of an applied job moves it to interviewing unless move_application is false.",
      inputSchema: {
        job_id: JOB_ID,
        kind: z
          .enum(INTERVIEW_KINDS)
          .optional()
          .describe("Interview kind (default: other)"),
        scheduled_at: z
          .string()
          .optional()
          .describe(
            "When: ISO date-time (e.g. 2026-10-20T14:00:00+07:00) or date (09:00 UTC)"
          ),
        duration_min: z.number().int().min(1).max(1440).optional(),
        timezone: z
          .string()
          .optional()
          .describe("IANA time zone for display, e.g. Asia/Jakarta"),
        location: z
          .string()
          .max(500)
          .optional()
          .describe("Address or meeting URL"),
        interviewers: z.array(z.string().max(200)).max(20).optional(),
        notes: z.string().max(10_000).optional(),
        move_application: z
          .boolean()
          .optional()
          .describe("Move an applied job to interviewing (default: true)"),
      },
    },
    (args) =>
      withJobErrors(async () => {
        if (!caller) {
          return NOT_SIGNED_IN;
        }
        const found = await applicationOf(env, caller, args.job_id);
        if (isRefusal(found)) {
          return found;
        }
        const scheduledAt =
          args.scheduled_at === undefined ? null : parseWhen(args.scheduled_at);
        if (args.scheduled_at !== undefined && scheduledAt === null) {
          return text("scheduled_at must be an ISO date or date-time.");
        }
        const body = CreateInterviewRequestSchema.safeParse({
          kind: args.kind ?? "other",
          scheduled_at: scheduledAt,
          duration_min: args.duration_min,
          timezone: args.timezone,
          location: args.location,
          interviewers: args.interviewers,
          notes: args.notes,
          move_application: args.move_application,
        });
        if (!body.success) {
          return text(issuesText(body.error));
        }
        const write = await planCreateInterview(found.db, found.scope, {
          actor: "mcp",
          actorDeviceId: null,
          now: found.ctx.now,
          source: "mcp",
          applicationId: found.view.application.id,
          body: body.data,
        });
        await commitLegacyBatch(found.db, write.statements);
        return json({
          interview: {
            ...write.interview,
            scheduled_at: isoOrNull(write.interview.scheduled_at),
          },
          application: applicationSummary(
            write.application ?? found.view.application
          ),
        });
      })
  );

  server.registerTool(
    "jobs_offer_add",
    {
      description:
        "Record an offer for a job. Recording an offer moves an applied or interviewing job to offer, and an accepted offer moves it to accepted, unless move_application is false.",
      inputSchema: {
        job_id: JOB_ID,
        received_at: z
          .string()
          .optional()
          .describe(
            "When the offer arrived (ISO date or date-time; default now)"
          ),
        base: z.number().min(0).optional().describe("Base compensation"),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe("ISO currency code, e.g. IDR"),
        period: z.enum(SALARY_PERIODS).optional(),
        bonus: z.string().max(200).optional(),
        equity: z.string().max(200).optional(),
        raw: z
          .string()
          .max(500)
          .optional()
          .describe("Compensation as written in the offer"),
        deadline_at: z
          .string()
          .optional()
          .describe("Reply deadline (ISO date or date-time)"),
        status: z.enum(OFFER_STATUSES).optional(),
        notes: z.string().max(10_000).optional(),
        move_application: z
          .boolean()
          .optional()
          .describe("Move the job's stage with the offer (default: true)"),
      },
    },
    (args) =>
      withJobErrors(async () => {
        if (!caller) {
          return NOT_SIGNED_IN;
        }
        const found = await applicationOf(env, caller, args.job_id);
        if (isRefusal(found)) {
          return found;
        }
        const body = offerBody(args, found.ctx.now);
        if ("content" in body) {
          return body;
        }
        const write = await planCreateOffer(found.db, found.scope, {
          actor: "mcp",
          actorDeviceId: null,
          now: found.ctx.now,
          source: "mcp",
          applicationId: found.view.application.id,
          body,
        });
        await commitLegacyBatch(found.db, write.statements);
        return json({
          offer: {
            ...write.offer,
            received_at: isoOrNull(write.offer.received_at),
            deadline_at: isoOrNull(write.offer.deadline_at),
          },
          application: applicationSummary(
            write.application ?? found.view.application
          ),
        });
      })
  );
}
