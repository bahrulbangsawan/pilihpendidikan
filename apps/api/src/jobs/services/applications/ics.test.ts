import { describe, expect, it } from "bun:test";
import type { InterviewRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  DEFAULT_INTERVIEW_MINUTES,
  escapeText,
  foldLine,
  formatUtc,
  interviewIcs,
} from "./ics";

const ATTENDEE_RE = /ATTENDEE|ORGANIZER|mailto:/;
const FOLD_RE = /\r\n /g;

const posting = { title: "Backend Engineer", company_name: "Acme" };

function interview(overrides: Partial<InterviewRecord> = {}): InterviewRecord {
  return {
    id: "ivw_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
    user_id: "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
    application_id: "app_01JA6V8M3W8Z1T6Q4Y2B7K9C0A",
    round: 2,
    kind: "behavioral",
    scheduled_at: Date.UTC(2026, 11, 31, 23, 30),
    duration_min: null,
    timezone: null,
    location: null,
    interviewers: [],
    outcome: "pending",
    notes: "",
    revision: 3,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe("iCalendar export (RFC 5545)", () => {
  it("TB-ICS escapes backslash, semicolon, comma and newlines in TEXT values", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf\rg")).toBe(
      "a\\\\b\\;c\\,d\\ne\\nf\\ng"
    );
    expect(escapeText("plain: text")).toBe("plain: text");
  });

  it("TB-ICS formats UTC date-times without separators or milliseconds", () => {
    expect(formatUtc(Date.UTC(2026, 9, 12, 9, 5, 7, 999))).toBe(
      "20261012T090507Z"
    );
  });

  it("TB-ICS folds at 75 octets with CRLF + space and never splits a UTF-8 character", () => {
    const ascii = `DESCRIPTION:${"x".repeat(200)}`;
    const folded = foldLine(ascii).split("\r\n");
    expect(folded[0]).toHaveLength(75);
    expect(folded.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(
      folded.every((l) => new TextEncoder().encode(l).byteLength <= 75)
    ).toBe(true);
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(
      ascii
    );
    const multibyte = `SUMMARY:${"日本語🎉".repeat(30)}`;
    const parts = foldLine(multibyte).split("\r\n");
    for (const part of parts) {
      expect(new TextEncoder().encode(part).byteLength).toBeLessThanOrEqual(75);
      expect(part.includes("�")).toBe(false);
    }
    expect(parts.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(
      multibyte
    );
    expect(foldLine("SHORT:line")).toBe("SHORT:line");
  });

  it("TB-ICS builds one VEVENT with a default length, a stable UID and SEQUENCE from the revision", () => {
    const text = interviewIcs(interview(), posting, Date.UTC(2026, 9, 12));
    const lines = text.split("\r\n");
    expect(lines.at(-1)).toBe("");
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines).toContain("DTSTART:20261231T233000Z");
    const end =
      Date.UTC(2026, 11, 31, 23, 30) + DEFAULT_INTERVIEW_MINUTES * 60_000;
    expect(lines).toContain(`DTEND:${formatUtc(end)}`);
    expect(lines).toContain("DTSTAMP:20261012T000000Z");
    expect(lines).toContain(
      "UID:ivw_01JA6V8M3W8Z1T6Q4Y2B7K9C0A@jobs.pilihpendidikan.com"
    );
    expect(lines).toContain("SEQUENCE:2");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines.some((l) => l.startsWith("LOCATION:"))).toBe(false);
  });

  it("TB-ICS marks cancelled interviews, keeps a non-URL location without URL and drops e-mail addresses", () => {
    const text = interviewIcs(
      interview({
        outcome: "cancelled",
        location: "Jl. Sudirman 1, Jakarta",
        interviewers: ["hr@acme.example", "Rina (rina@acme.example)"],
      }),
      posting,
      0
    );
    const unfolded = text.replace(FOLD_RE, "");
    expect(unfolded).toContain("STATUS:CANCELLED");
    expect(unfolded).toContain("LOCATION:Jl. Sudirman 1\\, Jakarta");
    expect(unfolded).not.toContain("URL:");
    expect(unfolded).not.toContain("@acme.example");
    expect(unfolded).toContain(
      "Interviewers: [email removed]\\, Rina ([email removed])"
    );
    expect(unfolded).not.toMatch(ATTENDEE_RE);
  });

  it("TB-ICS refuses an unscheduled interview", () => {
    expect(() =>
      interviewIcs(interview({ scheduled_at: null }), posting, 0)
    ).toThrow();
  });
});
