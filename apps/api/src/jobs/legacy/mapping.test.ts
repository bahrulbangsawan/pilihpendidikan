import { describe, expect, it } from "bun:test";
import { legacyFingerprint } from "@pilihpendidikan/jobs-contracts/fingerprint";
import { isId } from "@pilihpendidikan/jobs-contracts/ids";
import type { JobData } from "../../types";
import type { LegacyView } from "./mapping";
import {
  calendarDate,
  descriptionOf,
  diffJobData,
  expectedFacadeView,
  parseLegacyDate,
  planLegacyRows,
  STATUS_FOR_STAGE,
  stableId,
  toJobData,
  UNKNOWN_COMPANY,
  UNTITLED_ROLE,
  viewOfRows,
} from "./mapping";

const USER = "usr_01JA6V8M3W8Z1T6Q4Y2B7K9C0D";
const NOW = Date.UTC(2026, 9, 12);

function job(fields: Partial<JobData> = {}): JobData {
  return {
    id: "acme",
    title: "Senior Engineer",
    status: "applied",
    company: "Acme",
    companyUrl: "https://www.acme.co.id/careers",
    salaryRange: "IDR 20–30 jt",
    jobDescription: ["Build", "Ship"],
    requirements: ["TS", "SQL"],
    interviewDate: "2026-03-04",
    sections: [
      {
        id: "s1",
        name: "Tasks",
        items: [{ id: "i1", title: "CV", notes: "n", url: "u", done: true }],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T12:00:00.000Z",
    ...fields,
  };
}

function rows(fields: Partial<JobData> = {}) {
  return planLegacyRows({
    job: job(fields),
    legacyId: "acme",
    userId: USER,
    now: NOW,
    rank: "i",
    mode: "import",
    actorKind: "legacy_migration",
    source: "legacy_migration",
    userJobOrigin: "legacy",
  });
}

describe("T6-12 field mapping golden tests (06 §12.2, §12.3)", () => {
  it("T6-12 maps every JobData field of a full job", async () => {
    const r = await rows();
    expect(r.posting).toMatchObject({
      owner_user_id: USER,
      source_kind: "legacy",
      title: "Senior Engineer",
      company_name: "Acme",
      canonical_url: "https://www.acme.co.id/careers",
      company_domain: "acme.co.id",
      salary: JSON.stringify({ raw: "IDR 20–30 jt" }),
      description_text: "Build\nShip",
      description_truncated: 0,
      requirements: JSON.stringify(["TS", "SQL"]),
      fingerprint: await legacyFingerprint(USER, "acme"),
      created_at: Date.parse("2026-01-01T00:00:00.000Z"),
      updated_at: Date.parse("2026-02-01T12:00:00.000Z"),
    });
    expect(r.userJob).toMatchObject({
      origin: "legacy",
      user_id: USER,
      posting_id: r.posting.id,
    });
    expect(r.application).toMatchObject({
      legacy_job_id: "acme",
      stage: "applied",
      submission_status: "submitted_verified",
      submission_method: "manual",
      submitted_at: Date.parse("2026-02-01T12:00:00.000Z"),
      last_change_source: "legacy_migration",
      sections: JSON.stringify(job().sections),
      created_at: Date.parse("2026-01-01T00:00:00.000Z"),
    });
    expect(r.interview).toMatchObject({
      scheduled_at: Date.UTC(2026, 2, 4, 9),
    });
    expect(JSON.parse(r.evidence?.signals ?? "{}")).toEqual({
      source: "legacy_status",
    });
    expect(r.evidence?.captured_at).toBe(
      Date.parse("2026-02-01T12:00:00.000Z")
    );
    const updatedAt = Date.parse("2026-02-01T12:00:00.000Z");
    expect(r.events.map((e) => JSON.parse(e.payload))).toEqual([
      {
        origin: "legacy",
        stage: "applied",
        legacy_status: "applied",
        legacy_updated_at: updatedAt,
      },
      {
        legacy_job_id: "acme",
        legacy_status: "applied",
        legacy_updated_at: updatedAt,
      },
    ]);
    expect(
      r.events.map((e) => [e.type, e.idempotency_key, e.actor_kind])
    ).toEqual([
      ["created", "legacy:acme:created", "legacy_migration"],
      ["legacy_imported", "legacy:acme:imported", "legacy_migration"],
    ]);
  });

  it("T6-12 maps every status 1:1 with its submission status", async () => {
    const expected = {
      saved: ["saved", "not_started", false],
      applied: ["applied", "submitted_verified", true],
      interviewing: ["interviewing", "submitted_verified", true],
      offer: ["offer", "submitted_verified", true],
      rejected: ["rejected", "submitted_verified", true],
      accepted: ["accepted", "submitted_verified", true],
    } as const;
    for (const [status, [stage, submission, evidence]] of Object.entries(
      expected
    )) {
      const r = await rows({ status: status as JobData["status"] });
      expect([
        r.application.stage,
        r.application.submission_status,
        r.evidence !== null,
      ]).toEqual([stage, submission, evidence]);
    }
    const rejected = await rows({ status: "rejected" });
    expect(JSON.parse(rejected.evidence?.signals ?? "{}")).toEqual({
      source: "legacy_status",
      inferred: true,
    });
  });

  it("T6-12 empty strings get the placeholders and read back as empty", async () => {
    const r = await rows({
      title: "",
      company: "",
      companyUrl: "",
      salaryRange: "",
      jobDescription: [],
    });
    expect(r.posting).toMatchObject({
      title: UNTITLED_ROLE,
      company_name: UNKNOWN_COMPANY,
      canonical_url: null,
      company_domain: null,
      salary: null,
      description_text: "",
    });
    const back = toJobData(viewOfRows(r));
    expect(back).toMatchObject({
      title: "",
      company: "",
      companyUrl: "",
      salaryRange: "",
      jobDescription: [],
    });
  });

  it("T6-12 an invalid interviewDate becomes a note, never an interview", async () => {
    for (const bad of ["next week", "2026-02-30", "2026/03/04"]) {
      const r = await rows({ interviewDate: bad });
      expect(r.interview).toBeNull();
      const note = r.events.find((e) => e.type === "note_added");
      expect(JSON.parse(note?.payload ?? "{}")).toEqual({
        text: `Legacy interview date: ${bad}`,
        kind: "legacy_interview_date",
      });
      expect(note?.idempotency_key).toBe("legacy:acme:interview_date");
    }
  });

  it("T6-12 a description over 64 KB is truncated and flagged", async () => {
    const r = await rows({ jobDescription: ["é".repeat(40_000)] });
    expect(r.posting.description_truncated).toBe(1);
    expect(
      new TextEncoder().encode(r.posting.description_text).byteLength
    ).toBeLessThanOrEqual(65_536);
  });

  it("T6-12 the row set round-trips through toJobData", async () => {
    const r = await rows();
    expect(toJobData(viewOfRows(r))).toEqual(expectedFacadeView(job(), NOW));
    expect(toJobData(viewOfRows(r))).toEqual(job());
  });

  it("T6-12 ids are deterministic per user and legacy id", async () => {
    const [a, b] = [await rows(), await rows()];
    expect(a.application.id).toBe(b.application.id);
    expect(isId("app_", a.application.id)).toBe(true);
    expect(await stableId("pst", 0, "x")).toBe(await stableId("pst", 0, "x"));
    expect(await stableId("pst", 0, "x")).not.toBe(
      await stableId("pst", 0, "y")
    );
  });
});

describe("facade read mapping (06 §12.6)", () => {
  it("is lossy for preparing/ready (saved) and withdrawn (rejected)", () => {
    expect(STATUS_FOR_STAGE.preparing).toBe("saved");
    expect(STATUS_FOR_STAGE.ready).toBe("saved");
    expect(STATUS_FOR_STAGE.withdrawn).toBe("rejected");
  });

  it("diffJobData ignores a lossy status and unchanged fields", async () => {
    const view: LegacyView = viewOfRows(await rows({ status: "saved" }));
    view.application.stage = "ready";
    expect(
      diffJobData(view, { status: "saved", title: "Senior Engineer" })
    ).toEqual({
      posting: {},
      postingChanged: false,
    });
    expect(diffJobData(view, { status: "applied", company: "" })).toMatchObject(
      {
        stage: "applied",
        posting: { company_name: UNKNOWN_COMPANY },
      }
    );
  });

  it("parses legacy dates and formats interview dates per time zone", () => {
    expect(parseLegacyDate("2026-03-04")).toBe(Date.UTC(2026, 2, 4, 9));
    expect(parseLegacyDate("2026-02-29")).toBeNull();
    expect(calendarDate(Date.UTC(2026, 2, 4, 20), "Asia/Jakarta")).toBe(
      "2026-03-05"
    );
    expect(calendarDate(Date.UTC(2026, 2, 4, 20), null)).toBe("2026-03-04");
    expect(descriptionOf(["a", "b"])).toEqual({
      text: "a\nb",
      truncated: false,
    });
  });
});
