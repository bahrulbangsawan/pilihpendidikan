// `POST /api/v1/files` (05 §7, 14 §5.2, 08 §6.5): multipart `meta` (JSON) +
// `file`, streamed to R2 — the body is never buffered:
//
//   1. auth (bearer or a render ticket, C8) + files:write + rate limit (router)
//   2. meta: FileUploadMeta, kind / content-type allowlist, size cap (25 MB,
//      cv_pdf 5 MB), link targets owned (404), a cv_pdf link to a variant that
//      can take a PDF (422); a ticket only uploads its own variant's cv_pdf
//   3. INSERT files (pending) with a server-built key u/{user}/{kind}/{fil}{ext}
//   4. file part → inspector (SHA-256, byte count, first 8 bytes) → R2 put
//      with the declared sha256 (R2 rejects a mismatch)
//   5. bytes = size_bytes, sha256 = declared, magic bytes = declared type;
//      any mismatch → delete the object + 422 policy_violation
//   6. ONE batch: pending → ready (+ change_log), the variant link (draft +
//      cv_variant approval, or auto-approve) and the idempotency row
// Any failure after step 3 deletes the object and the pending row.

import type { FileUploadMeta } from "@pilihpendidikan/jobs-contracts/api";
import { FileUploadMetaSchema } from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { RouteContext } from "../../core/context";
import {
  apiError,
  invalidRequest,
  invalidToken,
  isApiError,
  REPLAYED_HEADER,
} from "../../core/http";
import { getUserSettings } from "../../repo/core/settings";
import {
  assertLinkTargetsOwned,
  discardPendingFile,
  insertPendingFile,
  markFileReadyStatements,
  toFileView,
} from "../../repo/files";
import {
  assertVariantAcceptsPdf,
  planAttachRenderedFile,
  renderTicketOf,
} from "../../services/cv";
import type { UploadInspector } from "../../services/files/inspect";
import {
  createUploadInspector,
  withKnownLength,
} from "../../services/files/inspect";
import {
  MultipartError,
  MultipartReader,
} from "../../services/files/multipart";
import type { MagicKind } from "../../services/files/policy";
import {
  allowedTypes,
  FILE_KIND_RULES,
  initialRetention,
  magicMatches,
  normalizeContentType,
  r2KeyFor,
  typeRuleFor,
} from "../../services/files/policy";

/** The `meta` part is small JSON. */
const META_MAX_BYTES = 16 * 1024;
/** Room for the meta part and multipart framing on top of the file cap. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function tooLarge(limit: number): Error {
  return apiError("payload_too_large", `The file exceeds ${limit} bytes.`, {
    details: { limit },
  });
}

function integrity(reason: string, message: string): Error {
  return apiError("policy_violation", message, { details: { reason } });
}

function fromMultipart(err: unknown): unknown {
  if (!(err instanceof MultipartError)) {
    return err;
  }
  if (err.code === "too_large") {
    return apiError("payload_too_large", err.message);
  }
  return invalidRequest(err.message);
}

async function readMeta(reader: MultipartReader): Promise<FileUploadMeta> {
  const part = await reader.nextPart();
  if (part?.name !== "meta") {
    throw invalidRequest('The first part must be "meta" (JSON), then "file".');
  }
  const text = await reader.readText(META_MAX_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalidRequest("The meta part is not valid JSON.");
  }
  const parsed = FileUploadMetaSchema.safeParse(json);
  if (!parsed.success) {
    throw invalidRequest("Invalid file meta.", parsed.error.issues);
  }
  return parsed.data;
}

interface Checked {
  contentType: string;
  ext: string;
  magic: MagicKind;
  maxBytes: number;
}

// Step 2: allowlist, size, ticket scope and links.
async function checkMeta(
  c: RouteContext,
  meta: FileUploadMeta
): Promise<Checked> {
  const rule = typeRuleFor(meta.kind, meta.content_type);
  if (!rule) {
    throw invalidRequest(
      `A ${meta.kind} must be one of: ${allowedTypes(meta.kind).join(", ")}.`
    );
  }
  const maxBytes = FILE_KIND_RULES[meta.kind].maxBytes;
  if (meta.size_bytes > maxBytes) {
    throw tooLarge(maxBytes);
  }
  const ticket = renderTicketOf(c.request);
  if (
    ticket &&
    !(meta.kind === "cv_pdf" && meta.links.cv_variant_id === ticket.cvvId)
  ) {
    throw invalidToken("unknown_token");
  }
  if (meta.links.cv_variant_id !== undefined && meta.kind !== "cv_pdf") {
    throw invalidRequest("Only a cv_pdf can be linked to a CV variant.");
  }
  await assertLinkTargetsOwned(c.db, c.scope, meta.links);
  if (meta.links.cv_variant_id !== undefined) {
    await assertVariantAcceptsPdf(c.db, c.scope, meta.links.cv_variant_id);
  }
  return {
    contentType: normalizeContentType(meta.content_type),
    ext: rule.ext,
    magic: rule.magic,
    maxBytes,
  };
}

// Steps 4–5: stream through the inspector into R2, then verify.
async function store(
  c: RouteContext,
  reader: MultipartReader,
  meta: FileUploadMeta,
  checked: Checked,
  file: { id: string; key: string }
): Promise<void> {
  const inspector: UploadInspector = createUploadInspector(
    Math.min(checked.maxBytes, meta.size_bytes)
  );
  const { stream, piped } = withKnownLength(
    reader.stream().pipeThrough(inspector.transform),
    meta.size_bytes
  );
  try {
    await c.env.JOBS_FILES.put(file.key, stream, {
      sha256: meta.sha256,
      httpMetadata: {
        contentType: checked.contentType,
        contentDisposition: "attachment",
      },
      customMetadata: {
        user_id: c.scope.userId,
        file_id: file.id,
        sha256: meta.sha256,
        kind: meta.kind,
      },
    });
    await piped;
  } catch (err) {
    throw classifyPutError(err, reader, inspector, meta);
  }
  const result = inspector.completed() ?? (await inspector.result);
  if (result.bytes !== meta.size_bytes) {
    throw integrity("size_mismatch", "The file size differs from size_bytes.");
  }
  if (result.sha256 !== meta.sha256.toLowerCase()) {
    throw integrity(
      "sha256_mismatch",
      "The file's SHA-256 differs from sha256."
    );
  }
  if (!magicMatches(checked.magic, result.head)) {
    throw integrity(
      "magic_mismatch",
      `The file content is not ${checked.contentType}.`
    );
  }
}

function classifyPutError(
  err: unknown,
  reader: MultipartReader,
  inspector: UploadInspector,
  meta: FileUploadMeta
): unknown {
  const overrun = inspector.failure();
  if (overrun) {
    return tooLarge(overrun.limit);
  }
  if (reader.streamError) {
    return fromMultipart(reader.streamError);
  }
  const done = inspector.completed();
  if (done && done.sha256 !== meta.sha256.toLowerCase()) {
    return integrity(
      "sha256_mismatch",
      "The file's SHA-256 differs from sha256."
    );
  }
  if (done && done.bytes !== meta.size_bytes) {
    return integrity("size_mismatch", "The file size differs from size_bytes.");
  }
  return err;
}

/** The upload handler (see the file header). */
export async function handleFileUpload(c: RouteContext): Promise<Response> {
  const length = Number(c.request.headers.get("content-length") ?? "");
  if (
    Number.isFinite(length) &&
    length > FILE_KIND_RULES.attachment.maxBytes + MULTIPART_OVERHEAD_BYTES
  ) {
    throw tooLarge(FILE_KIND_RULES.attachment.maxBytes);
  }
  let reader: MultipartReader;
  try {
    reader = MultipartReader.fromRequest(c.request);
  } catch (err) {
    throw fromMultipart(err);
  }
  try {
    const meta = await readMeta(reader);
    const checked = await checkMeta(c, meta);
    const part = await reader.nextPart();
    if (part?.name !== "file") {
      throw invalidRequest('The second part must be "file".');
    }
    const id = newId("fil", c.now);
    const key = r2KeyFor(c.scope.userId, meta.kind, id, checked.ext);
    const originalName = meta.original_name ?? part.filename ?? null;
    await insertPendingFile(c.db, c.scope, {
      id,
      kind: meta.kind,
      r2Key: key,
      contentType: checked.contentType,
      sizeBytes: meta.size_bytes,
      sha256: meta.sha256.toLowerCase(),
      originalName,
      now: c.now,
    });
    try {
      await store(c, reader, meta, checked, { id, key });
      await reader.finish();
      const response = await commitUpload(c, meta, { id, key, originalName });
      if (response.headers.get(REPLAYED_HEADER) === "true") {
        // A concurrent request with the same key won: this copy is surplus.
        await c.env.JOBS_FILES.delete(key);
        await discardPendingFile(c.db, c.scope, id);
      }
      return response;
    } catch (err) {
      await c.env.JOBS_FILES.delete(key).catch(() => undefined);
      await discardPendingFile(c.db, c.scope, id).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    await reader.cancel();
    throw isApiError(err) ? err : fromMultipart(err);
  }
}

// Step 6: one batch — ready + links + idempotency.
async function commitUpload(
  c: RouteContext,
  meta: FileUploadMeta,
  file: { id: string; key: string; originalName: string | null }
): Promise<Response> {
  const settings =
    meta.kind === "evidence_screenshot"
      ? await getUserSettings(c.db, c.scope, c.now)
      : null;
  const retention = initialRetention(
    meta.kind,
    c.now,
    settings?.evidence_retention_days ?? 0
  );
  const sha256 = meta.sha256.toLowerCase();
  const statements = markFileReadyStatements(c.db, c.scope, {
    id: file.id,
    retentionUntil: retention,
    now: c.now,
  });
  if (meta.links.cv_variant_id !== undefined) {
    const attach = await planAttachRenderedFile(c.db, c.scope, c.env, {
      cvvId: meta.links.cv_variant_id,
      file: { id: file.id, sha256 },
      now: c.now,
      source: c.changeSource,
    });
    statements.push(...attach.statements);
  }
  const view = toFileView({
    id: file.id,
    user_id: c.scope.userId,
    kind: meta.kind,
    r2_key: file.key,
    content_type: normalizeContentType(meta.content_type),
    size_bytes: meta.size_bytes,
    sha256,
    original_name: file.originalName,
    status: "ready",
    retention_until: retention,
    created_at: c.now,
  });
  return await c.commit(statements, { status: 201, body: { file: view } });
}
