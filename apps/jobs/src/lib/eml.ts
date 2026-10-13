// The web-only email hand-off (09 §6.1): an RFC 5322 message the user opens
// in their own mail client as an editable draft (`X-Unsent: 1`), with the
// approved attachments inside, plus the `mailto:` fallback that cannot carry
// attachments. Pure and dependency-free so the BFF route and the tests share
// it. Every line ends in CRLF and every byte is 7-bit ASCII:
//
// - header text goes through `cleanHeaderText` (no CR / LF / controls, so no
//   header injection) and, when not ASCII, RFC 2047 `=?UTF-8?B?…?=` words of
//   at most 75 characters that never split a UTF-8 sequence;
// - the body is `text/plain; charset=utf-8`, base64 in 76-character lines;
// - attachments are base64 with RFC 2231 `filename*` for non-ASCII names.

const CRLF = "\r\n";
const BASE64_LINE = 76;
/** 45 bytes → 60 base64 chars; with `=?UTF-8?B?` and `?=` that is 72 ≤ 75. */
const ENCODED_WORD_BYTES = 45;
const FOLD_AT = 76;
// biome-ignore lint/suspicious/noControlCharactersInRegex: header sanitising.
const CONTROL_RE = /[\u0000-\u001f\u007f]+/g;
const WHITESPACE_RE = /\s+/g;
const ASCII_PRINTABLE_RE = /^[\u0020-\u007e]*$/;
const ADDR_SPEC_RE = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9.-]{1,253}$/;
const QUOTED_SPECIALS_RE = /["\\]/g;
const ATOM_SAFE_RE = /^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]*$/;
const FILENAME_ASCII_UNSAFE_RE = /[^A-Za-z0-9 ._-]+/g;
const DASH_RUN_RE = /-{2,}/g;
const EDGE_JUNK_RE = /^[-. ]+|[-. ]+$/g;
const COMBINING_MARKS_RE = /\p{M}+/gu;
const NEWLINES_RE = /\r\n|\r|\n/g;
const RFC2231_KEEP_RE = /[A-Za-z0-9!#$&+.^_`|~-]/;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** One line of header text: controls (CR, LF…) become spaces, runs collapse. */
export function cleanHeaderText(text: string): string {
  return text.replace(CONTROL_RE, " ").replace(WHITESPACE_RE, " ").trim();
}

function isAsciiPrintable(text: string): boolean {
  return ASCII_PRINTABLE_RE.test(text);
}

const BINARY_CHUNK = 0x80_00;

/** Standard base64 of `bytes` (no line breaks). */
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BINARY_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BINARY_CHUNK));
  }
  return btoa(binary);
}

/** Base64 in lines of at most 76 characters, CRLF-separated. */
export function base64Lines(bytes: Uint8Array): string {
  const text = base64(bytes);
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += BASE64_LINE) {
    lines.push(text.slice(i, i + BASE64_LINE));
  }
  return lines.join(CRLF);
}

/**
 * RFC 2047 B-encoded words for `text`, each ≤ 75 characters and holding whole
 * code points only (a word never ends inside a UTF-8 sequence).
 */
export function encodedWords(text: string, firstLineRoom = 75): string[] {
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk: number[] = [];
  // `=?UTF-8?B?` + `?=` is 12 characters; base64 turns 3 bytes into 4.
  const firstBytes = Math.max(3, Math.floor((firstLineRoom - 12) / 4) * 3);
  for (const char of text) {
    const bytes = encoder.encode(char);
    const budget = words.length === 0 ? firstBytes : ENCODED_WORD_BYTES;
    if (chunk.length > 0 && chunk.length + bytes.length > budget) {
      words.push(`=?UTF-8?B?${base64(Uint8Array.from(chunk))}?=`);
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length > 0) {
    words.push(`=?UTF-8?B?${base64(Uint8Array.from(chunk))}?=`);
  }
  return words;
}

/** Folds an ASCII header at spaces so lines stay near 76 characters. */
function foldAscii(name: string, value: string): string {
  const words = value.split(" ");
  const lines: string[] = [];
  let line = `${name}:`;
  for (const word of words) {
    if (line.length + 1 + word.length > FOLD_AT && line.trim().length > 0) {
      lines.push(line);
      line = ` ${word}`;
    } else {
      line += ` ${word}`;
    }
  }
  lines.push(line);
  return lines.join(CRLF);
}

/** `Name: value` with RFC 2047 encoding when needed, folded, CRLF-terminated. */
export function headerLine(name: string, value: string): string {
  const clean = cleanHeaderText(value);
  if (isAsciiPrintable(clean)) {
    return `${foldAscii(name, clean)}${CRLF}`;
  }
  const room = FOLD_AT - name.length - 2;
  return `${name}: ${encodedWords(clean, room).join(`${CRLF} `)}${CRLF}`;
}

/** True for a plain `local@domain` address (no names, comments or CR/LF). */
export function isAddrSpec(address: string): boolean {
  return ADDR_SPEC_RE.test(address);
}

/** `Display Name <addr>` (encoded or quoted as needed) or just `addr`. */
export function formatAddress(address: string, name?: string | null): string {
  const email = cleanHeaderText(address);
  if (!isAddrSpec(email)) {
    throw new Error("Invalid email address.");
  }
  const display = cleanHeaderText(name ?? "");
  if (!display) {
    return email;
  }
  if (!isAsciiPrintable(display)) {
    return `${encodedWords(display).join(" ")} <${email}>`;
  }
  if (ATOM_SAFE_RE.test(display)) {
    return `${display} <${email}>`;
  }
  return `"${display.replace(QUOTED_SPECIALS_RE, "\\$&")}" <${email}>`;
}

/** RFC 5322 date-time in UTC: `Mon, 12 Oct 2026 07:00:00 +0000`. */
export function rfc5322Date(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${WEEKDAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

/** An ASCII fallback name: `[A-Za-z0-9 ._-]`, never empty. */
export function asciiFileName(name: string, fallback = "attachment"): string {
  const ascii = name
    .normalize("NFKD")
    .replace(COMBINING_MARKS_RE, "")
    .replace(FILENAME_ASCII_UNSAFE_RE, "-")
    .replace(DASH_RUN_RE, "-")
    .replace(EDGE_JUNK_RE, "");
  return ascii || fallback;
}

/** RFC 2231 `ext-value` of `name`: `UTF-8''<percent-encoded>`. */
function rfc2231(name: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(name)) {
    const char = String.fromCharCode(byte);
    out +=
      byte < 0x80 && RFC2231_KEEP_RE.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return `UTF-8''${out}`;
}

export interface EmlAttachment {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}

export interface EmlMessage {
  attachments: readonly EmlAttachment[];
  body: string;
  /** Epoch ms of the `Date` header. */
  date: number;
  from: { address: string; name?: string | null };
  /** The id part of `Message-ID` (no angle brackets). */
  messageId: string;
  subject: string;
  to: string;
}

const MESSAGE_ID_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/;
const CONTENT_TYPE_RE = /^[a-z]+\/[a-z0-9.+-]+$/;

function attachmentPart(attachment: EmlAttachment, boundary: string): string {
  const type = CONTENT_TYPE_RE.test(attachment.contentType)
    ? attachment.contentType
    : "application/octet-stream";
  const clean = cleanHeaderText(attachment.fileName) || "attachment";
  const ascii = asciiFileName(clean);
  const extended = isAsciiPrintable(clean) && clean === ascii;
  const disposition = extended
    ? `attachment; filename="${ascii}"`
    : `attachment; filename="${ascii}"; filename*=${rfc2231(clean)}`;
  return (
    `--${boundary}${CRLF}` +
    `${foldAscii("Content-Type", `${type}; name="${ascii}"`)}${CRLF}` +
    `${foldAscii("Content-Disposition", disposition)}${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `${base64Lines(attachment.bytes)}${CRLF}`
  );
}

/** A unique multipart boundary (`-`, `=`, `_` never occur in base64 lines). */
export function emlBoundary(random: Uint8Array): string {
  return `----=_Pilih_${[...random].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The whole `.eml` (09 §6.1): `multipart/mixed` with the text and the
 * attachments, `X-Unsent: 1` so Outlook and Apple Mail open an editable draft.
 */
export function buildEml(message: EmlMessage, boundary: string): string {
  if (!MESSAGE_ID_RE.test(message.messageId)) {
    throw new Error("Invalid Message-ID.");
  }
  const body = message.body.replace(NEWLINES_RE, CRLF);
  const head =
    `${foldAscii("From", formatAddress(message.from.address, message.from.name))}${CRLF}` +
    `${foldAscii("To", formatAddress(message.to))}${CRLF}` +
    headerLine("Subject", message.subject) +
    `Date: ${rfc5322Date(message.date)}${CRLF}` +
    `Message-ID: <${message.messageId}>${CRLF}` +
    `MIME-Version: 1.0${CRLF}` +
    `X-Unsent: 1${CRLF}` +
    `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}`;
  const text =
    `--${boundary}${CRLF}` +
    `Content-Type: text/plain; charset=utf-8${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `${base64Lines(new TextEncoder().encode(body))}${CRLF}`;
  const parts = message.attachments
    .map((attachment) => attachmentPart(attachment, boundary))
    .join("");
  return `${head}${CRLF}${text}${parts}--${boundary}--${CRLF}`;
}

/** Above this length some mail clients drop a `mailto:` link. */
export const MAILTO_SAFE_LENGTH = 1800;

/** The `mailto:` fallback: recipient, subject and body, no attachments. */
export function mailtoHref(to: string, subject: string, body: string): string {
  const address = cleanHeaderText(to);
  if (!isAddrSpec(address)) {
    throw new Error("Invalid email address.");
  }
  const query = [
    `subject=${encodeURIComponent(cleanHeaderText(subject))}`,
    `body=${encodeURIComponent(body.replace(NEWLINES_RE, "\r\n"))}`,
  ].join("&");
  return `mailto:${encodeURIComponent(address).replace("%40", "@")}?${query}`;
}
