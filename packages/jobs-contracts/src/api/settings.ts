// 05 §10a — Settings and account (04 §2.7, 11 §10, 22 §8).
import { z } from "zod";
import {
  BinaryBodySchema,
  DaySchema,
  HtmlPageSchema,
  RevisionSchema,
  TimestampSchema,
} from "../common";
import {
  ApplicationModeSchema,
  EvidenceScreenshotModeSchema,
  LocaleSchema,
} from "../enums";
import {
  EVIDENCE_RETENTION_DAYS,
  TelemetryCountersSchema,
  UserSettingsRecordSchema,
} from "../records";
import { defineSchema } from "../registry";
import { route } from "./route";

export const SettingsResponseSchema = defineSchema(
  "api",
  "SettingsResponse",
  z.object({ settings: UserSettingsRecordSchema })
);

/**
 * `ai_consent: true` sets `ai_consent_at = now`, `false` clears it.
 * Turning on `automation_paused` pauses running workers at their next
 * heartbeat (05 §10a).
 */
export const UpdateSettingsRequestSchema = defineSchema(
  "api",
  "UpdateSettingsRequest",
  z.object({
    base_revision: RevisionSchema,
    locale: LocaleSchema.optional(),
    timezone: z.string().min(1).max(64).optional(),
    default_mode: ApplicationModeSchema.optional(),
    automation_paused: z.boolean().optional(),
    generated_text_allowed: z.boolean().optional(),
    allow_mcp_approvals: z.boolean().optional(),
    ai_consent: z.boolean().optional(),
    ai_scoring_sensitive: z.boolean().optional(),
    evidence_screenshots: EvidenceScreenshotModeSchema.optional(),
    evidence_retention_days: z
      .number()
      .int()
      .min(EVIDENCE_RETENTION_DAYS.min)
      .max(EVIDENCE_RETENTION_DAYS.max)
      .optional(),
  })
);
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;

/** Async export; an emailed link (valid 24 h) follows (11 §10). */
export const AccountExportResponseSchema = defineSchema(
  "api",
  "AccountExportResponse",
  z.object({
    export_id: z.string().min(1),
    status: z.literal("pending"),
  })
);

export const AccountDeleteRequestSchema = defineSchema(
  "api",
  "AccountDeleteRequest",
  z.object({
    /** Also delete base CVs (tailored variants are always deleted). */
    also_delete_cvs: z.boolean().optional(),
  })
);

/** Deletion starts after the emailed confirmation (11 §10). */
export const AccountDeleteResponseSchema = defineSchema(
  "api",
  "AccountDeleteResponse",
  z.object({
    status: z.literal("confirmation_sent"),
    confirmation_expires_at: TimestampSchema,
  })
);

/**
 * The single-use token of the emailed deletion link (11 §10). The GET page
 * reads it from the query; the POST takes it as JSON or as an HTML form.
 */
export const AccountDeleteConfirmQuerySchema = defineSchema(
  "api",
  "AccountDeleteConfirmQuery",
  z.object({ token: z.string().max(200).optional() })
);

export const AccountDeleteConfirmRequestSchema = defineSchema(
  "api",
  "AccountDeleteConfirmRequest",
  z.object({ token: z.string().min(1).max(200) })
);

/** JSON answer of a confirmed deletion; HTML forms get a result page. */
export const AccountDeleteConfirmResponseSchema = defineSchema(
  "api",
  "AccountDeleteConfirmResponse",
  z.object({ status: z.literal("deleting") })
);

/** Opt-in anonymous CLI counters (22 §8.1); no user or device id. */
export const TelemetryRequestSchema = defineSchema(
  "api",
  "TelemetryRequest",
  z.object({
    day: DaySchema,
    /** Random per-install id, rotated every 30 days. */
    install_hash: z.string().min(8).max(64),
    cli_version: z.string().min(1).max(40),
    platform: z.string().min(1).max(40),
    arch: z.string().max(20).optional(),
    python_version: z.string().max(20).optional(),
    install_channel: z.string().max(20).optional(),
    counters: TelemetryCountersSchema,
  })
);
export type TelemetryRequest = z.infer<typeof TelemetryRequestSchema>;

/** Redacted crash report: frame file and line only, no locals (22 §8.2). */
export const CrashReportRequestSchema = defineSchema(
  "api",
  "CrashReportRequest",
  z.object({
    install_hash: z.string().min(8).max(64),
    cli_version: z.string().min(1).max(40),
    platform: z.string().min(1).max(40),
    python_version: z.string().max(20).optional(),
    occurred_at: TimestampSchema,
    exception_type: z.string().min(1).max(200),
    /** Already redacted by the CLI (16 §10). */
    message: z.string().max(500),
    frames: z
      .array(
        z.object({
          file: z.string().max(300),
          line: z.number().int().min(0),
          function: z.string().max(200).optional(),
        })
      )
      .max(100),
  })
);
export type CrashReportRequest = z.infer<typeof CrashReportRequestSchema>;

export const AcceptedResponseSchema = defineSchema(
  "api",
  "AcceptedResponse",
  z.object({ accepted: z.literal(true) })
);

export const settingsRoutes = {
  "GET /api/v1/settings": route({
    method: "GET",
    path: "/api/v1/settings",
    operation: "getSettings",
    section: "05 §10a",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: SettingsResponseSchema,
  }),
  "PATCH /api/v1/settings": route({
    method: "PATCH",
    path: "/api/v1/settings",
    operation: "updateSettings",
    section: "05 §10a",
    scope: "jobs:write",
    idempotency: "optional",
    status: 200,
    request: UpdateSettingsRequestSchema,
    response: SettingsResponseSchema,
  }),
  "POST /api/v1/account/export": route({
    method: "POST",
    path: "/api/v1/account/export",
    operation: "exportAccount",
    section: "05 §10a",
    scope: "jobs:write",
    idempotency: "optional",
    status: 202,
    request: null,
    response: AccountExportResponseSchema,
  }),
  /** The export zip (24 h), browser session only; other users get 404. */
  "GET /api/v1/account/exports/{export_id}": route({
    method: "GET",
    path: "/api/v1/account/exports/{export_id}",
    operation: "downloadAccountExport",
    section: "05 §10a",
    scope: "jobs:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: BinaryBodySchema,
    response_encoding: "binary",
  }),
  "POST /api/v1/account/delete": route({
    method: "POST",
    path: "/api/v1/account/delete",
    operation: "deleteAccount",
    section: "05 §10a",
    scope: "jobs:write",
    idempotency: "optional",
    status: 202,
    request: AccountDeleteRequestSchema,
    response: AccountDeleteResponseSchema,
  }),
  /** Public confirmation page of the emailed link (no write). */
  "GET /api/v1/account/delete/confirm": route({
    method: "GET",
    path: "/api/v1/account/delete/confirm",
    operation: "accountDeleteConfirmPage",
    section: "05 §10a",
    scope: "none",
    idempotency: "none",
    status: 200,
    request: null,
    query: AccountDeleteConfirmQuerySchema,
    response: HtmlPageSchema,
    response_encoding: "text/html",
  }),
  /**
   * Public, token-authenticated: starts the deletion. A JSON body answers 202
   * JSON (404 for a spent token); the same field posted as an HTML form
   * (`application/x-www-form-urlencoded`) answers a result page.
   */
  "POST /api/v1/account/delete/confirm": route({
    method: "POST",
    path: "/api/v1/account/delete/confirm",
    operation: "confirmAccountDelete",
    section: "05 §10a",
    scope: "none",
    idempotency: "none",
    status: 202,
    request: AccountDeleteConfirmRequestSchema,
    response: AccountDeleteConfirmResponseSchema,
  }),
  "POST /api/v1/telemetry": route({
    method: "POST",
    path: "/api/v1/telemetry",
    operation: "postTelemetry",
    section: "05 §10a",
    scope: "none",
    idempotency: "none",
    status: 202,
    request: TelemetryRequestSchema,
    response: AcceptedResponseSchema,
  }),
  "POST /api/v1/telemetry/crash": route({
    method: "POST",
    path: "/api/v1/telemetry/crash",
    operation: "postCrashReport",
    section: "05 §10a",
    scope: "none",
    idempotency: "none",
    status: 202,
    request: CrashReportRequestSchema,
    response: AcceptedResponseSchema,
  }),
} as const;
