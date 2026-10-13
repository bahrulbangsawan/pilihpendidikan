// 05 §5 — Applications, the Kanban board (06).
import { z } from "zod";
import {
  DeletedResponseSchema,
  ICalendarSchema,
  PageQuerySchema,
  paginated,
  RevisionSchema,
  TimestampSchema,
} from "../common";
import {
  ApplicationModeSchema,
  InterviewKindSchema,
  InterviewOutcomeSchema,
  OfferStatusSchema,
  StageSchema,
  SubmissionActionSchema,
  SubmissionMethodSchema,
} from "../enums";
import { ApplicationIdSchema, UserJobIdSchema } from "../ids";
import {
  ApplicationEventRecordSchema,
  ApplicationRecordSchema,
  ApprovalRecordSchema,
  AutomationTaskRecordSchema,
  CvVariantRecordSchema,
  EmailApplicationRecordSchema,
  InterviewRecordSchema,
  JobPostingRecordSchema,
  LegacyJobSectionSchema,
  MatchScoreRecordSchema,
  NoteAddedEventPayloadSchema,
  NoteDeletedEventPayloadSchema,
  OfferCompensationSchema,
  OfferRecordSchema,
  SubmissionEvidenceRecordSchema,
  UserJobRecordSchema,
} from "../records";
import { defineSchema } from "../registry";
import { route } from "./route";
import { BoardCardSchema, DeleteQuerySchema } from "./views";

const flag = z.enum(["0", "1"]);

// --- board and lists ---------------------------------------------------------------

export const BoardQuerySchema = defineSchema(
  "api",
  "BoardQuery",
  z.object({ include_archived: flag.optional() })
);

/** Closed lanes are capped at the 200 most recent cards (06 §1.4). */
export const BOARD_CLOSED_LANE_CAP = 200;

export const BoardColumnSchema = defineSchema(
  "api",
  "BoardColumn",
  z.object({
    stage: StageSchema,
    /** Ordered by board_rank. */
    cards: z.array(BoardCardSchema),
    total: z.number().int().min(0),
    /** True when a closed lane was capped; page the rest via /applications. */
    has_more: z.boolean(),
  })
);

/** Sidebar and header counters (06 §1.3, 12 §10). */
export const BoardCountsSchema = defineSchema(
  "api",
  "BoardCounts",
  z.object({
    approvals_pending: z.number().int().min(0),
    inbox_new: z.number().int().min(0),
    follow_ups_due: z.number().int().min(0),
    unconfirmed: z.number().int().min(0),
    tasks_live: z.number().int().min(0),
  })
);

/**
 * All non-archived applications grouped by stage (one column per stage in
 * board order), `counts`, and `cursor` = the current change_log seq (06 §1.4).
 */
export const BoardResponseSchema = defineSchema(
  "api",
  "BoardResponse",
  z.object({
    columns: z.array(BoardColumnSchema),
    counts: BoardCountsSchema,
    cursor: z.number().int().min(0),
    generated_at: TimestampSchema,
  })
);
export type BoardResponse = z.infer<typeof BoardResponseSchema>;

export const ListApplicationsQuerySchema = defineSchema(
  "api",
  "ListApplicationsQuery",
  PageQuerySchema.extend({
    stage: StageSchema.optional(),
    q: z.string().max(200).optional(),
    include_archived: flag.optional(),
  })
);

export const BoardCardPageSchema = paginated(
  "api",
  "BoardCard",
  BoardCardSchema
);

export const CreateApplicationRequestSchema = defineSchema(
  "api",
  "CreateApplicationRequest",
  z.object({
    user_job_id: UserJobIdSchema,
    /** Default `saved`. */
    stage: StageSchema.optional(),
    mode: ApplicationModeSchema.optional(),
  })
);
export type CreateApplicationRequest = z.infer<
  typeof CreateApplicationRequestSchema
>;

export const ApplicationResponseSchema = defineSchema(
  "api",
  "ApplicationResponse",
  z.object({ application: ApplicationRecordSchema })
);

/** Full detail (05 §5): posting, CV variants, interviews, offers, open approvals, tasks. */
export const ApplicationDetailSchema = defineSchema(
  "api",
  "ApplicationDetail",
  z.object({
    application: ApplicationRecordSchema,
    user_job: UserJobRecordSchema,
    posting: JobPostingRecordSchema,
    score: MatchScoreRecordSchema.nullable(),
    cv_variants: z.array(CvVariantRecordSchema),
    interviews: z.array(InterviewRecordSchema),
    offers: z.array(OfferRecordSchema),
    approvals: z.array(ApprovalRecordSchema),
    tasks: z.array(AutomationTaskRecordSchema),
    evidence: z.array(SubmissionEvidenceRecordSchema),
    emails: z.array(EmailApplicationRecordSchema),
  })
);
export type ApplicationDetail = z.infer<typeof ApplicationDetailSchema>;

/**
 * Stage changes are validated against 03 §5.1 (`422 invalid_transition`);
 * `sections` replaces the whole checklist array (06 §5).
 */
// `base_revision` may come in the body or as `If-Match` (05 §1.6); the
// route answers 400 when both are absent.
export const UpdateApplicationRequestSchema = defineSchema(
  "api",
  "UpdateApplicationRequest",
  z.object({
    base_revision: RevisionSchema.optional(),
    stage: StageSchema.optional(),
    board_rank: z.string().min(1).max(64).optional(),
    mode: ApplicationModeSchema.optional(),
    priority: z.number().int().min(-1).max(1).optional(),
    archived: z.boolean().optional(),
    follow_up_at: TimestampSchema.nullable().optional(),
    base_cv_id: z.string().min(1).nullable().optional(),
    sections: z.array(LegacyJobSectionSchema).optional(),
  })
);
export type UpdateApplicationRequest = z.infer<
  typeof UpdateApplicationRequestSchema
>;

/** Drag-and-drop: the server computes board_rank from the neighbours (06 §2). */
export const MoveApplicationRequestSchema = defineSchema(
  "api",
  "MoveApplicationRequest",
  z.object({
    base_revision: RevisionSchema.optional(),
    stage: StageSchema,
    before_id: ApplicationIdSchema.nullable().optional(),
    after_id: ApplicationIdSchema.nullable().optional(),
  })
);
export type MoveApplicationRequest = z.infer<
  typeof MoveApplicationRequestSchema
>;

export const SubmissionRequestSchema = defineSchema(
  "api",
  "SubmissionRequest",
  z.object({
    base_revision: RevisionSchema.optional(),
    action: SubmissionActionSchema,
    applied_at: TimestampSchema.optional(),
    method: SubmissionMethodSchema.optional(),
    note: z.string().max(2000).optional(),
  })
);
export type SubmissionRequest = z.infer<typeof SubmissionRequestSchema>;

export const SubmissionResponseSchema = defineSchema(
  "api",
  "SubmissionResponse",
  z.object({
    application: ApplicationRecordSchema,
    /** The `user_attestation` evidence written by confirm / mark_applied. */
    evidence: SubmissionEvidenceRecordSchema.nullable(),
  })
);

// --- events -------------------------------------------------------------------------

export const ApplicationEventPageSchema = paginated(
  "api",
  "ApplicationEvent",
  ApplicationEventRecordSchema
);

/** Note-type events only (05 §5, 06 §4): `note_added` and `note_deleted`. */
export const CreateEventRequestSchema = defineSchema(
  "api",
  "CreateEventRequest",
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("note_added"),
      payload: NoteAddedEventPayloadSchema,
      idempotency_key: z.string().min(1).max(128),
      occurred_at: TimestampSchema.optional(),
    }),
    z.object({
      type: z.literal("note_deleted"),
      payload: NoteDeletedEventPayloadSchema,
      idempotency_key: z.string().min(1).max(128),
      occurred_at: TimestampSchema.optional(),
    }),
  ])
);
export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;

export const EventResponseSchema = defineSchema(
  "api",
  "EventResponse",
  z.object({ event: ApplicationEventRecordSchema })
);

// --- interviews ---------------------------------------------------------------------

const interviewFields = {
  round: z.number().int().min(1).optional(),
  scheduled_at: TimestampSchema.nullable().optional(),
  duration_min: z.number().int().min(1).max(1440).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  interviewers: z.array(z.string().max(200)).max(20).optional(),
  outcome: InterviewOutcomeSchema.optional(),
  notes: z.string().max(10_000).optional(),
  /**
   * Opt-out toggle (default true): creating the first interview of an
   * `applied` application moves it to `interviewing` (06 §3).
   */
  move_application: z.boolean().optional(),
};

export const InterviewPageSchema = paginated(
  "api",
  "Interview",
  InterviewRecordSchema
);

export const CreateInterviewRequestSchema = defineSchema(
  "api",
  "CreateInterviewRequest",
  z.object({ kind: InterviewKindSchema, ...interviewFields })
);
export type CreateInterviewRequest = z.infer<
  typeof CreateInterviewRequestSchema
>;

export const UpdateInterviewRequestSchema = defineSchema(
  "api",
  "UpdateInterviewRequest",
  z.object({
    base_revision: RevisionSchema.optional(),
    kind: InterviewKindSchema.optional(),
    ...interviewFields,
  })
);
export type UpdateInterviewRequest = z.infer<
  typeof UpdateInterviewRequestSchema
>;

export const InterviewResponseSchema = defineSchema(
  "api",
  "InterviewResponse",
  z.object({
    interview: InterviewRecordSchema,
    /** Present when the request moved the application's stage. */
    application: ApplicationRecordSchema.optional(),
  })
);

// --- offers -------------------------------------------------------------------------

const offerFields = {
  compensation: OfferCompensationSchema.optional(),
  deadline_at: TimestampSchema.nullable().optional(),
  status: OfferStatusSchema.optional(),
  notes: z.string().max(10_000).optional(),
  /**
   * Toggle (default true): recording an offer moves applied/interviewing →
   * offer; marking it accepted moves offer → accepted (06 §3, §6.2).
   */
  move_application: z.boolean().optional(),
};

export const OfferPageSchema = paginated("api", "Offer", OfferRecordSchema);

export const CreateOfferRequestSchema = defineSchema(
  "api",
  "CreateOfferRequest",
  z.object({ received_at: TimestampSchema, ...offerFields })
);
export type CreateOfferRequest = z.infer<typeof CreateOfferRequestSchema>;

export const UpdateOfferRequestSchema = defineSchema(
  "api",
  "UpdateOfferRequest",
  z.object({
    base_revision: RevisionSchema.optional(),
    received_at: TimestampSchema.optional(),
    ...offerFields,
  })
);
export type UpdateOfferRequest = z.infer<typeof UpdateOfferRequestSchema>;

export const OfferResponseSchema = defineSchema(
  "api",
  "OfferResponse",
  z.object({
    offer: OfferRecordSchema,
    application: ApplicationRecordSchema.optional(),
  })
);

// --- delete ---------------------------------------------------------------------------

/** `?purge=1` hard-deletes (UI asks for a typed confirmation, 06 §8). */
export const DeleteApplicationQuerySchema = defineSchema(
  "api",
  "DeleteApplicationQuery",
  DeleteQuerySchema.extend({ purge: flag.optional() })
);

export const DeleteApplicationResponseSchema = defineSchema(
  "api",
  "DeleteApplicationResponse",
  z.object({
    id: ApplicationIdSchema,
    archived: z.boolean(),
    purged: z.boolean(),
    /** The archived application; null after a purge. */
    application: ApplicationRecordSchema.nullable(),
  })
);

export const applicationsRoutes = {
  "GET /api/v1/board": route({
    method: "GET",
    path: "/api/v1/board",
    operation: "getBoard",
    section: "05 §5",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: BoardQuerySchema,
    response: BoardResponseSchema,
  }),
  "GET /api/v1/applications": route({
    method: "GET",
    path: "/api/v1/applications",
    operation: "listApplications",
    section: "05 §5",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: ListApplicationsQuerySchema,
    response: BoardCardPageSchema,
  }),
  "POST /api/v1/applications": route({
    method: "POST",
    path: "/api/v1/applications",
    operation: "createApplication",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: CreateApplicationRequestSchema,
    response: ApplicationResponseSchema,
  }),
  "GET /api/v1/applications/{app_id}": route({
    method: "GET",
    path: "/api/v1/applications/{app_id}",
    operation: "getApplication",
    section: "05 §5",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: ApplicationDetailSchema,
  }),
  "GET /api/v1/applications/{app_id}/interviews/{ivw_id}.ics": route({
    method: "GET",
    path: "/api/v1/applications/{app_id}/interviews/{ivw_id}.ics",
    operation: "getInterviewIcs",
    section: "05 §5",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: ICalendarSchema,
    response_encoding: "text/calendar",
  }),
  "PATCH /api/v1/applications/{app_id}": route({
    method: "PATCH",
    path: "/api/v1/applications/{app_id}",
    operation: "updateApplication",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: UpdateApplicationRequestSchema,
    response: ApplicationResponseSchema,
  }),
  "POST /api/v1/applications/{app_id}/move": route({
    method: "POST",
    path: "/api/v1/applications/{app_id}/move",
    operation: "moveApplication",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: MoveApplicationRequestSchema,
    response: ApplicationResponseSchema,
  }),
  "POST /api/v1/applications/{app_id}/submission": route({
    method: "POST",
    path: "/api/v1/applications/{app_id}/submission",
    operation: "recordSubmission",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: SubmissionRequestSchema,
    response: SubmissionResponseSchema,
  }),
  "GET /api/v1/applications/{app_id}/events": route({
    method: "GET",
    path: "/api/v1/applications/{app_id}/events",
    operation: "listApplicationEvents",
    section: "05 §5",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: PageQuerySchema,
    response: ApplicationEventPageSchema,
  }),
  "POST /api/v1/applications/{app_id}/events": route({
    method: "POST",
    path: "/api/v1/applications/{app_id}/events",
    operation: "createApplicationEvent",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: CreateEventRequestSchema,
    response: EventResponseSchema,
  }),
  "GET /api/v1/applications/{app_id}/interviews": route({
    method: "GET",
    path: "/api/v1/applications/{app_id}/interviews",
    operation: "listInterviews",
    section: "05 §5",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: PageQuerySchema,
    response: InterviewPageSchema,
  }),
  "POST /api/v1/applications/{app_id}/interviews": route({
    method: "POST",
    path: "/api/v1/applications/{app_id}/interviews",
    operation: "createInterview",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: CreateInterviewRequestSchema,
    response: InterviewResponseSchema,
  }),
  "GET /api/v1/applications/{app_id}/interviews/{ivw_id}": route({
    method: "GET",
    path: "/api/v1/applications/{app_id}/interviews/{ivw_id}",
    operation: "getInterview",
    section: "05 §5",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: InterviewResponseSchema,
  }),
  "PATCH /api/v1/applications/{app_id}/interviews/{ivw_id}": route({
    method: "PATCH",
    path: "/api/v1/applications/{app_id}/interviews/{ivw_id}",
    operation: "updateInterview",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: UpdateInterviewRequestSchema,
    response: InterviewResponseSchema,
  }),
  "DELETE /api/v1/applications/{app_id}/interviews/{ivw_id}": route({
    method: "DELETE",
    path: "/api/v1/applications/{app_id}/interviews/{ivw_id}",
    operation: "deleteInterview",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: null,
    query: DeleteQuerySchema,
    response: DeletedResponseSchema,
  }),
  "GET /api/v1/applications/{app_id}/offers": route({
    method: "GET",
    path: "/api/v1/applications/{app_id}/offers",
    operation: "listOffers",
    section: "05 §5",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: PageQuerySchema,
    response: OfferPageSchema,
  }),
  "POST /api/v1/applications/{app_id}/offers": route({
    method: "POST",
    path: "/api/v1/applications/{app_id}/offers",
    operation: "createOffer",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 201,
    request: CreateOfferRequestSchema,
    response: OfferResponseSchema,
  }),
  "GET /api/v1/applications/{app_id}/offers/{ofr_id}": route({
    method: "GET",
    path: "/api/v1/applications/{app_id}/offers/{ofr_id}",
    operation: "getOffer",
    section: "05 §5",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: OfferResponseSchema,
  }),
  "PATCH /api/v1/applications/{app_id}/offers/{ofr_id}": route({
    method: "PATCH",
    path: "/api/v1/applications/{app_id}/offers/{ofr_id}",
    operation: "updateOffer",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: UpdateOfferRequestSchema,
    response: OfferResponseSchema,
  }),
  "DELETE /api/v1/applications/{app_id}/offers/{ofr_id}": route({
    method: "DELETE",
    path: "/api/v1/applications/{app_id}/offers/{ofr_id}",
    operation: "deleteOffer",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: null,
    query: DeleteQuerySchema,
    response: DeletedResponseSchema,
  }),
  "DELETE /api/v1/applications/{app_id}": route({
    method: "DELETE",
    path: "/api/v1/applications/{app_id}",
    operation: "deleteApplication",
    section: "05 §5",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: null,
    query: DeleteApplicationQuerySchema,
    response: DeleteApplicationResponseSchema,
  }),
} as const;
