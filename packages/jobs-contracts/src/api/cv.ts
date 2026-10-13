// 05 §7 — CV variants and files (08).
import { z } from "zod";
import {
  BinaryBodySchema,
  JsonObjectSchema,
  paginated,
  RevisionSchema,
  Sha256HexSchema,
} from "../common";
import { CvTemplateSchema, CvVisibilitySchema, FileKindSchema } from "../enums";
import {
  ApplicationIdSchema,
  AttemptIdSchema,
  CvVariantIdSchema,
  EmailIdSchema,
} from "../ids";
import { ApplicationRecordSchema, CvVariantRecordSchema } from "../records";
import { defineSchema } from "../registry";
import { route } from "./route";
import { FileViewSchema } from "./views";

/** A base CV of the caller (proxy of the `/api/cv` owner list). */
export const BaseCvSummarySchema = defineSchema(
  "api",
  "BaseCvSummary",
  z.object({
    /** apps/cv slug. */
    id: z.string().min(1),
    full_name: z.string(),
    job_title: z.string(),
    visibility: CvVisibilitySchema,
    /** True for `-t-` tailored variant documents (08 §5). */
    is_tailored: z.boolean(),
  })
);
export type BaseCvSummary = z.infer<typeof BaseCvSummarySchema>;

export const BaseCvSummaryPageSchema = paginated(
  "api",
  "BaseCvSummary",
  BaseCvSummarySchema
);

export const CreateCvVariantRequestSchema = defineSchema(
  "api",
  "CreateCvVariantRequest",
  z.object({
    base_cv_id: z.string().min(1),
    template: CvTemplateSchema,
    tailor: z.boolean(),
  })
);
export type CreateCvVariantRequest = z.infer<
  typeof CreateCvVariantRequestSchema
>;

export const CvVariantResponseSchema = defineSchema(
  "api",
  "CvVariantResponse",
  z.object({ cv_variant: CvVariantRecordSchema })
);

/** `?include=cv_data` adds the tailored CVData (render page, C8). */
export const GetCvVariantQuerySchema = defineSchema(
  "api",
  "GetCvVariantQuery",
  z.object({ include: z.enum(["cv_data"]).optional() })
);

/** Variant, diff, tailored CVData and file status (05 §7). */
export const CvVariantDetailSchema = defineSchema(
  "api",
  "CvVariantDetail",
  z.object({
    cv_variant: CvVariantRecordSchema,
    file: FileViewSchema.nullable(),
    /** `CVData` of @pilihpendidikan/cv-engine; present with include=cv_data. */
    tailored_cv: JsonObjectSchema.nullable().optional(),
    /** The tailored document changed in apps/cv after approval (08 §5). */
    edited_after_approval: z.boolean(),
  })
);
export type CvVariantDetail = z.infer<typeof CvVariantDetailSchema>;

/** Render tickets live 120 s (08 §6.4, PLAN C8). */
export const RENDER_TICKET_TTL_SECONDS = 120;

export const RenderTicketResponseSchema = defineSchema(
  "api",
  "RenderTicketResponse",
  z.object({
    ticket: z.string().min(32),
    /** `<JOBS_APP_ORIGIN>/render/cv/<cvv_id>?ticket=<ticket>` */
    url: z.string().url(),
    expires_in: z.number().int().min(1),
  })
);
export type RenderTicketResponse = z.infer<typeof RenderTicketResponseSchema>;

export const ApproveCvVariantRequestSchema = defineSchema(
  "api",
  "ApproveCvVariantRequest",
  z.object({ base_revision: RevisionSchema })
);

export const ApproveCvVariantResponseSchema = defineSchema(
  "api",
  "ApproveCvVariantResponse",
  z.object({
    cv_variant: CvVariantRecordSchema,
    /** The application it was attached to, if any. */
    application: ApplicationRecordSchema.nullable(),
  })
);

export const RejectCvVariantRequestSchema = defineSchema(
  "api",
  "RejectCvVariantRequest",
  z.object({
    base_revision: RevisionSchema,
    reason: z.string().max(500).optional(),
  })
);

/** Upload size limits (05 §7, 08 §6.5). */
export const FILE_UPLOAD_MAX_BYTES = 26_214_400;
export const CV_PDF_MAX_BYTES = 5_242_880;

/** The `meta` part of `POST /api/v1/files` (multipart/form-data). */
export const FileUploadMetaSchema = defineSchema(
  "api",
  "FileUploadMeta",
  z.object({
    kind: FileKindSchema,
    sha256: Sha256HexSchema,
    content_type: z.string().min(1).max(200),
    size_bytes: z.number().int().min(1).max(FILE_UPLOAD_MAX_BYTES),
    original_name: z.string().max(255).optional(),
    links: z.object({
      cv_variant_id: CvVariantIdSchema.optional(),
      application_id: ApplicationIdSchema.optional(),
      attempt_id: AttemptIdSchema.optional(),
      email_application_id: EmailIdSchema.optional(),
    }),
  })
);
export type FileUploadMeta = z.infer<typeof FileUploadMetaSchema>;

/** multipart/form-data: part `meta` (JSON) + part `file` (bytes). */
export const FileUploadRequestSchema = defineSchema(
  "api",
  "FileUploadRequest",
  z.object({ meta: FileUploadMetaSchema, file: BinaryBodySchema })
);

export const FileResponseSchema = defineSchema(
  "api",
  "FileResponse",
  z.object({ file: FileViewSchema })
);

export const cvRoutes = {
  "GET /api/v1/cvs": route({
    method: "GET",
    path: "/api/v1/cvs",
    operation: "listCvs",
    section: "05 §7",
    scope: "cv:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: BaseCvSummaryPageSchema,
  }),
  "POST /api/v1/applications/{app_id}/cv-variants": route({
    method: "POST",
    path: "/api/v1/applications/{app_id}/cv-variants",
    operation: "createCvVariant",
    section: "05 §7",
    scope: "cv:write",
    also_requires: ["ai:invoke"],
    idempotency: "optional",
    status: 202,
    request: CreateCvVariantRequestSchema,
    response: CvVariantResponseSchema,
  }),
  "GET /api/v1/cv-variants/{cvv_id}": route({
    method: "GET",
    path: "/api/v1/cv-variants/{cvv_id}",
    operation: "getCvVariant",
    section: "05 §7",
    scope: "cv:read",
    idempotency: "none",
    status: 200,
    request: null,
    query: GetCvVariantQuerySchema,
    response: CvVariantDetailSchema,
  }),
  "POST /api/v1/cv-variants/{cvv_id}/render-ticket": route({
    method: "POST",
    path: "/api/v1/cv-variants/{cvv_id}/render-ticket",
    operation: "createRenderTicket",
    section: "05 §7",
    scope: "cv:write",
    alt_scope: "automation:execute",
    idempotency: "optional",
    status: 200,
    request: null,
    response: RenderTicketResponseSchema,
  }),
  "POST /api/v1/cv-variants/{cvv_id}/approve": route({
    method: "POST",
    path: "/api/v1/cv-variants/{cvv_id}/approve",
    operation: "approveCvVariant",
    section: "05 §7",
    scope: "cv:write",
    idempotency: "optional",
    status: 200,
    request: ApproveCvVariantRequestSchema,
    response: ApproveCvVariantResponseSchema,
  }),
  "POST /api/v1/cv-variants/{cvv_id}/reject": route({
    method: "POST",
    path: "/api/v1/cv-variants/{cvv_id}/reject",
    operation: "rejectCvVariant",
    section: "05 §7",
    scope: "cv:write",
    idempotency: "optional",
    status: 200,
    request: RejectCvVariantRequestSchema,
    response: CvVariantResponseSchema,
  }),
  "POST /api/v1/files": route({
    method: "POST",
    path: "/api/v1/files",
    operation: "uploadFile",
    section: "05 §7",
    scope: "files:write",
    idempotency: "optional",
    status: 201,
    request: FileUploadRequestSchema,
    request_encoding: "multipart/form-data",
    response: FileResponseSchema,
  }),
  "GET /api/v1/files/{fil_id}": route({
    method: "GET",
    path: "/api/v1/files/{fil_id}",
    operation: "getFile",
    section: "05 §7",
    scope: "files:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: FileResponseSchema,
  }),
  "GET /api/v1/files/{fil_id}/content": route({
    method: "GET",
    path: "/api/v1/files/{fil_id}/content",
    operation: "getFileContent",
    section: "05 §7",
    scope: "files:read",
    idempotency: "none",
    status: 200,
    request: null,
    response: BinaryBodySchema,
    response_encoding: "binary",
  }),
  "DELETE /api/v1/files/{fil_id}": route({
    method: "DELETE",
    path: "/api/v1/files/{fil_id}",
    operation: "deleteFile",
    section: "05 §7",
    scope: "files:write",
    idempotency: "optional",
    status: 200,
    request: null,
    response: FileResponseSchema,
  }),
} as const;
