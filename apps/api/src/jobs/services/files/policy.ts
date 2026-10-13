// What may be stored in R2 (05 §7, 08 §6.5, 14 §5): per `files.kind` the
// allowed content types, the size cap, the file extension of the R2 key and
// the magic bytes the first bytes of the upload must carry.
//
//   kind                 content types                         cap     magic
//   cv_pdf               application/pdf                       5 MB    %PDF-
//   cover_letter         pdf | docx | text/plain               25 MB   %PDF- | PK\x03\x04 | text
//   attachment           pdf | docx | png | jpeg               25 MB   by type
//   evidence_screenshot  png | jpeg                            25 MB   PNG / JPEG
//   run_log              application/x-ndjson | text/plain     25 MB   "{" (JSONL)
//                        | application/gzip                            1f 8b 08 (gzip, deflate)
//
// The CLI uploads its redacted step log gzipped (`steps.jsonl.gz`, 19 §11.1).
// Every cap counts the bytes as uploaded and stored, so a gzip run log is
// capped on its compressed body; the Worker never inflates it (the download
// serves the `.jsonl.gz` as it is), so a small archive cannot expand here.
//
// Retention at upload (14 §5.4): evidence screenshots keep the user's
// `evidence_retention_days` (default 180), run logs 30 days; the other kinds
// stay while referenced (`retention_until` NULL; the daily cron starts a
// 30-day clock once nothing references them).

import type { FileKind } from "@pilihpendidikan/jobs-contracts/enums";
import {
  CV_PDF_MAX_BYTES,
  FILE_UPLOAD_MAX_BYTES,
} from "@pilihpendidikan/jobs-contracts/api";
import { DAY_MS } from "../../core/clock";

/** Retention of files nothing references any more (14 §5.4). */
export const UNREFERENCED_RETENTION_MS = 30 * DAY_MS;
/** Run logs (14 §5.4). */
export const RUN_LOG_RETENTION_MS = 30 * DAY_MS;
/** Abandoned `pending` uploads are removed after 24 h (14 §5.4). */
export const PENDING_UPLOAD_TTL_MS = DAY_MS;
/** Bytes of the upload head kept for the magic-byte check. */
export const MAGIC_HEAD_BYTES = 8;

export type MagicKind =
  | "pdf"
  | "zip"
  | "png"
  | "jpeg"
  | "gzip"
  | "jsonl"
  | "text";

const PDF = "application/pdf";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PNG = "image/png";
const JPEG = "image/jpeg";
const TEXT = "text/plain";
const NDJSON = "application/x-ndjson";
const GZIP = "application/gzip";

interface TypeRule {
  ext: string;
  magic: MagicKind;
}

const TYPES: Readonly<Record<string, TypeRule>> = {
  [PDF]: { ext: ".pdf", magic: "pdf" },
  [DOCX]: { ext: ".docx", magic: "zip" },
  [PNG]: { ext: ".png", magic: "png" },
  [JPEG]: { ext: ".jpg", magic: "jpeg" },
  [TEXT]: { ext: ".txt", magic: "text" },
  [NDJSON]: { ext: ".jsonl", magic: "jsonl" },
};

interface KindRule {
  maxBytes: number;
  /** Content type → rule; run_log text/plain must still be JSONL. */
  types: Readonly<Record<string, TypeRule>>;
}

function pick(...types: string[]): Record<string, TypeRule> {
  return Object.fromEntries(types.map((t) => [t, TYPES[t]]));
}

export const FILE_KIND_RULES: Readonly<Record<FileKind, KindRule>> = {
  cv_pdf: { maxBytes: CV_PDF_MAX_BYTES, types: pick(PDF) },
  cover_letter: {
    maxBytes: FILE_UPLOAD_MAX_BYTES,
    types: pick(PDF, DOCX, TEXT),
  },
  attachment: {
    maxBytes: FILE_UPLOAD_MAX_BYTES,
    types: pick(PDF, DOCX, PNG, JPEG),
  },
  evidence_screenshot: {
    maxBytes: FILE_UPLOAD_MAX_BYTES,
    types: pick(PNG, JPEG),
  },
  run_log: {
    maxBytes: FILE_UPLOAD_MAX_BYTES,
    types: {
      [NDJSON]: TYPES[NDJSON],
      [TEXT]: { ext: ".jsonl", magic: "jsonl" },
      [GZIP]: { ext: ".jsonl.gz", magic: "gzip" },
    },
  },
};

/** `image/PNG; charset=x` → `image/png`. */
export function normalizeContentType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

/** The rule for a kind + declared content type, or null when not allowed. */
export function typeRuleFor(
  kind: FileKind,
  contentType: string
): TypeRule | null {
  return FILE_KIND_RULES[kind].types[normalizeContentType(contentType)] ?? null;
}

/** Allowed content types of a kind (error messages). */
export function allowedTypes(kind: FileKind): string[] {
  return Object.keys(FILE_KIND_RULES[kind].types);
}

function startsWith(head: Uint8Array, signature: readonly number[]): boolean {
  if (head.length < signature.length) {
    return false;
  }
  return signature.every((byte, i) => head[i] === byte);
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 (DOCX is a ZIP)
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
// RFC 1952 §2.3.1: ID1 ID2 (1f 8b) and CM = 8 (deflate, the only method).
const GZIP_MAGIC = [0x1f, 0x8b, 0x08];
const OPEN_BRACE = 0x7b;
const BINARY_SIGNATURES = [
  PDF_MAGIC,
  ZIP_MAGIC,
  PNG_MAGIC,
  JPEG_MAGIC,
  GZIP_MAGIC,
];

// Text must not be a known binary format nor carry NUL / C0 controls other
// than tab, LF and CR in its head (11 T-09 spirit for stored text).
function looksLikeText(head: Uint8Array): boolean {
  if (BINARY_SIGNATURES.some((sig) => startsWith(head, sig))) {
    return false;
  }
  return head.every(
    (byte) => byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d
  );
}

/** True when the first bytes of the upload match the declared format. */
export function magicMatches(magic: MagicKind, head: Uint8Array): boolean {
  switch (magic) {
    case "pdf":
      return startsWith(head, PDF_MAGIC);
    case "zip":
      return startsWith(head, ZIP_MAGIC);
    case "png":
      return startsWith(head, PNG_MAGIC);
    case "jpeg":
      return startsWith(head, JPEG_MAGIC);
    case "gzip":
      return startsWith(head, GZIP_MAGIC);
    case "jsonl":
      return head[0] === OPEN_BRACE && looksLikeText(head);
    default:
      return head.length > 0 && looksLikeText(head);
  }
}

/**
 * The R2 key of a file (14 §5.1): `u/{user_id}/{kind}/{fil_id}{ext}`. Built
 * only from server-side values; a client-supplied name never reaches it.
 */
export function r2KeyFor(
  userId: string,
  kind: FileKind,
  fileId: string,
  ext: string
): string {
  return `u/${userId}/${kind}/${fileId}${ext}`;
}

/** `retention_until` of a new upload (14 §5.4); null = keep while referenced. */
export function initialRetention(
  kind: FileKind,
  now: number,
  evidenceRetentionDays: number
): number | null {
  if (kind === "evidence_screenshot") {
    return now + evidenceRetentionDays * DAY_MS;
  }
  if (kind === "run_log") {
    return now + RUN_LOG_RETENTION_MS;
  }
  return null;
}

const UNSAFE_NAME_RE = /[^A-Za-z0-9 ._-]/g;
const SPACE_RUN_RE = / {2,}/g;
const LEADING_DOTS_RE = /^[.\s]+/;
const NAME_MAX = 120;

/**
 * A download file name restricted to `[A-Za-z0-9 ._-]` (08 §8): the original
 * name when it survives sanitizing with its extension, else `<fil_id><ext>`.
 */
export function safeDownloadName(
  originalName: string | null,
  fileId: string,
  ext: string
): string {
  const cleaned = (originalName ?? "")
    .normalize("NFKD")
    .replace(UNSAFE_NAME_RE, "")
    .replace(SPACE_RUN_RE, " ")
    .replace(LEADING_DOTS_RE, "")
    .trim()
    .slice(0, NAME_MAX);
  if (!cleaned) {
    return `${fileId}${ext}`;
  }
  return cleaned.toLowerCase().endsWith(ext) ? cleaned : `${cleaned}${ext}`;
}

const COMPRESSED_SUFFIX = ".gz";

/**
 * The extension at the end of an R2 key (`.pdf`), with the inner one for a
 * compressed file (`.jsonl.gz`), or "".
 */
export function extensionOfKey(key: string): string {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  if (name.slice(dot) === COMPRESSED_SUFFIX) {
    const inner = name.lastIndexOf(".", dot - 1);
    return name.slice(inner > 0 ? inner : dot);
  }
  return name.slice(dot);
}
