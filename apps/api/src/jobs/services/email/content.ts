// The approved content of an email application (09 §4, §8).
//
// Approval binding: `payload_hash = sha256(canonical{to, cc, subject,
// body_text, attachments: [sha256…]})` where canonical = JSON with keys
// sorted at every level and no whitespace, `attachments` the attachment
// SHA-256 values in attachment order, and `cc` = [users.email] for
// `server_send` (the applicant keeps a copy) or [] for `local_handoff`.
// Any change to recipient, subject, body or an attachment changes the hash,
// so an approval recorded for other content no longer applies.
//
// Content limits (validated at draft and at send): plain-text body ≤ 20 KB of
// UTF-8, a one-line subject ≤ 300 characters, ≤ 5 attachments, ≤ 10 MB in
// total, PDF or DOCX only.

import { EMAIL_LIMITS } from "@pilihpendidikan/jobs-contracts/email";
import type { EmailDelivery } from "@pilihpendidikan/jobs-contracts/enums";
import { apiError, invalidRequest } from "../../core/http";

export const SUBJECT_MAX_CHARS = 300;
export const PDF_TYPE = "application/pdf";
export const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Content types an email application may carry (09 §8). */
export const ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  PDF_TYPE,
  DOCX_TYPE,
]);
/** File kinds an email application may attach (09 §5.3). */
export const ATTACHMENT_KINDS: ReadonlySet<string> = new Set([
  "cv_pdf",
  "cover_letter",
  "attachment",
]);

export interface ContentAttachment {
  content_type: string;
  file_id: string;
  name: string;
  sha256: string;
  size_bytes: number;
}

export interface EmailContent {
  attachments: readonly ContentAttachment[];
  body_text: string;
  cc: readonly string[];
  subject: string;
  to: string;
}

const LINE_BREAK_RE = /[\r\n]/;
const CONTROL_RE = /(?![\t\n])\p{Cc}/u;
const PATH_SEPARATOR_RE = /[/\\]/g;
const CONTROLS_RE = /\p{Cc}/gu;

function toHex(bytes: ArrayBuffer): string {
  let out = "";
  for (const byte of new Uint8Array(bytes)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/** SHA-256 of text or bytes as lowercase hex. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON with sorted keys at every level and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The canonical object the approval hash covers (09 §4). */
export function canonicalContent(content: EmailContent) {
  return {
    to: content.to,
    cc: [...content.cc],
    subject: content.subject,
    body_text: content.body_text,
    attachments: content.attachments.map((attachment) => attachment.sha256),
  };
}

/** `payload_hash` of the content (09 §4). */
export function emailPayloadHash(content: EmailContent): Promise<string> {
  return sha256Hex(canonicalJson(canonicalContent(content)));
}

/** The Cc of a delivery: the verified account address for server_send. */
export function ccFor(delivery: EmailDelivery, accountEmail: string): string[] {
  return delivery === "server_send" ? [accountEmail] : [];
}

/** UTF-8 size of a text. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** 400 unless the subject is one line of ≤ 300 printable characters. */
export function assertSubject(subject: string): void {
  if (
    subject.trim() === "" ||
    subject.length > SUBJECT_MAX_CHARS ||
    LINE_BREAK_RE.test(subject) ||
    CONTROL_RE.test(subject)
  ) {
    throw invalidRequest("The subject must be one line of text.", [
      { path: ["subject"], message: "one line, 1–300 characters" },
    ]);
  }
}

/** 400 unless the body is plain text of ≤ 20 KB (UTF-8). */
export function assertBody(body: string): void {
  if (body.trim() === "") {
    throw invalidRequest("The email body is empty.", [
      { path: ["body_text"], message: "required" },
    ]);
  }
  if (utf8Bytes(body) > EMAIL_LIMITS.bodyBytes) {
    throw invalidRequest(
      `The email body is larger than ${EMAIL_LIMITS.bodyBytes} bytes.`,
      [{ path: ["body_text"], message: "at most 20 KB of UTF-8" }]
    );
  }
  if (CONTROL_RE.test(body)) {
    throw invalidRequest("The email body contains control characters.", [
      { path: ["body_text"], message: "plain text only" },
    ]);
  }
}

/** A file row as the attachment checks see it. */
export interface AttachmentFile {
  content_type: string;
  id: string;
  kind: string;
  original_name: string | null;
  r2_key: string;
  sha256: string;
  size_bytes: number;
  status: string;
}

function policy(reason: string, message: string, details = {}) {
  return apiError("policy_violation", message, {
    details: { reason, ...details },
  });
}

/** The download name of an attachment (no path, a sane extension). */
export function attachmentName(file: AttachmentFile): string {
  const extension = file.content_type === DOCX_TYPE ? ".docx" : ".pdf";
  const base = (file.original_name ?? "")
    .replace(PATH_SEPARATOR_RE, "_")
    .replace(CONTROLS_RE, "")
    .trim()
    .slice(0, 200);
  if (base === "") {
    return file.kind === "cv_pdf" ? `CV${extension}` : `attachment${extension}`;
  }
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

/**
 * Checks the requested attachments (09 §5.3, §8): the user's own ready files
 * of kind cv_pdf / cover_letter / attachment, PDF or DOCX, ≤ 5 and ≤ 10 MB in
 * total, no duplicates. Returns them in request order.
 */
export function checkAttachments(
  requested: readonly string[],
  files: readonly AttachmentFile[]
): ContentAttachment[] {
  if (requested.length > EMAIL_LIMITS.attachments) {
    throw invalidRequest(
      `At most ${EMAIL_LIMITS.attachments} attachments are allowed.`,
      [{ path: ["attachment_file_ids"], message: "too many attachments" }]
    );
  }
  if (new Set(requested).size !== requested.length) {
    throw invalidRequest("An attachment is listed twice.", [
      { path: ["attachment_file_ids"], message: "duplicate file id" },
    ]);
  }
  const byId = new Map(files.map((file) => [file.id, file]));
  const out: ContentAttachment[] = [];
  let total = 0;
  for (const id of requested) {
    const file = byId.get(id);
    if (!file || file.status !== "ready") {
      throw policy(
        "attachment_unavailable",
        "An attachment is not available.",
        {
          file_id: id,
        }
      );
    }
    if (!ATTACHMENT_KINDS.has(file.kind)) {
      throw policy(
        "attachment_kind",
        "Only CVs, cover letters and attachments can be sent.",
        { file_id: id, kind: file.kind }
      );
    }
    if (!ATTACHMENT_TYPES.has(file.content_type)) {
      throw policy(
        "attachment_type",
        "Email applications carry PDF or DOCX files only.",
        { file_id: id, content_type: file.content_type }
      );
    }
    total += file.size_bytes;
    out.push({
      file_id: file.id,
      sha256: file.sha256,
      name: attachmentName(file),
      size_bytes: file.size_bytes,
      content_type: file.content_type,
    });
  }
  if (total > EMAIL_LIMITS.attachmentBytesTotal) {
    throw policy(
      "attachments_too_large",
      "Attachments are larger than 10 MB in total.",
      { total_bytes: total, limit_bytes: EMAIL_LIMITS.attachmentBytesTotal }
    );
  }
  return out;
}
