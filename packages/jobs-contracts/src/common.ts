// Shared primitives of the API contract (05 §1, PLAN C2).
//
// - Timestamps are epoch milliseconds (integers) everywhere.
// - JSON keys are snake_case, exactly the 04 column names.
// - Errors use one envelope; lists use one pagination envelope.
import { z } from "zod";
import { ApiErrorCodeSchema, InvalidTokenReasonSchema } from "./enums";
import type { SchemaGroup } from "./registry";
import { defineSchema } from "./registry";

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const FINGERPRINT_RE = /^fp1:[0-9a-f]{64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
const HOST_RE = /^[a-z0-9.-]+$/;

/** Epoch milliseconds (UTC). */
export const TimestampSchema = defineSchema(
  "common",
  "Timestamp",
  z.number().int().min(0),
  "Epoch milliseconds (UTC)"
);
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Row revision for optimistic concurrency (D-21); starts at 1. */
export const RevisionSchema = defineSchema(
  "common",
  "Revision",
  z.number().int().min(1),
  "Row revision (D-21); starts at 1 and increments on every update"
);

/** Lowercase hex SHA-256 digest. */
export const Sha256HexSchema = defineSchema(
  "common",
  "Sha256Hex",
  z.string().regex(SHA256_HEX_RE),
  "Lowercase hex SHA-256 digest (64 characters)"
);

/** `fp1:` + SHA-256 hex of the fingerprint key (03 §4.2). */
export const FingerprintSchema = defineSchema(
  "common",
  "Fingerprint",
  z.string().regex(FINGERPRINT_RE),
  "Posting fingerprint: fp1: + SHA-256 hex of the src|/gen| key (03 §4.2)"
);

/** Calendar day `YYYY-MM-DD`. */
export const DaySchema = defineSchema(
  "common",
  "Day",
  z.string().regex(DAY_RE),
  "Calendar day YYYY-MM-DD"
);

/** Calendar month `YYYY-MM` (UTC). */
export const MonthSchema = defineSchema(
  "common",
  "Month",
  z.string().regex(MONTH_RE),
  "Calendar month YYYY-MM"
);

/** Semantic version (`1.2.3`, optional pre-release/build). */
export const SemverSchema = defineSchema(
  "common",
  "Semver",
  z.string().regex(SEMVER_RE),
  "Semantic version"
);

/** ISO 3166-1 alpha-2 country code, uppercase. */
export const CountryCodeSchema = defineSchema(
  "common",
  "CountryCode",
  z.string().regex(COUNTRY_CODE_RE),
  "ISO 3166-1 alpha-2 country code"
);

/** Lowercase ASCII (punycode) host or registrable domain. */
export const DomainSchema = defineSchema(
  "common",
  "Domain",
  z.string().min(1).max(253).regex(HOST_RE),
  "Lowercase ASCII host or registrable domain (IDN in punycode)"
);

/** Absolute URL. */
export const UrlSchema = defineSchema(
  "common",
  "Url",
  z.string().url().max(2048),
  "Absolute URL"
);

/** Any JSON object (keys are strings). */
export const JsonObjectSchema = defineSchema(
  "common",
  "JsonObject",
  z.record(z.string(), z.unknown()),
  "Any JSON object"
);
export type JsonObject = z.infer<typeof JsonObjectSchema>;

/** Any JSON value. */
export const JsonValueSchema = defineSchema(
  "common",
  "JsonValue",
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.unknown()),
    z.record(z.string(), z.unknown()),
  ]),
  "Any JSON value"
);
export type JsonValue = z.infer<typeof JsonValueSchema>;

/**
 * The error envelope of every `/api/v1` failure (05 §1.3). `reason` is set on
 * `401 invalid_token`, `scope` on `403 insufficient_scope`; `details` carries
 * e.g. `issues` (400) or `current` (409 revision_conflict).
 */
export const ErrorEnvelopeSchema = defineSchema(
  "common",
  "ErrorEnvelope",
  z.object({
    error: ApiErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string(),
    reason: InvalidTokenReasonSchema.optional(),
    scope: z.string().optional(),
  }),
  "Error envelope of every /api/v1 failure (05 §1.3)"
);
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** Opaque base64url keyset cursor of list endpoints (05 §1.5). */
export const CursorSchema = defineSchema(
  "common",
  "Cursor",
  z.string().min(1).max(512),
  "Opaque base64url cursor of the last sort key (05 §1.5)"
);

/** `?limit=&cursor=` of list endpoints (05 §1.5): limit 1–200, default 50. */
export const PageQuerySchema = defineSchema(
  "common",
  "PageQuery",
  z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: CursorSchema.optional(),
  }),
  "Pagination query (05 §1.5): limit 1-200 (default 50), opaque cursor"
);

/** Default and maximum list page sizes (05 §1.5). */
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;

/**
 * Builds and registers the `{items, next_cursor}` envelope (05 §1.5) for one
 * item schema, named `<Name>Page`.
 */
export function paginated<T extends z.ZodType>(
  group: SchemaGroup,
  name: string,
  item: T
) {
  return defineSchema(
    group,
    `${name}Page`,
    z.object({
      items: z.array(item),
      next_cursor: CursorSchema.nullable(),
    })
  );
}

/** Response of DELETE routes that remove a record. */
export const DeletedResponseSchema = defineSchema(
  "common",
  "DeletedResponse",
  z.object({ id: z.string(), deleted: z.literal(true) })
);
export type DeletedResponse = z.infer<typeof DeletedResponseSchema>;

/** `{base_revision}` carried by every conditional write (05 §1.6, D-21). */
export const BaseRevisionSchema = defineSchema(
  "common",
  "BaseRevision",
  z.object({ base_revision: RevisionSchema })
);

/** Empty JSON object (default `'{}'` JSON columns and empty bodies). */
export const EmptyObjectSchema = defineSchema(
  "common",
  "EmptyObject",
  z.strictObject({})
);

/**
 * Marker for routes whose body is raw bytes rather than JSON (file content,
 * multipart parts). It documents the transport; the bytes themselves are
 * never JSON-validated. `content_type` and `sha256` mirror the HTTP headers
 * (`Content-Type`, `ETag`).
 */
export const BinaryBodySchema = defineSchema(
  "common",
  "BinaryBody",
  z.object({
    binary: z.literal(true),
    content_type: z.string(),
    sha256: Sha256HexSchema.optional(),
    size_bytes: z.number().int().min(0).optional(),
    content_disposition: z.string().optional(),
  }),
  "Marker: the HTTP body is raw bytes, not JSON (headers carry the metadata)"
);
export type BinaryBody = z.infer<typeof BinaryBodySchema>;

/** `text/calendar` body of the `.ics` export (06 §6.1). */
/** A server-rendered HTML page (emailed confirmation links). */
export const HtmlPageSchema = defineSchema(
  "common",
  "HtmlPage",
  z.string().min(1),
  "text/html body: a server-rendered page, not JSON"
);

export const ICalendarSchema = defineSchema(
  "common",
  "ICalendar",
  z.string().startsWith("BEGIN:VCALENDAR"),
  "text/calendar body (RFC 5545), one VEVENT"
);
