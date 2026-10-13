// Per-item validation of `postings:batch` (05 §4, 15 §10.2, 20 §7).
//
// The route accepts the batch envelope (≤ 100 items) and validates each item
// here, so one bad item becomes an `invalid` outcome instead of failing the
// whole batch. Server-side, every derived value is recomputed:
//
//   fingerprint   recomputed (fp1, 03 §4.2); a mismatch is `invalid`
//                 (`fingerprint_mismatch`) — it catches normalizer drift
//                 between the Python CLI and this server (20 §7 step 6)
//   content_hash  recomputed from the stored (≤ 64 KB) title + description
//   dedupe_group  recomputed (15 §11), the client's value is ignored
//   apply_domain  registrable domain of apply_url
//   extraction    run_id / device_id overwritten with the real run + device

import { getAdapterManifest } from "@pilihpendidikan/jobs-contracts/adapters";
import type { NormalizedPosting } from "@pilihpendidikan/jobs-contracts/api";
import type { BATCH_ITEM_ERROR_CODES } from "@pilihpendidikan/jobs-contracts/api";
import {
  NormalizedPostingSchema,
  UnchangedPostingItemSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationSupport,
  PostingVisibility,
  SourceKind,
} from "@pilihpendidikan/jobs-contracts/enums";
import { ADAPTER_IDS } from "@pilihpendidikan/jobs-contracts/enums";
import {
  contentHash,
  fingerprint,
  primaryLocation,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import type {
  ExtractionProvenance,
  PostingLocation,
  Salary,
} from "@pilihpendidikan/jobs-contracts/records";
import type { z } from "zod";
import {
  checkUrl,
  clampClientTime,
  domainOfUrl,
  excludedHostOf,
  findForbiddenString,
  FORBIDDEN_TEXT,
  POSTED_AT_MAX_AHEAD_MS,
  truncateUtf8,
  urlProblemMessage,
  utf8Length,
} from "./validation";

export type BatchItemErrorCode = (typeof BATCH_ITEM_ERROR_CODES)[number];

export interface BatchItemError {
  code: BatchItemErrorCode;
  message: string;
  path?: string;
}

export interface StatusEvidence {
  http_status?: number | null;
  marker?: string | null;
}

interface PreparedBase {
  clientRef: string;
  fingerprint: string;
  index: number;
  /** observed_at after the 20 §9 clamp. */
  observedAt: number;
  statusEvidence: StatusEvidence | null;
  statusHint: "closed" | "open" | null;
}

/** Content columns a full item carries (server-normalized). */
export interface ItemContent {
  application_support: ApplicationSupport | null;
  apply_domain: string | null;
  apply_url: string | null;
  canonical_url: string | null;
  company_domain: string | null;
  company_name: string;
  department: string | null;
  description_text: string;
  description_truncated: boolean;
  employment_type: NormalizedPosting["employment_type"] | null;
  locations: PostingLocation[];
  posted_at: number | null;
  requirements: string[];
  salary: Salary | null;
  seniority: string | null;
  title: string;
  workplace_type: NormalizedPosting["workplace_type"] | null;
}

export interface PreparedFullItem extends PreparedBase {
  content: ItemContent;
  contentHash: string;
  extraction: ExtractionProvenance;
  kind: "full";
  sourceId: string | null;
  sourceJobRef: string | null;
  sourceKind: SourceKind;
  sourceOrg: string | null;
  visibility: PostingVisibility;
}

export interface PreparedUnchangedItem extends PreparedBase {
  kind: "unchanged";
}

export type PreparedItem = PreparedFullItem | PreparedUnchangedItem;

export interface InvalidItem {
  clientRef: string;
  errors: BatchItemError[];
  index: number;
  kind: "invalid";
}

export interface ItemContext {
  deviceId: string | null;
  now: number;
  /** The caller's sources referenced by the batch (id → adapter, config). */
  ownedSources: ReadonlyMap<
    string,
    { adapter: string; config: Record<string, unknown> }
  >;
  runId: string;
}

/** Source kinds whose URLs a user typed in: `http:` is accepted (15 §10.2). */
const USER_URL_KINDS: ReadonlySet<string> = new Set([
  "custom_url",
  "career_page",
  "generic_listing",
]);
/** Source kinds that are private by nature (03 §4.1). */
const PRIVATE_ONLY_KINDS: ReadonlySet<string> = new Set([
  "manual",
  "email",
  "legacy",
]);
const MAX_ISSUES = 5;
const CLIENT_REF_MAX = 64;
/** Encoded size cap of a client's extraction provenance. */
export const EXTRACTION_MAX_BYTES = 16_384;
/** Provenance keys only the server writes (alternates, status checks). */
export const SERVER_EXTRACTION_KEYS: ReadonlySet<string> = new Set([
  "alternates",
  "status_check",
]);

function withoutServerKeys(
  extraction: ExtractionProvenance
): ExtractionProvenance {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extraction)) {
    if (!SERVER_EXTRACTION_KEYS.has(key)) {
      out[key] = value;
    }
  }
  return out as ExtractionProvenance;
}

function clientRefOf(raw: unknown, index: number): string {
  if (raw !== null && typeof raw === "object" && "client_ref" in raw) {
    const ref = (raw as { client_ref: unknown }).client_ref;
    if (
      typeof ref === "string" &&
      ref.length > 0 &&
      ref.length <= CLIENT_REF_MAX
    ) {
      return ref;
    }
  }
  return `#${index}`;
}

function invalid(
  index: number,
  clientRef: string,
  errors: BatchItemError[]
): InvalidItem {
  return { kind: "invalid", index, clientRef, errors };
}

function issuesToErrors(error: z.ZodError): BatchItemError[] {
  return error.issues.slice(0, MAX_ISSUES).map((issue) => ({
    code: "schema_invalid" as const,
    message: issue.message,
    path: issue.path.map(String).join("."),
  }));
}

function looksUnchanged(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") {
    return false;
  }
  const allowed = new Set(Object.keys(UnchangedPostingItemSchema.shape));
  return Object.keys(raw).every((key) => allowed.has(key));
}

function evidenceProblem(
  hint: "closed" | "open" | undefined,
  evidence: StatusEvidence | undefined
): BatchItemError | null {
  if (hint !== "closed") {
    return null;
  }
  const hasEvidence =
    evidence !== undefined &&
    ((evidence.http_status ?? null) !== null ||
      (evidence.marker ?? "").length > 0);
  return hasEvidence
    ? null
    : {
        code: "schema_invalid",
        message:
          "status_hint closed needs status_evidence (http_status or marker, 15 §12).",
        path: "status_evidence",
      };
}

function urlErrors(item: NormalizedPosting): BatchItemError[] {
  const errors: BatchItemError[] = [];
  const allowHttp = USER_URL_KINDS.has(item.source_kind);
  for (const field of ["apply_url", "canonical_url"] as const) {
    const value = item[field];
    if (value === null || value === undefined) {
      continue;
    }
    const problem = checkUrl(value, { allowHttp });
    if (problem) {
      errors.push({
        code: "schema_invalid",
        message: urlProblemMessage(problem),
        path: field,
      });
    }
  }
  if (!(item.apply_url || item.canonical_url)) {
    errors.push({
      code: "schema_invalid",
      message: "One of apply_url or canonical_url is required (15 §10.2).",
      path: "apply_url",
    });
  }
  return errors;
}

function exclusionError(item: NormalizedPosting): BatchItemError | null {
  for (const field of ["apply_url", "canonical_url"] as const) {
    const excluded = excludedHostOf(item[field]);
    if (excluded) {
      return {
        code: "excluded_source",
        message: `${excluded} is excluded from discovery (D-17).`,
        path: field,
      };
    }
  }
  return null;
}

function visibilityError(
  item: NormalizedPosting,
  context: ItemContext
): BatchItemError | null {
  if (item.visibility === "private") {
    return null;
  }
  if (PRIVATE_ONLY_KINDS.has(item.source_kind)) {
    return {
      code: "private_conflict",
      message: `${item.source_kind} postings are always private (03 §4.1).`,
      path: "visibility",
    };
  }
  const source = item.source_id
    ? context.ownedSources.get(item.source_id)
    : undefined;
  if (source && source.config.private === true) {
    return {
      code: "private_conflict",
      message: "The source is marked private; its postings must be private.",
      path: "visibility",
    };
  }
  return null;
}

function semanticErrors(
  item: NormalizedPosting,
  context: ItemContext
): BatchItemError[] {
  const errors = urlErrors(item);
  const excluded = exclusionError(item);
  if (excluded) {
    errors.push(excluded);
  }
  const visibility = visibilityError(item, context);
  if (visibility) {
    errors.push(visibility);
  }
  if (
    item.posted_at !== null &&
    item.posted_at !== undefined &&
    item.posted_at > context.now + POSTED_AT_MAX_AHEAD_MS
  ) {
    errors.push({
      code: "schema_invalid",
      message: "posted_at is more than one day in the future (15 §10.2).",
      path: "posted_at",
    });
  }
  const evidence = evidenceProblem(item.status_hint, item.status_evidence);
  if (evidence) {
    errors.push(evidence);
  }
  return errors;
}

function nonEmpty(value: string | null | undefined): string | null {
  return value === null || value === undefined || value === "" ? null : value;
}

function defaultApplicationSupport(
  kind: SourceKind
): ApplicationSupport | null {
  if (!(ADAPTER_IDS as readonly string[]).includes(kind)) {
    return null;
  }
  return getAdapterManifest(kind as (typeof ADAPTER_IDS)[number]).capabilities
    .application_support;
}

function applicationSupportOf(
  item: NormalizedPosting
): ApplicationSupport | null {
  if (excludedHostOf(item.apply_url)) {
    return "prohibited";
  }
  return (
    item.application_support ?? defaultApplicationSupport(item.source_kind)
  );
}

function contentOf(item: NormalizedPosting): ItemContent {
  const description = truncateUtf8(item.description_text);
  return {
    title: item.title,
    company_name: item.company_name,
    company_domain: nonEmpty(item.company_domain),
    canonical_url: nonEmpty(item.canonical_url),
    apply_url: nonEmpty(item.apply_url),
    apply_domain: domainOfUrl(item.apply_url),
    department: nonEmpty(item.department),
    locations: item.locations,
    workplace_type: item.workplace_type ?? null,
    employment_type: item.employment_type ?? null,
    seniority: nonEmpty(item.seniority),
    salary: item.salary ?? null,
    description_text: description.text,
    description_truncated:
      description.truncated || item.description_truncated === true,
    requirements: item.requirements,
    posted_at: item.posted_at ?? null,
    application_support: applicationSupportOf(item),
  };
}

async function prepareFull(
  item: NormalizedPosting,
  index: number,
  context: ItemContext
): Promise<PreparedFullItem | InvalidItem> {
  const errors = semanticErrors(item, context);
  if (errors.length > 0) {
    return invalid(index, item.client_ref, errors);
  }
  const expected = await fingerprint({
    source_kind: item.source_kind,
    source_org: item.source_org,
    source_job_ref: item.source_job_ref,
    title: item.title,
    company_domain: item.company_domain,
    location_primary: primaryLocation(item.locations),
    apply_url: item.apply_url,
    canonical_url: item.canonical_url,
  });
  if (expected !== item.fingerprint) {
    return invalid(index, item.client_ref, [
      {
        code: "fingerprint_mismatch",
        message:
          "The fingerprint does not match the server's fp1 of these fields (03 §4.2).",
        path: "fingerprint",
      },
    ]);
  }
  const content = contentOf(item);
  const observed = clampClientTime(item.observed_at, context.now);
  const clientExtraction = withoutServerKeys(item.extraction);
  if (utf8Length(JSON.stringify(clientExtraction)) > EXTRACTION_MAX_BYTES) {
    return invalid(index, item.client_ref, [
      {
        code: "schema_invalid",
        message: `extraction is limited to ${EXTRACTION_MAX_BYTES} bytes.`,
        path: "extraction",
      },
    ]);
  }
  const flags = [...(clientExtraction.flags ?? [])];
  if (observed.flagged) {
    flags.push("observed_at_clamped");
  }
  const sourceId =
    item.source_id && context.ownedSources.has(item.source_id)
      ? item.source_id
      : null;
  return {
    kind: "full",
    index,
    clientRef: item.client_ref,
    fingerprint: expected,
    visibility: item.visibility,
    sourceKind: item.source_kind,
    sourceOrg: nonEmpty(item.source_org),
    sourceJobRef: nonEmpty(item.source_job_ref),
    sourceId,
    observedAt: observed.value,
    statusHint: item.status_hint ?? null,
    statusEvidence: item.status_evidence ?? null,
    content,
    contentHash: await contentHash(content.title, content.description_text),
    extraction: {
      ...clientExtraction,
      flags,
      run_id: context.runId,
      device_id: context.deviceId,
    },
  };
}

function prepareUnchanged(
  item: z.infer<typeof UnchangedPostingItemSchema>,
  index: number,
  context: ItemContext
): PreparedUnchangedItem | InvalidItem {
  const evidence = evidenceProblem(item.status_hint, item.status_evidence);
  if (evidence) {
    return invalid(index, item.client_ref, [evidence]);
  }
  return {
    kind: "unchanged",
    index,
    clientRef: item.client_ref,
    fingerprint: item.fingerprint,
    observedAt: clampClientTime(item.observed_at, context.now).value,
    statusHint: item.status_hint ?? null,
    statusEvidence: item.status_evidence ?? null,
  };
}

/** Validates one raw batch item (never throws for bad input). */
export async function prepareItem(
  raw: unknown,
  index: number,
  context: ItemContext
): Promise<PreparedItem | InvalidItem> {
  const ref = clientRefOf(raw, index);
  const badString = findForbiddenString(raw);
  if (badString !== null) {
    return invalid(index, ref, [
      {
        code: "schema_invalid",
        message: `Values must not contain NUL, ${FORBIDDEN_TEXT}.`,
        path: badString,
      },
    ]);
  }
  if (looksUnchanged(raw)) {
    const unchanged = UnchangedPostingItemSchema.safeParse(raw);
    return unchanged.success
      ? prepareUnchanged(unchanged.data, index, context)
      : invalid(index, ref, issuesToErrors(unchanged.error));
  }
  const full = NormalizedPostingSchema.safeParse(raw);
  if (!full.success) {
    return invalid(index, ref, issuesToErrors(full.error));
  }
  return await prepareFull(full.data, index, context);
}

/** Source ids referenced by raw items (for one ownership lookup). */
export function referencedSourceIds(items: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const raw of items) {
    if (raw !== null && typeof raw === "object" && "source_id" in raw) {
      const id = (raw as { source_id: unknown }).source_id;
      if (typeof id === "string" && id.startsWith("src_")) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}
