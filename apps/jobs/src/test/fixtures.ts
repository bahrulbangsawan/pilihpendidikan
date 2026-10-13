// Contract-valid fixtures for tests and the dev mock api
// (scripts/mock-api.ts). Every factory parses its result with the contract
// schema, so a fixture that drifts from 04/05 fails loudly.

import type {
  ApplicationDetail,
  BoardCard,
  BoardResponse,
  DeviceView,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  ApplicationDetailSchema,
  BoardCardSchema,
  BoardResponseSchema,
  DeviceViewSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { STAGES } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationEventRecord,
  ApplicationRecord,
  InterviewRecord,
  JobPostingRecord,
  OfferRecord,
  UserSettingsRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  ApplicationEventRecordSchema,
  ApplicationRecordSchema,
  InterviewRecordSchema,
  JobPostingRecordSchema,
  OfferRecordSchema,
  USER_SETTINGS_DEFAULTS,
  UserSettingsRecordSchema,
} from "@pilihpendidikan/jobs-contracts/records";

export const NOW = Date.UTC(2026, 9, 12, 7, 0, 0);
export const DAY = 86_400_000;
export const USER_ID = newId("usr", NOW - 90 * DAY);
const SHA = "a".repeat(64);
const FP = `fp1:${"b".repeat(64)}`;

let counter = 0;
/** Deterministic, ordered ids (a ULID per call, one ms apart). */
export function fixtureId(prefix: Parameters<typeof newId>[0]): string {
  counter += 1;
  return newId(prefix, NOW - 30 * DAY + counter);
}

export function rank(index: number): string {
  return `m${String(index).padStart(4, "0")}`;
}

export interface CardSpec {
  company: string;
  id?: string;
  location?: string;
  mode?: BoardCard["mode"];
  score?: number | "queued" | null;
  source?: BoardCard["posting"]["source_kind"];
  stage: Stage;
  title: string;
  updatedAgoDays?: number;
}

export function makeCard(
  spec: CardSpec,
  index = 0,
  overrides: Partial<BoardCard> = {}
): BoardCard {
  const id = spec.id ?? fixtureId("app");
  const postingId = fixtureId("pst");
  const updated = NOW - (spec.updatedAgoDays ?? 1) * DAY;
  const score = spec.score ?? null;
  const card: BoardCard = {
    id,
    revision: 3,
    user_job_id: fixtureId("ujb"),
    legacy_job_id: null,
    stage: spec.stage,
    stage_changed_at: updated,
    board_rank: rank(index),
    submission_status: [
      "applied",
      "interviewing",
      "offer",
      "accepted",
    ].includes(spec.stage)
      ? "submitted_verified"
      : "not_started",
    mode: spec.mode ?? "approval",
    priority: 0,
    archived: false,
    follow_up_at: null,
    follow_up_due: false,
    cv_variant_id: null,
    updated_at: updated,
    posting: {
      id: postingId,
      title: spec.title,
      company_name: spec.company,
      company_domain: null,
      location: spec.location ?? "Jakarta",
      workplace_type: "hybrid",
      source_kind: spec.source ?? "greenhouse",
      apply_url: `https://boards.greenhouse.io/${spec.company.toLowerCase().replaceAll(" ", "")}/jobs/${index + 1}`,
      status: "open",
      closed_at: null,
    },
    score:
      score === null
        ? null
        : {
            posting_id: postingId,
            score: score === "queued" ? 0 : score,
            status: score === "queued" ? "queued" : "ready",
            confidence: 0.8,
            deterministic_only: false,
            profile_version: 4,
            rubric_version: "r1",
            explanation: "Strong skills overlap.",
            created_at: updated,
          },
    live_task: null,
    next_interview_at: null,
    latest_offer_status: null,
    ...overrides,
  };
  return BoardCardSchema.parse(card);
}

export function makeBoard(
  cards: readonly BoardCard[],
  counts: Partial<BoardResponse["counts"]> = {}
): BoardResponse {
  const board: BoardResponse = {
    columns: STAGES.map((stage) => {
      const stageCards = cards.filter((card) => card.stage === stage);
      return {
        stage,
        cards: stageCards,
        total: stageCards.length,
        has_more: false,
      };
    }),
    counts: {
      approvals_pending: 0,
      inbox_new: 0,
      follow_ups_due: cards.filter((card) => card.follow_up_due).length,
      unconfirmed: cards.filter(
        (card) => card.submission_status === "submitted_unverified"
      ).length,
      tasks_live: cards.filter((card) => card.live_task !== null).length,
      ...counts,
    },
    cursor: 42,
    generated_at: NOW,
  };
  return BoardResponseSchema.parse(board);
}

export function makeApplication(
  overrides: Partial<ApplicationRecord> = {}
): ApplicationRecord {
  return ApplicationRecordSchema.parse({
    id: fixtureId("app"),
    user_id: USER_ID,
    user_job_id: fixtureId("ujb"),
    legacy_job_id: null,
    stage: "ready",
    stage_changed_at: NOW - 2 * DAY,
    submission_status: "not_started",
    submitted_at: null,
    submission_method: null,
    mode: "approval",
    automation_rule_id: null,
    cv_variant_id: null,
    base_cv_id: null,
    priority: 0,
    board_rank: rank(1),
    archived: false,
    follow_up_at: null,
    sections: [],
    last_change_source: "web",
    revision: 5,
    created_at: NOW - 10 * DAY,
    updated_at: NOW - 2 * DAY,
    ...overrides,
  });
}

export function makePosting(
  overrides: Partial<JobPostingRecord> = {}
): JobPostingRecord {
  return JobPostingRecordSchema.parse({
    id: fixtureId("pst"),
    fingerprint: FP,
    visibility: "public",
    owner_user_id: null,
    source_kind: "greenhouse",
    source_org: "acme",
    source_job_ref: "123",
    canonical_url: "https://boards.greenhouse.io/acme/jobs/123",
    apply_url: "https://boards.greenhouse.io/acme/jobs/123",
    apply_domain: "greenhouse.io",
    company_name: "Acme",
    company_domain: "acme.example",
    title: "Senior Frontend Engineer",
    department: "Engineering",
    locations: [{ raw: "Remote (APAC)" }],
    workplace_type: "remote",
    employment_type: "full_time",
    seniority: "senior",
    salary: {
      min: 25_000_000,
      max: 35_000_000,
      currency: "IDR",
      period: "month",
    },
    description_text:
      "We build tools for teachers.\nYou will own the web app end to end.\n\nApply at https://acme.example/careers",
    description_truncated: false,
    requirements: ["5+ years of React", "TypeScript", "Accessibility know-how"],
    content_hash: SHA,
    dedupe_group: null,
    posted_at: NOW - 3 * DAY,
    first_seen_at: NOW - 3 * DAY,
    last_seen_at: NOW - DAY,
    last_checked_at: NOW - DAY,
    status: "open",
    closed_at: null,
    missed_runs: 0,
    extraction: {},
    application_support: "browser_supported",
    revision: 1,
    created_at: NOW - 3 * DAY,
    updated_at: NOW - DAY,
    ...overrides,
  });
}

export function makeEvent(
  applicationId: string,
  overrides: Partial<ApplicationEventRecord> &
    Pick<ApplicationEventRecord, "type" | "payload">
): ApplicationEventRecord {
  return ApplicationEventRecordSchema.parse({
    id: fixtureId("evt"),
    user_id: USER_ID,
    application_id: applicationId,
    from_value: null,
    to_value: null,
    actor_kind: "user",
    actor_device_id: null,
    task_id: null,
    attempt_id: null,
    applied_to_state: true,
    occurred_at: NOW - DAY,
    recorded_at: NOW - DAY,
    idempotency_key: `fixture:${counter}`,
    ...overrides,
  });
}

export function makeInterview(
  applicationId: string,
  overrides: Partial<InterviewRecord> = {}
): InterviewRecord {
  return InterviewRecordSchema.parse({
    id: fixtureId("ivw"),
    user_id: USER_ID,
    application_id: applicationId,
    round: 1,
    kind: "technical",
    scheduled_at: NOW + 2 * DAY,
    duration_min: 60,
    timezone: "Asia/Jakarta",
    location: "https://meet.example/abc",
    interviewers: ["Dewi"],
    outcome: "pending",
    notes: "",
    revision: 1,
    created_at: NOW - DAY,
    updated_at: NOW - DAY,
    ...overrides,
  });
}

export function makeOffer(
  applicationId: string,
  overrides: Partial<OfferRecord> = {}
): OfferRecord {
  return OfferRecordSchema.parse({
    id: fixtureId("ofr"),
    user_id: USER_ID,
    application_id: applicationId,
    received_at: NOW - DAY,
    compensation: { base: 30_000_000, currency: "IDR", period: "month" },
    deadline_at: NOW + 5 * DAY,
    status: "open",
    notes: "",
    revision: 1,
    created_at: NOW - DAY,
    updated_at: NOW - DAY,
    ...overrides,
  });
}

export function makeDetail(
  overrides: Partial<ApplicationDetail> = {}
): ApplicationDetail {
  const application = overrides.application ?? makeApplication();
  const posting = overrides.posting ?? makePosting();
  return ApplicationDetailSchema.parse({
    application,
    user_job: {
      id: application.user_job_id,
      user_id: USER_ID,
      posting_id: posting.id,
      origin: "manual",
      inbox_state: "tracked",
      first_run_id: null,
      source_id: null,
      user_notes: "",
      revision: 1,
      created_at: NOW - 10 * DAY,
      updated_at: NOW - 10 * DAY,
    },
    posting,
    score: null,
    cv_variants: [],
    interviews: [],
    offers: [],
    approvals: [],
    tasks: [],
    evidence: [],
    emails: [],
    ...overrides,
  });
}

export function makeSettings(
  overrides: Partial<UserSettingsRecord> = {}
): UserSettingsRecord {
  return UserSettingsRecordSchema.parse({
    user_id: USER_ID,
    ...USER_SETTINGS_DEFAULTS,
    revision: 2,
    updated_at: NOW - DAY,
    ...overrides,
  });
}

export function makeDevice(overrides: Partial<DeviceView> = {}): DeviceView {
  return DeviceViewSchema.parse({
    id: fixtureId("dev"),
    user_id: USER_ID,
    name: "MacBook",
    platform: "macos",
    arch: "arm64",
    cli_version: "1.2.0",
    public_key: null,
    capabilities: ["discover", "apply", "render_cv", "headed_browser"],
    accepts_tasks: true,
    created_at: NOW - 20 * DAY,
    last_seen_at: NOW - 60_000,
    revoked_at: null,
    revision: 1,
    online: true,
    active: false,
    ...overrides,
  });
}

/** A realistic board: every open column populated, some closed cards. */
export function sampleBoard(): BoardResponse {
  const specs: CardSpec[] = [
    {
      stage: "saved",
      company: "Acme",
      title: "Frontend Engineer",
      score: 87,
      source: "greenhouse",
    },
    {
      stage: "saved",
      company: "Tokopedia",
      title: "Software Engineer, Payments",
      score: 72,
      source: "lever",
      location: "Jakarta",
    },
    {
      stage: "saved",
      company: "Globex",
      title: "Data Analyst",
      score: "queued",
      source: "career_page",
    },
    {
      stage: "preparing",
      company: "Gojek",
      title: "Platform Engineer",
      score: 81,
      source: "ashby",
      mode: "assisted",
    },
    {
      stage: "ready",
      company: "Initech",
      title: "Site Reliability Engineer",
      score: 64,
      source: "workable",
    },
    {
      stage: "ready",
      company: "Traveloka",
      title: "Mobile Engineer (iOS)",
      score: 90,
      source: "greenhouse",
      mode: "auto",
    },
    {
      stage: "applied",
      company: "Umbrella",
      title: "Backend Engineer",
      score: 77,
      updatedAgoDays: 24,
    },
    {
      stage: "applied",
      company: "Bukalapak",
      title: "QA Engineer",
      score: 58,
      mode: "manual",
      updatedAgoDays: 3,
    },
    {
      stage: "interviewing",
      company: "Shopee",
      title: "Product Engineer",
      score: 83,
    },
    { stage: "offer", company: "Halodoc", title: "Frontend Lead", score: 88 },
    { stage: "rejected", company: "Hooli", title: "Staff Engineer", score: 55 },
    {
      stage: "withdrawn",
      company: "Vehement",
      title: "Support Engineer",
      score: 40,
    },
  ];
  const perStage = new Map<Stage, number>();
  const cards = specs.map((spec) => {
    const index = perStage.get(spec.stage) ?? 0;
    perStage.set(spec.stage, index + 1);
    return makeCard(spec, index);
  });
  const withExtras = cards.map((card) => {
    if (card.posting.company_name === "Initech") {
      return BoardCardSchema.parse({
        ...card,
        cv_variant_id: fixtureId("cvv"),
        live_task: {
          id: fixtureId("tsk"),
          kind: "apply",
          state: "running",
          device_id: fixtureId("dev"),
          device_name: "MacBook",
          pause_reason: null,
          progress_stage: "filling",
          submit_intent_at: null,
          updated_at: NOW - 60_000,
        },
      });
    }
    if (card.posting.company_name === "Bukalapak") {
      return BoardCardSchema.parse({
        ...card,
        submission_status: "submitted_unverified",
        follow_up_at: NOW - DAY,
        follow_up_due: true,
      });
    }
    if (card.posting.company_name === "Shopee") {
      return BoardCardSchema.parse({
        ...card,
        next_interview_at: NOW + 2 * DAY,
        priority: 1,
      });
    }
    if (card.posting.company_name === "Halodoc") {
      return BoardCardSchema.parse({ ...card, latest_offer_status: "open" });
    }
    if (card.posting.company_name === "Globex") {
      return BoardCardSchema.parse({
        ...card,
        posting: { ...card.posting, status: "closed", closed_at: NOW - DAY },
      });
    }
    return card;
  });
  return makeBoard(withExtras, { approvals_pending: 2, inbox_new: 12 });
}
