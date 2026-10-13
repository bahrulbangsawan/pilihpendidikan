// iCalendar export of one interview (06 §6.1, RFC 5545): one VEVENT, times
// in UTC, no ATTENDEE / ORGANIZER properties and no e-mail addresses
// (interviewer names that contain one are redacted). TEXT values are escaped
// (`\\`, `\;`, `\,`, `\n`) and content lines are folded at 75 octets without
// splitting a UTF-8 sequence; lines end in CRLF.

import type {
  InterviewRecord,
  JobPostingRecord,
} from "@pilihpendidikan/jobs-contracts/records";

/** Default event length when the interview has no `duration_min`. */
export const DEFAULT_INTERVIEW_MINUTES = 60;
const MAX_LINE_OCTETS = 75;
const PRODID = "-//pilihpendidikan//Job Tracker//EN";
const UID_DOMAIN = "jobs.pilihpendidikan.com";

const EMAIL_RE = /[^\s<>()@,;:"]+@[^\s<>()@,;:"]+\.[^\s<>()@,;:"]+/g;
const NEWLINE_RE = /\r\n|\r|\n/g;
const TEXT_SPECIAL_RE = /[\\;,]/g;
const URL_RE = /^https?:\/\/\S+$/i;
const DATE_PUNCTUATION_RE = /[-:]/g;
const MILLIS_RE = /\.\d{3}/;

const KIND_LABELS: Readonly<Record<InterviewRecord["kind"], string>> = {
  phone_screen: "Phone screen",
  technical: "Technical interview",
  take_home: "Take-home assignment",
  onsite: "Onsite interview",
  behavioral: "Behavioral interview",
  final: "Final interview",
  other: "Interview",
};

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeText(value: string): string {
  return value
    .replace(TEXT_SPECIAL_RE, (c) => `\\${c}`)
    .replace(NEWLINE_RE, "\\n");
}

/** RFC 5545 §3.3.5 UTC date-time, e.g. `20261012T090000Z`. */
export function formatUtc(epochMs: number): string {
  return new Date(epochMs)
    .toISOString()
    .replace(DATE_PUNCTUATION_RE, "")
    .replace(MILLIS_RE, "");
}

/**
 * RFC 5545 §3.1 folding: content lines longer than 75 octets continue on a
 * new line that starts with one space; multi-byte characters stay whole.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  // Continuation lines carry a leading space, so they hold 74 octets.
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const size = encoder.encode(char).byteLength;
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function redactEmails(value: string): string {
  return value.replace(EMAIL_RE, "[email removed]");
}

function summaryOf(
  interview: InterviewRecord,
  posting: Pick<JobPostingRecord, "company_name" | "title">
): string {
  const kind = KIND_LABELS[interview.kind];
  return `${kind} (round ${interview.round}): ${posting.title} at ${posting.company_name}`;
}

function descriptionOf(
  interview: InterviewRecord,
  posting: Pick<JobPostingRecord, "company_name" | "title">
): string {
  const lines = [`${posting.title} at ${posting.company_name}`];
  const names = interview.interviewers
    .map((name) => redactEmails(name).trim())
    .filter((name) => name.length > 0);
  if (names.length > 0) {
    lines.push(`Interviewers: ${names.join(", ")}`);
  }
  if (interview.timezone) {
    lines.push(`Time zone: ${interview.timezone}`);
  }
  if (interview.notes.trim().length > 0) {
    lines.push("", interview.notes.trim());
  }
  return lines.join("\n");
}

/**
 * The `.ics` body of a scheduled interview. `now` is the DTSTAMP.
 * `interview.scheduled_at` must be set.
 */
export function interviewIcs(
  interview: InterviewRecord,
  posting: Pick<JobPostingRecord, "company_name" | "title">,
  now: number
): string {
  if (interview.scheduled_at === null) {
    throw new Error("interviewIcs needs a scheduled interview");
  }
  const start = interview.scheduled_at;
  const minutes = interview.duration_min ?? DEFAULT_INTERVIEW_MINUTES;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${interview.id}@${UID_DOMAIN}`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(start + minutes * 60_000)}`,
    `SEQUENCE:${interview.revision - 1}`,
    `SUMMARY:${escapeText(summaryOf(interview, posting))}`,
    `DESCRIPTION:${escapeText(descriptionOf(interview, posting))}`,
  ];
  const location = interview.location?.trim();
  if (location) {
    lines.push(`LOCATION:${escapeText(location)}`);
    if (URL_RE.test(location)) {
      lines.push(`URL:${location}`);
    }
  }
  lines.push(
    `STATUS:${interview.outcome === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR"
  );
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
