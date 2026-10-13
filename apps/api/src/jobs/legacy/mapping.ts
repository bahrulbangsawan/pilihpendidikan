// The legacy job shape ↔ Job Tracker rows (06 §12.2, §12.3, §12.6).
//
// Pure functions, shared by the facade (`facade.ts`, `d1.ts`), the P3
// on-the-fly migration and `scripts/migrate-jobs-kv-to-d1.ts`:
//
//   toJobData(view)          application + posting + pending interviews → the
//                            exact legacy `JobData` (lossy stage → status)
//   diffJobData(view, body)  what a legacy write changes (posting columns,
//                            stage, interview date, sections)
//   planLegacyRows(input)    the row set of one legacy job (posting, user_job,
//                            application, events, interview, evidence,
//                            change_log entries) with deterministic ids
//
// Lossy reads (documented in the MCP tool descriptions):
//   stage preparing / ready → status "saved"; withdrawn → "rejected";
//   interviewDate = the earliest pending interview (its date in the
//   interview's timezone, UTC when none); jobDescription = description_text
//   split on "\n" ("" → []).

import type {
  ActorKind,
  ChangeSource,
  Stage,
  SubmissionStatus,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  contentHash,
  legacyFingerprint,
  registrableDomain,
  sha256Hex,
} from "@pilihpendidikan/jobs-contracts/fingerprint";
import { CROCKFORD_ALPHABET } from "@pilihpendidikan/jobs-contracts/ids";
import type { LegacyJobSection } from "@pilihpendidikan/jobs-contracts/records";
import { DESCRIPTION_MAX_BYTES } from "@pilihpendidikan/jobs-contracts/records";
import type { JobData, JobStatus } from "../../types";
import { JOB_STATUSES } from "../../types";

// ---------------------------------------------------------------------------
// Status ↔ stage (06 §12.3, §12.6)
// ---------------------------------------------------------------------------

/** Legacy status → stage (1:1, 06 §12.3). */
export const STAGE_FOR_STATUS: Readonly<Record<JobStatus, Stage>> = {
  saved: "saved",
  applied: "applied",
  interviewing: "interviewing",
  offer: "offer",
  rejected: "rejected",
  accepted: "accepted",
};

/** Stage → legacy status (lossy: preparing/ready → saved, withdrawn → rejected). */
export const STATUS_FOR_STAGE: Readonly<Record<Stage, JobStatus>> = {
  saved: "saved",
  preparing: "saved",
  ready: "saved",
  applied: "applied",
  interviewing: "interviewing",
  offer: "offer",
  accepted: "accepted",
  rejected: "rejected",
  withdrawn: "rejected",
};

/** Submission status of an imported job (06 §12.3). */
export function submissionForStatus(status: JobStatus): SubmissionStatus {
  return status === "saved" ? "not_started" : "submitted_verified";
}

export function isJobStatus(value: unknown): value is JobStatus {
  return (
    typeof value === "string" &&
    (JOB_STATUSES as readonly string[]).includes(value)
  );
}

/** Text shared by every tool description that reads or writes a status. */
export const LOSSY_STATUS_NOTE =
  "Statuses are a simplified view of the board: the stages preparing and ready read as saved, withdrawn reads as rejected, and a status change must follow the board's rules (saved → applied → interviewing → offer → accepted; any open job → rejected; rejected → saved), otherwise it fails with Invalid status.";

// ---------------------------------------------------------------------------
// Placeholders (06 §12.2): NOT NULL posting columns for empty legacy strings
// ---------------------------------------------------------------------------

export const UNTITLED_ROLE = "Untitled role";
export const UNKNOWN_COMPANY = "Unknown company";

/** Postings whose placeholders read back as "" (only legacy/facade rows). */
const PLACEHOLDER_SOURCES: ReadonlySet<string> = new Set(["legacy", "manual"]);

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface LegacyPostingView {
  canonical_url: string | null;
  company_domain: string | null;
  company_name: string;
  description_text: string;
  id: string;
  owner_user_id: string | null;
  requirements: string[];
  revision: number;
  salary: LegacySalary | null;
  source_kind: string;
  title: string;
  visibility: "public" | "private";
}

export interface LegacySalary {
  currency?: string;
  max?: number;
  min?: number;
  period?: string;
  raw?: string;
}

export interface LegacyApplicationView {
  archived: boolean;
  created_at: number;
  follow_up_at: number | null;
  id: string;
  last_change_source: ChangeSource | "legacy_migration";
  legacy_job_id: string | null;
  revision: number;
  sections: LegacyJobSection[];
  stage: Stage;
  submission_status: SubmissionStatus;
  updated_at: number;
  user_job_id: string;
}

export interface LegacyInterviewView {
  id: string;
  revision: number;
  round: number;
  scheduled_at: number | null;
  timezone: string | null;
}

/** One application as the facade sees it. `interviews`: pending, earliest first. */
export interface LegacyView {
  application: LegacyApplicationView;
  interviews: LegacyInterviewView[];
  posting: LegacyPostingView;
}

/** The legacy URL key of an application: its legacy id, else its `app_` id. */
export function legacyKeyOf(application: {
  id: string;
  legacy_job_id: string | null;
}): string {
  return application.legacy_job_id ?? application.id;
}

// ---------------------------------------------------------------------------
// Field codecs
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TRAILING_REPLACEMENT_RE = /\uFFFD+$/;
const LEGACY_INTERVIEW_HOUR_UTC = 9;

/**
 * A legacy `interviewDate` ("YYYY-MM-DD", a real calendar date) as epoch ms
 * at 09:00 UTC (06 §12.2); null for anything else.
 */
export function parseLegacyDate(value: string): number | null {
  const match = DATE_RE.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const ms = Date.UTC(year, month - 1, day, LEGACY_INTERVIEW_HOUR_UTC);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/** "YYYY-MM-DD" of `ms` in `timezone` (UTC when null or unknown). */
export function calendarDate(ms: number, timezone: string | null): string {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(ms));
      const get = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}`;
    } catch {
      // unknown zone: UTC below
    }
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/** The legacy `interviewDate` of a view: the earliest pending interview. */
export function interviewDateOf(interviews: LegacyInterviewView[]): string {
  for (const interview of interviews) {
    if (interview.scheduled_at !== null) {
      return calendarDate(interview.scheduled_at, interview.timezone);
    }
  }
  return "";
}

/** ISO string of an epoch-ms timestamp (legacy `createdAt` / `updatedAt`). */
export function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** Epoch ms of a legacy ISO timestamp, or null when unparseable. */
export function msOf(value: string | undefined | null): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function formatSalary(salary: LegacySalary): string {
  const amount = (value: number | undefined) =>
    value === undefined ? "" : value.toLocaleString("en-US");
  const range =
    salary.min !== undefined && salary.max !== undefined
      ? `${amount(salary.min)}–${amount(salary.max)}`
      : amount(salary.min ?? salary.max);
  return [salary.currency, range, salary.period ? `/ ${salary.period}` : ""]
    .filter((part) => part && part.length > 0)
    .join(" ");
}

export function salaryRangeOf(salary: LegacySalary | null): string {
  if (!salary) {
    return "";
  }
  if (typeof salary.raw === "string") {
    return salary.raw;
  }
  return formatSalary(salary);
}

const SALARY_RAW_MAX = 2000;

/** `job_postings.salary` of a legacy `salaryRange` ("" → null, 06 §12.2). */
export function salaryOf(salaryRange: string): LegacySalary | null {
  return salaryRange === ""
    ? null
    : { raw: salaryRange.slice(0, SALARY_RAW_MAX) };
}

export function companyUrlOf(posting: LegacyPostingView): string {
  if (posting.canonical_url) {
    return posting.canonical_url;
  }
  return posting.company_domain ? `https://${posting.company_domain}` : "";
}

/** `jobDescription[]` → `description_text` (join "\n", ≤ 64 KB, 06 §12.2). */
export function descriptionOf(lines: readonly string[]): {
  text: string;
  truncated: boolean;
} {
  const text = lines.join("\n");
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= DESCRIPTION_MAX_BYTES) {
    return { text, truncated: false };
  }
  // Cut on a code point boundary: decode the prefix leniently, drop a
  // trailing replacement character left by a split sequence.
  const prefix = new TextDecoder()
    .decode(bytes.slice(0, DESCRIPTION_MAX_BYTES))
    .replace(TRAILING_REPLACEMENT_RE, "");
  return { text: prefix, truncated: true };
}

/** `description_text` → `jobDescription[]` ("" → []). */
export function descriptionLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

/** The legacy `title` of a posting title (placeholder → ""). */
export function legacyTitle(title: string, sourceKind: string): string {
  return title === UNTITLED_ROLE && PLACEHOLDER_SOURCES.has(sourceKind)
    ? ""
    : title;
}

/** The legacy `company` of a posting company name (placeholder → ""). */
export function legacyCompany(company: string, sourceKind: string): string {
  return company === UNKNOWN_COMPANY && PLACEHOLDER_SOURCES.has(sourceKind)
    ? ""
    : company;
}

// ---------------------------------------------------------------------------
// toJobData (06 §12.6)
// ---------------------------------------------------------------------------

/** The exact legacy shape of one application (key order of `normalizeJobData`). */
export function toJobData(view: LegacyView): JobData {
  const { application, posting } = view;
  return {
    id: legacyKeyOf(application),
    title: legacyTitle(posting.title, posting.source_kind),
    status: STATUS_FOR_STAGE[application.stage],
    company: legacyCompany(posting.company_name, posting.source_kind),
    companyUrl: companyUrlOf(posting),
    salaryRange: salaryRangeOf(posting.salary),
    jobDescription: descriptionLines(posting.description_text),
    requirements: [...posting.requirements],
    interviewDate: interviewDateOf(view.interviews),
    sections: application.sections,
    createdAt: isoOf(application.created_at),
    updatedAt: isoOf(application.updated_at),
  };
}

// ---------------------------------------------------------------------------
// diffJobData (fromJobData, 06 §12.6)
// ---------------------------------------------------------------------------

/** Posting columns a legacy write may change. */
export interface PostingChanges {
  canonical_url?: string | null;
  company_domain?: string | null;
  company_name?: string;
  description_text?: string;
  description_truncated?: boolean;
  requirements?: string[];
  salary?: LegacySalary | null;
  title?: string;
}

/** The legacy fields a write may carry (all optional for partial updates). */
export interface LegacyFieldInput {
  company?: string;
  companyUrl?: string;
  interviewDate?: string;
  jobDescription?: string[];
  requirements?: string[];
  salaryRange?: string;
  sections?: LegacyJobSection[];
  status?: JobStatus;
  title?: string;
}

export interface LegacyDiff {
  /** "" clears the next pending interview; a date sets it. */
  interviewDate?: string;
  posting: PostingChanges;
  /** True when a title / company / description edit touches the posting. */
  postingChanged: boolean;
  sections?: LegacyJobSection[];
  /** Target stage when the legacy status changes. */
  stage?: Stage;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function postingChangesOf(
  current: JobData,
  input: LegacyFieldInput
): PostingChanges {
  const changes: PostingChanges = {};
  if (input.title !== undefined && input.title !== current.title) {
    changes.title = input.title === "" ? UNTITLED_ROLE : input.title;
  }
  if (input.company !== undefined && input.company !== current.company) {
    changes.company_name =
      input.company === "" ? UNKNOWN_COMPANY : input.company;
  }
  if (
    input.companyUrl !== undefined &&
    input.companyUrl !== current.companyUrl
  ) {
    changes.canonical_url = input.companyUrl === "" ? null : input.companyUrl;
    changes.company_domain =
      input.companyUrl === "" ? null : registrableDomain(input.companyUrl);
  }
  if (
    input.salaryRange !== undefined &&
    input.salaryRange !== current.salaryRange
  ) {
    changes.salary = salaryOf(input.salaryRange);
  }
  if (
    input.jobDescription !== undefined &&
    !sameJson(input.jobDescription, current.jobDescription)
  ) {
    const description = descriptionOf(input.jobDescription);
    changes.description_text = description.text;
    changes.description_truncated = description.truncated;
  }
  if (
    input.requirements !== undefined &&
    !sameJson(input.requirements, current.requirements)
  ) {
    changes.requirements = [...input.requirements];
  }
  return changes;
}

/**
 * What a legacy write changes relative to the stored view. Fields equal to
 * what `toJobData` shows are ignored (a lossy status such as `saved` for a
 * `preparing` card is "unchanged").
 */
export function diffJobData(
  view: LegacyView,
  input: LegacyFieldInput
): LegacyDiff {
  const current = toJobData(view);
  const posting = postingChangesOf(current, input);
  const diff: LegacyDiff = {
    posting,
    postingChanged: Object.keys(posting).length > 0,
  };
  if (input.status !== undefined && input.status !== current.status) {
    diff.stage = STAGE_FOR_STATUS[input.status];
  }
  if (
    input.interviewDate !== undefined &&
    input.interviewDate !== current.interviewDate
  ) {
    diff.interviewDate = input.interviewDate;
  }
  if (
    input.sections !== undefined &&
    !sameJson(input.sections, current.sections)
  ) {
    diff.sections = input.sections;
  }
  return diff;
}

/** True when a diff writes nothing. */
export function isEmptyDiff(diff: LegacyDiff): boolean {
  return (
    !diff.postingChanged &&
    diff.stage === undefined &&
    diff.interviewDate === undefined &&
    diff.sections === undefined
  );
}

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

const ULID_TIME_LENGTH = 10;
const ULID_RANDOM_LENGTH = 16;
const MAX_ULID_TIME = 2 ** 48 - 1;

/**
 * `<prefix>_<ULID>` whose time part is `timeMs` and whose 80 "random" bits
 * come from sha256(seed): the same seed always yields the same id, so a
 * re-planned migration addresses the same rows (06 §12.4 step 4).
 */
export async function stableId(
  prefix: string,
  timeMs: number,
  seed: string
): Promise<string> {
  let time = Math.min(Math.max(Math.floor(timeMs), 0), MAX_ULID_TIME);
  let timePart = "";
  for (let i = 0; i < ULID_TIME_LENGTH; i++) {
    timePart = CROCKFORD_ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const hex = await sha256Hex(seed);
  let randomPart = "";
  // 16 base32 characters = 80 bits = the first 20 hex digits.
  let bits = BigInt(`0x${hex.slice(0, 20)}`);
  for (let i = 0; i < ULID_RANDOM_LENGTH; i++) {
    randomPart = CROCKFORD_ALPHABET[Number(bits % 32n)] + randomPart;
    bits /= 32n;
  }
  return `${prefix}_${timePart}${randomPart}`;
}

// ---------------------------------------------------------------------------
// Row set of one legacy job (06 §12.2)
// ---------------------------------------------------------------------------

export interface LegacyPostingRow {
  canonical_url: string | null;
  company_domain: string | null;
  company_name: string;
  content_hash: string;
  created_at: number;
  description_text: string;
  description_truncated: 0 | 1;
  fingerprint: string;
  first_seen_at: number;
  id: string;
  last_seen_at: number;
  owner_user_id: string;
  requirements: string;
  salary: string | null;
  source_kind: "legacy" | "manual";
  title: string;
  updated_at: number;
}

export interface LegacyUserJobRow {
  created_at: number;
  id: string;
  origin: "legacy" | "manual" | "mcp";
  posting_id: string;
  updated_at: number;
  user_id: string;
}

export interface LegacyApplicationRow {
  board_rank: string;
  created_at: number;
  id: string;
  last_change_source: ChangeSource | "legacy_migration";
  legacy_job_id: string;
  sections: string;
  stage: Stage;
  stage_changed_at: number;
  submission_method: "manual" | null;
  submission_status: SubmissionStatus;
  submitted_at: number | null;
  updated_at: number;
  user_id: string;
  user_job_id: string;
}

export interface LegacyEventRow {
  actor_kind: ActorKind;
  application_id: string;
  id: string;
  idempotency_key: string;
  occurred_at: number;
  payload: string;
  recorded_at: number;
  to_value: string | null;
  type: "created" | "legacy_imported" | "note_added";
  user_id: string;
}

export interface LegacyInterviewRow {
  application_id: string;
  created_at: number;
  id: string;
  scheduled_at: number;
  updated_at: number;
  user_id: string;
}

export interface LegacyEvidenceRow {
  application_id: string;
  captured_at: number;
  id: string;
  recorded_at: number;
  signals: string;
  user_id: string;
}

export interface LegacyRows {
  application: LegacyApplicationRow;
  events: LegacyEventRow[];
  evidence: LegacyEvidenceRow | null;
  interview: LegacyInterviewRow | null;
  legacyId: string;
  /** Server clock of the plan (`recorded_at`, change_log `changed_at`). */
  now: number;
  posting: LegacyPostingRow;
  status: JobStatus;
  userId: string;
  userJob: LegacyUserJobRow;
}

export interface LegacyRowsInput {
  /** `legacy_migration` for imports; `user` / `mcp` for facade creates. */
  actorKind: ActorKind;
  /** The normalized legacy job (`normalizeJobData`). */
  job: JobData;
  /** The legacy id (the KV key suffix / the client-chosen id). */
  legacyId: string;
  /** `import`: 06 §12.2 rows; `create`: a facade `POST` / `jobs_create`. */
  mode: "import" | "create";
  now: number;
  rank: string;
  /** `last_change_source` of the new application. */
  source: ChangeSource | "legacy_migration";
  userId: string;
  /** `user_jobs.origin`: `legacy` (import), `manual` (REST), `mcp`. */
  userJobOrigin: "legacy" | "manual" | "mcp";
  /** Extra seed for facade creates (an id may be re-created after archive). */
  nonce?: string;
}

/** createdAt / updatedAt of a legacy job as epoch ms (invalid → fallback). */
export function legacyTimes(
  job: Pick<JobData, "createdAt" | "updatedAt">,
  now: number
): { createdAt: number; updatedAt: number } {
  const updatedAt = msOf(job.updatedAt) ?? msOf(job.createdAt) ?? now;
  const createdAt = msOf(job.createdAt) ?? updatedAt;
  return { createdAt, updatedAt };
}

function attestationSignals(
  status: JobStatus,
  mode: LegacyRowsInput["mode"]
): Record<string, unknown> {
  const signals: Record<string, unknown> = {
    source: mode === "import" ? "legacy_status" : "legacy_facade",
  };
  if (status === "rejected") {
    // 06 §12.3 [ASSUMPTION]: a rejected legacy job was applied to.
    signals.inferred = true;
  }
  return signals;
}

/**
 * The rows of one legacy job (06 §12.2, §12.3). Ids are deterministic in
 * (user, legacy id[, nonce]), so re-planning the same job yields the same
 * rows. The caller supplies the board rank.
 */
export async function planLegacyRows(
  input: LegacyRowsInput
): Promise<LegacyRows> {
  const { job, userId, legacyId, now, mode } = input;
  const status = job.status;
  const stage = STAGE_FOR_STATUS[status];
  const { createdAt, updatedAt } = legacyTimes(job, now);
  const seed = `${mode}|${userId}|${legacyId}${input.nonce ? `|${input.nonce}` : ""}`;
  const id = (prefix: string, kind: string) =>
    stableId(prefix, createdAt, `${seed}|${kind}`);
  const [postingId, userJobId, appId] = await Promise.all([
    id("pst", "posting"),
    id("ujb", "user_job"),
    id("app", "application"),
  ]);
  const title = job.title === "" ? UNTITLED_ROLE : job.title;
  const company = job.company === "" ? UNKNOWN_COMPANY : job.company;
  const description = descriptionOf(job.jobDescription);
  const fingerprint = await legacyFingerprint(
    userId,
    mode === "import" ? legacyId : `${legacyId}#${appId}`
  );
  const salary = salaryOf(job.salaryRange);
  const posting: LegacyPostingRow = {
    id: postingId,
    fingerprint,
    owner_user_id: userId,
    source_kind: mode === "import" ? "legacy" : "manual",
    canonical_url: job.companyUrl === "" ? null : job.companyUrl,
    company_domain:
      job.companyUrl === "" ? null : registrableDomain(job.companyUrl),
    company_name: company,
    title,
    salary: salary ? JSON.stringify(salary) : null,
    description_text: description.text,
    description_truncated: description.truncated ? 1 : 0,
    requirements: JSON.stringify(job.requirements),
    content_hash: await contentHash(title, description.text),
    first_seen_at: createdAt,
    last_seen_at: createdAt,
    created_at: createdAt,
    updated_at: updatedAt,
  };
  const userJob: LegacyUserJobRow = {
    id: userJobId,
    user_id: userId,
    posting_id: postingId,
    origin: input.userJobOrigin,
    created_at: createdAt,
    updated_at: updatedAt,
  };
  const submission = submissionForStatus(status);
  const submitted = submission === "submitted_verified";
  const application: LegacyApplicationRow = {
    id: appId,
    user_id: userId,
    user_job_id: userJobId,
    legacy_job_id: legacyId,
    stage,
    stage_changed_at: updatedAt,
    submission_status: submission,
    submitted_at: submitted ? updatedAt : null,
    submission_method: submitted ? "manual" : null,
    board_rank: input.rank,
    sections: JSON.stringify(job.sections),
    last_change_source: input.source,
    created_at: createdAt,
    updated_at: updatedAt,
  };
  const events = await planEvents(input, appId, stage, {
    createdAt,
    updatedAt,
  });
  const interviewAt = parseLegacyDate(job.interviewDate ?? "");
  const interview: LegacyInterviewRow | null =
    interviewAt === null
      ? null
      : {
          id: await id("ivw", "interview"),
          user_id: userId,
          application_id: appId,
          scheduled_at: interviewAt,
          created_at: createdAt,
          updated_at: updatedAt,
        };
  const evidence: LegacyEvidenceRow | null = submitted
    ? {
        id: await id("evd", "evidence"),
        user_id: userId,
        application_id: appId,
        signals: JSON.stringify(attestationSignals(status, mode)),
        captured_at: updatedAt,
        recorded_at: now,
      }
    : null;
  return {
    legacyId,
    userId,
    now,
    status,
    posting,
    userJob,
    application,
    events,
    interview,
    evidence,
  };
}

async function planEvents(
  input: LegacyRowsInput,
  appId: string,
  stage: Stage,
  times: { createdAt: number; updatedAt: number }
): Promise<LegacyEventRow[]> {
  const { job, legacyId, userId, now, mode } = input;
  const { createdAt, updatedAt } = times;
  const event = async (
    kind: string,
    fields: Pick<
      LegacyEventRow,
      "type" | "payload" | "idempotency_key" | "to_value"
    >
  ): Promise<LegacyEventRow> => ({
    id: await stableId(
      "evt",
      createdAt,
      `${mode}|${userId}|${legacyId}|${input.nonce ?? ""}|${kind}`
    ),
    user_id: userId,
    application_id: appId,
    actor_kind: input.actorKind,
    occurred_at: createdAt,
    recorded_at: now,
    ...fields,
  });
  const created = await event("created", {
    type: "created",
    to_value: stage,
    // legacy_status + legacy_updated_at: analytics counts a migrated job as
    // having reached its stage at the legacy updatedAt (10 §3).
    payload: JSON.stringify({
      origin: input.userJobOrigin,
      stage,
      legacy_status: job.status,
      legacy_updated_at: updatedAt,
    }),
    idempotency_key:
      mode === "import" ? `legacy:${legacyId}:created` : `created:${appId}`,
  });
  const events = [created];
  if (mode === "import") {
    events.push(
      await event("imported", {
        type: "legacy_imported",
        to_value: null,
        payload: JSON.stringify({
          legacy_job_id: legacyId,
          legacy_status: job.status,
          legacy_updated_at: updatedAt,
        }),
        idempotency_key: `legacy:${legacyId}:imported`,
      })
    );
  }
  const rawDate = job.interviewDate ?? "";
  if (rawDate !== "" && parseLegacyDate(rawDate) === null) {
    // 06 §12.2: an unparseable interview date is kept as a note.
    events.push(
      await event("interview_note", {
        type: "note_added",
        to_value: null,
        payload: JSON.stringify({
          text: `Legacy interview date: ${rawDate}`.slice(0, 10_000),
          kind: "legacy_interview_date",
        }),
        idempotency_key: `legacy:${legacyId}:interview_date${
          mode === "import" ? "" : `:${appId}`
        }`,
      })
    );
  }
  return events;
}

// ---------------------------------------------------------------------------
// The facade view of freshly planned rows (no re-read needed)
// ---------------------------------------------------------------------------

export function viewOfRows(rows: LegacyRows): LegacyView {
  const { posting, application, interview } = rows;
  return {
    posting: {
      id: posting.id,
      visibility: "private",
      owner_user_id: posting.owner_user_id,
      source_kind: posting.source_kind,
      title: posting.title,
      company_name: posting.company_name,
      company_domain: posting.company_domain,
      canonical_url: posting.canonical_url,
      salary: posting.salary
        ? (JSON.parse(posting.salary) as LegacySalary)
        : null,
      description_text: posting.description_text,
      requirements: JSON.parse(posting.requirements) as string[],
      revision: 1,
    },
    application: {
      id: application.id,
      legacy_job_id: application.legacy_job_id,
      user_job_id: application.user_job_id,
      stage: application.stage,
      submission_status: application.submission_status,
      archived: false,
      follow_up_at: null,
      sections: JSON.parse(application.sections) as LegacyJobSection[],
      last_change_source: application.last_change_source,
      revision: 1,
      created_at: application.created_at,
      updated_at: application.updated_at,
    },
    interviews: interview
      ? [
          {
            id: interview.id,
            round: 1,
            scheduled_at: interview.scheduled_at,
            timezone: null,
            revision: 1,
          },
        ]
      : [],
  };
}

/**
 * What the facade shows for a legacy job after migration: the documented
 * lossy transformations of 06 §12.2 applied to the KV view (an invalid
 * interview date becomes "" — it is kept as a note; description lines are
 * re-split on "\n"; timestamps are re-serialized). Used by the migration's
 * verify step and the S-02 parity tests.
 */
export function expectedFacadeView(job: JobData, now: number): JobData {
  const { createdAt, updatedAt } = legacyTimes(job, now);
  const interviewAt = parseLegacyDate(job.interviewDate ?? "");
  return {
    ...job,
    jobDescription: descriptionLines(descriptionOf(job.jobDescription).text),
    salaryRange: salaryOf(job.salaryRange)?.raw ?? "",
    interviewDate: interviewAt === null ? "" : calendarDate(interviewAt, null),
    createdAt: isoOf(createdAt),
    updatedAt: isoOf(updatedAt),
  };
}

/**
 * A validated legacy create/save payload as a complete `JobData`: the
 * authoritative id, optional fields defaulted, a fixed `createdAt`
 * (`updatedAt` is stamped by the store). Shared by `POST /api/jobs` and the
 * KV backend's `PUT`.
 */
export function normalizeJobBody(
  job: JobData,
  id: string,
  createdAt: string
): JobData {
  return {
    id,
    title: job.title,
    status: job.status,
    company: job.company ?? "",
    companyUrl: job.companyUrl ?? "",
    salaryRange: job.salaryRange ?? "",
    jobDescription: job.jobDescription ?? [],
    requirements: job.requirements ?? [],
    interviewDate: job.interviewDate ?? "",
    sections: job.sections,
    createdAt,
    updatedAt: createdAt,
  };
}
