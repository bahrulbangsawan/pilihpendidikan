// Contract-valid fixtures for the inbox, tracked jobs, automation (rules,
// tasks, attempts, approvals, evidence), sources and discovery runs, CV
// variants and files, email drafts and analytics. Like fixtures.ts, every
// factory parses its result with the contract schema, so a fixture that
// drifts from 04/05 fails loudly. Shared by the tests and scripts/mock/*.

import type {
  AnalyticsBreakdownResponse,
  AnalyticsSummaryResponse,
  AnalyticsTimeseriesResponse,
  CvVariantDetail,
  DeviceView,
  FileView,
  GetMetaResponse,
  InboxItem,
  TaskDetail,
  UserJobDetail,
} from "@pilihpendidikan/jobs-contracts/api";
import {
  AnalyticsBreakdownResponseSchema,
  AnalyticsSummaryResponseSchema,
  AnalyticsTimeseriesResponseSchema,
  CvVariantDetailSchema,
  FileViewSchema,
  GetMetaResponseSchema,
  InboxItemSchema,
  TaskDetailSchema,
  UserJobDetailSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import type { CvVariantDiff } from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import { CvVariantDiffSchema } from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import type {
  AnalyticsBreakdown,
  AnalyticsMetric,
} from "@pilihpendidikan/jobs-contracts/enums";
import type {
  ApprovalPayload,
  ApprovalRecord,
  AutomationAttemptRecord,
  AutomationRuleRecord,
  AutomationTaskRecord,
  CvVariantRecord,
  DiscoveryRunRecord,
  EmailApplicationRecord,
  JobPostingRecord,
  JobSourceRecord,
  MatchScoreRecord,
  SubmissionEvidenceRecord,
  UserJobRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  ApprovalRecordSchema,
  AutomationAttemptRecordSchema,
  AutomationRuleRecordSchema,
  AutomationTaskRecordSchema,
  CvVariantRecordSchema,
  DiscoveryRunRecordSchema,
  EmailApplicationRecordSchema,
  JobSourceRecordSchema,
  MatchScoreRecordSchema,
  SubmissionEvidenceRecordSchema,
  UserJobRecordSchema,
} from "@pilihpendidikan/jobs-contracts/records";
import { DAY, fixtureId, makePosting, NOW, USER_ID } from "./fixtures";

const HOUR = 3_600_000;
const SHA_A = "a".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);

/** A stable sha256-looking hex string for fixture `n`. */
export function fixtureSha(n: number): string {
  return n.toString(16).padStart(2, "0").repeat(32);
}

// ── Meta ────────────────────────────────────────────────────────────────────

export function makeMeta(
  overrides: Partial<GetMetaResponse> = {}
): GetMetaResponse {
  return GetMetaResponseSchema.parse({
    api_version: "1",
    min_cli_version: "1.1.0",
    recommended_cli_version: "1.2.0",
    features: ["jobs_v1"],
    ...overrides,
  });
}

// ── Devices with the dashboard report (apps/api adds `report`, 12 §7) ───────

/** The last device heartbeat on a device view (12 §7). */
export type DeviceReportFixture = NonNullable<DeviceView["report"]>;

/** A device view with the dashboard fields (signed_in, report…). */
export type DeviceWithReport = DeviceView;

export function makeDeviceReport(
  overrides: Partial<DeviceReportFixture> = {}
): DeviceReportFixture {
  return {
    browser: { mode: "managed", status: "ready" },
    cli_version: "1.2.0",
    last_sync_at: NOW - 12_000,
    local_state_summary: {},
    outbox_dead: 0,
    outbox_depth: 0,
    outbox_pending_since: null,
    reported_at: NOW - 12_000,
    ...overrides,
  };
}

// ── User jobs, inbox ────────────────────────────────────────────────────────

export function makeUserJob(
  postingId: string,
  overrides: Partial<UserJobRecord> = {}
): UserJobRecord {
  return UserJobRecordSchema.parse({
    id: fixtureId("ujb"),
    user_id: USER_ID,
    posting_id: postingId,
    origin: "discovered",
    inbox_state: "new",
    first_run_id: null,
    source_id: null,
    user_notes: "",
    revision: 1,
    created_at: NOW - 2 * HOUR,
    updated_at: NOW - 2 * HOUR,
    ...overrides,
  });
}

export function makeScoreRecord(
  postingId: string,
  overrides: Partial<MatchScoreRecord> = {}
): MatchScoreRecord {
  return MatchScoreRecordSchema.parse({
    id: fixtureId("scr"),
    user_id: USER_ID,
    posting_id: postingId,
    profile_version: 4,
    rubric_version: "r1",
    model: "gpt-6-luna",
    score: 91,
    confidence: 0.82,
    components: {
      rubric_version: "r1",
      features: {
        skills_overlap: {
          value: 0.75,
          matched: ["react", "typescript", "accessibility"],
          missing: ["graphql"],
          weight: 0.25,
        },
        title_similarity: {
          value: 0.9,
          best_target: "Frontend Engineer",
          weight: 0.15,
        },
        location_fit: { value: 1, reason: "remote_in_region", weight: 0.15 },
        seniority_fit: {
          value: 0.8,
          posting: "senior",
          user: "mid",
          weight: 0.1,
        },
        salary_fit: null,
        language_fit: {
          value: 1,
          required: ["en"],
          missing: [],
          weight: 0.05,
        },
        freshness: { value: 0.9, age_days: 2, weight: 0.05 },
      },
      ai: {
        status: "ok",
        overall_fit: { score: 3, confidence: 0.71 },
        weight: 0.2,
        predicates: {
          requires_unavailable_work_authorization: 0.05,
          requires_degree_user_lacks: 0.1,
          requires_onsite_outside_user_locations: 0.02,
        },
        refused: [],
      },
      gates: [],
      base: 0.91,
      score: 91,
    },
    explanation:
      '91 · Strong match\n✓ Skills: react, typescript, accessibility (3 of 4)  ✗ Missing: graphql\n✓ Title close to your target "Frontend Engineer"\n✓ Remote within your region\nAI fit: good (confidence 71%)',
    status: "ready",
    created_at: NOW - HOUR,
    ...overrides,
  });
}

export interface InboxItemSpec {
  company: string;
  duplicates?: number;
  inboxState?: UserJobRecord["inbox_state"];
  location?: string;
  posting?: Partial<JobPostingRecord>;
  runId?: string | null;
  score?: number | "queued" | null;
  seenAgoHours?: number;
  sourceId?: string | null;
  sourceKind?: JobPostingRecord["source_kind"];
  sourceLabel?: string | null;
  title: string;
}

function inboxScore(
  postingId: string,
  score: number | "queued" | null,
  at: number
): InboxItem["score"] {
  if (score === null) {
    return null;
  }
  const queued = score === "queued";
  return {
    posting_id: postingId,
    score: queued ? 0 : score,
    status: queued ? "queued" : "ready",
    confidence: queued ? null : 0.8,
    deterministic_only: false,
    profile_version: 4,
    rubric_version: "r1",
    explanation: queued
      ? ""
      : `${score} · Good match\n✓ Skills: react, typescript\n✓ Remote within your region`,
    created_at: at,
  };
}

function inboxPosting(
  spec: InboxItemSpec,
  runId: string | null,
  seen: number
): JobPostingRecord {
  const sourceKind = spec.sourceKind ?? "greenhouse";
  const adapter = sourceKind === "manual" ? "greenhouse" : sourceKind;
  return makePosting({
    id: fixtureId("pst"),
    title: spec.title,
    company_name: spec.company,
    source_kind: sourceKind,
    locations: [{ raw: spec.location ?? "Jakarta" }],
    first_seen_at: seen,
    last_seen_at: seen,
    extraction: {
      v: 1,
      adapter: adapter as "greenhouse",
      adapter_version: "1.0.0",
      fetch_mode: "json_api",
      method: "json_api",
      confidence: 0.97,
      observed_at: seen,
      run_id: runId,
    },
    ...spec.posting,
  });
}

export function makeInboxItem(spec: InboxItemSpec): InboxItem {
  const seen = NOW - (spec.seenAgoHours ?? 2) * HOUR;
  const runId = spec.runId === undefined ? fixtureId("run") : spec.runId;
  const posting = inboxPosting(spec, runId, seen);
  return InboxItemSchema.parse({
    user_job: makeUserJob(posting.id, {
      inbox_state: spec.inboxState ?? "new",
      first_run_id: runId,
      source_id: spec.sourceId ?? null,
      created_at: seen,
      updated_at: seen,
    }),
    posting,
    score: inboxScore(posting.id, spec.score ?? null, seen),
    provenance: {
      run_id: runId,
      source_id: spec.sourceId ?? null,
      source_label: spec.sourceLabel ?? null,
      source_kind: spec.sourceKind ?? "greenhouse",
    },
    duplicates: spec.duplicates ?? 0,
  });
}

export function makeUserJobDetail(
  overrides: Partial<UserJobDetail> = {}
): UserJobDetail {
  const posting = overrides.posting ?? makePosting();
  return UserJobDetailSchema.parse({
    user_job: makeUserJob(posting.id),
    posting,
    score: {
      posting_id: posting.id,
      score: 91,
      status: "ready",
      confidence: 0.82,
      deterministic_only: false,
      profile_version: 4,
      rubric_version: "r1",
      explanation: "91 · Strong match\n✓ Skills: react, typescript",
      created_at: NOW - HOUR,
    },
    application: null,
    ...overrides,
  });
}

// ── Sources and discovery runs ──────────────────────────────────────────────

export function makeSource(
  overrides: Partial<JobSourceRecord> = {}
): JobSourceRecord {
  return JobSourceRecordSchema.parse({
    id: fixtureId("src"),
    user_id: USER_ID,
    adapter: "greenhouse",
    label: "Acme on Greenhouse",
    config: { board_token: "acme" },
    enabled: true,
    schedule: null,
    last_run_id: null,
    last_success_at: NOW - 3 * HOUR,
    cursor_state: {},
    revision: 1,
    created_at: NOW - 20 * DAY,
    updated_at: NOW - 3 * HOUR,
    ...overrides,
  });
}

export function makeRun(
  deviceId: string,
  overrides: Partial<DiscoveryRunRecord> = {}
): DiscoveryRunRecord {
  return DiscoveryRunRecordSchema.parse({
    id: fixtureId("run"),
    user_id: USER_ID,
    device_id: deviceId,
    task_id: null,
    sources: [{ source_id: null, adapter: "greenhouse", label: "Acme" }],
    status: "completed",
    started_at: NOW - 3 * HOUR,
    finished_at: NOW - 3 * HOUR + 4 * 60_000,
    stats: {
      pages: 4,
      postings_found: 312,
      new: 48,
      updated: 12,
      unchanged: 249,
      duplicates: 0,
      invalid: 3,
      errors_by_class: {},
    },
    errors: [],
    engine_version: "pilih-jobs 1.2.0; scrapling 0.4.15",
    revision: 2,
    ...overrides,
  });
}

// ── Rules ───────────────────────────────────────────────────────────────────

export function makeRule(
  overrides: Partial<AutomationRuleRecord> = {}
): AutomationRuleRecord {
  return AutomationRuleRecordSchema.parse({
    id: fixtureId("rul"),
    user_id: USER_ID,
    name: "Frontend roles",
    enabled: true,
    mode: "approval",
    criteria: {
      min_score: 80,
      require_ai_component: false,
      max_score_age_days: 14,
      exclude_blocking_gates: true,
      exclude_possible_gates: false,
      keywords: ["react", "frontend"],
      locations: ["Remote", "Jakarta"],
      workplace_types: ["remote", "hybrid"],
    },
    limits: {
      max_per_day: 5,
      max_per_company_per_30d: 2,
      active_hours: { start: "08:00", end: "20:00" },
      expires_at: null,
    },
    allowed_domains: [],
    cv_policy: { tailor: true, require_cv_approval: true },
    activated_approval_id: null,
    revision: 2,
    created_at: NOW - 10 * DAY,
    updated_at: NOW - 2 * DAY,
    ...overrides,
  });
}

// ── Tasks, attempts, evidence ───────────────────────────────────────────────

export function makeTask(
  overrides: Partial<AutomationTaskRecord> = {}
): AutomationTaskRecord {
  return AutomationTaskRecordSchema.parse({
    id: fixtureId("tsk"),
    user_id: USER_ID,
    kind: "apply",
    application_id: fixtureId("app"),
    cv_variant_id: null,
    payload: { mode: "approval" },
    state: "running",
    target_device_id: null,
    required_capabilities: ["apply"],
    priority: 0,
    not_before: NOW - 10 * 60_000,
    expires_at: NOW + 3 * DAY,
    lease_id: fixtureId("lse"),
    lease_device_id: fixtureId("dev"),
    lease_expires_at: NOW + 90_000,
    attempt_count: 1,
    max_attempts: 3,
    submit_intent_at: null,
    pause_reason: null,
    resume_requested: false,
    retry_of: null,
    cancel_requested: false,
    progress: {
      stage: "filling",
      step: 4,
      message: "Filling form (page 2 of 3)",
    },
    local_state: null,
    error_class: null,
    error_message: null,
    created_by: "web",
    idempotency_key: `fixture:task:${NOW}`,
    revision: 4,
    created_at: NOW - 10 * 60_000,
    updated_at: NOW - 5000,
    finished_at: null,
    ...overrides,
  });
}

export function makeAttempt(
  task: Pick<AutomationTaskRecord, "id">,
  deviceId: string,
  overrides: Partial<AutomationAttemptRecord> = {}
): AutomationAttemptRecord {
  return AutomationAttemptRecordSchema.parse({
    id: fixtureId("att"),
    task_id: task.id,
    user_id: USER_ID,
    device_id: deviceId,
    lease_id: fixtureId("lse"),
    attempt_no: 1,
    started_at: NOW - 9 * 60_000,
    last_heartbeat_at: NOW - 4000,
    ended_at: null,
    outcome: null,
    error_class: null,
    steps_count: 23,
    ai_calls: 6,
    log_file_id: null,
    cli_version: "1.2.0",
    ...overrides,
  });
}

export function makeEvidence(
  applicationId: string,
  overrides: Partial<SubmissionEvidenceRecord> = {}
): SubmissionEvidenceRecord {
  return SubmissionEvidenceRecordSchema.parse({
    id: fixtureId("evd"),
    user_id: USER_ID,
    application_id: applicationId,
    task_id: null,
    attempt_id: null,
    kind: "browser_confirmation",
    verdict: "verified",
    signals: { url_match: true, dom_marker: true, http_status: 200 },
    final_url: "https://boards.greenhouse.io/acme/jobs/123/confirmation",
    page_title: "Thank you for applying",
    text_excerpt:
      "Thank you for applying to Acme. We received your application.",
    screenshot_file_id: null,
    form_hash: SHA_C,
    captured_at: NOW - 60_000,
    recorded_at: NOW - 55_000,
    ...overrides,
  });
}

export function makeTaskDetail(
  overrides: Partial<TaskDetail> = {}
): TaskDetail {
  const task = overrides.task ?? makeTask();
  const deviceId = task.lease_device_id ?? fixtureId("dev");
  return TaskDetailSchema.parse({
    task,
    attempts: [makeAttempt(task, deviceId)],
    approvals: [],
    evidence: [],
    device_name: "MacBook",
    context: null,
    ...overrides,
  });
}

// ── Approvals ───────────────────────────────────────────────────────────────

export function makeApproval(
  payload: ApprovalPayload,
  overrides: Partial<ApprovalRecord> = {}
): ApprovalRecord {
  const kindOf: Record<ApprovalPayload["type"], ApprovalRecord["kind"]> = {
    browser_submit: "submit",
    email_submit: "submit",
    answer: "answer",
    cv_variant: "cv_variant",
    rule_activation: "rule_activation",
  };
  return ApprovalRecordSchema.parse({
    id: fixtureId("apr"),
    user_id: USER_ID,
    kind: kindOf[payload.type],
    task_id: null,
    application_id: null,
    payload,
    payload_hash: SHA_C,
    state: "pending",
    response: null,
    decided_via: null,
    decided_by_user_id: null,
    decided_at: null,
    expires_at: NOW + 23 * HOUR,
    created_at: NOW - 4 * 60_000,
    revision: 1,
    ...overrides,
  });
}

export function submitPayload(postingId: string): ApprovalPayload {
  return {
    type: "browser_submit",
    form_hash: SHA_C,
    url: "https://boards.greenhouse.io/acme/jobs/123",
    posting_id: postingId,
    fields: [
      {
        label: "First name",
        value_display: "Rina",
        value_source: "fact",
        sensitivity: "personal",
        ai_written: false,
      },
      {
        label: "Email",
        value_display: "rina.wulandari@example.com",
        value_source: "fact",
        sensitivity: "personal",
        ai_written: false,
      },
      {
        label: "Years of React",
        value_display: "5",
        value_source: "answer",
        sensitivity: "none",
        ai_written: false,
      },
      {
        label: "Why Acme?",
        value_display:
          "I have built accessible design systems for education products.",
        value_source: "generated_text",
        sensitivity: "none",
        ai_written: true,
      },
      {
        label: "Are you legally allowed to work in Indonesia?",
        value_display: "(your saved answer)",
        value_source: "answer",
        sensitivity: "protected",
        ai_written: false,
      },
    ],
    attachments: [
      { file_id: fixtureId("fil"), sha256: SHA_D, name: "rina-cv-t-k3.pdf" },
    ],
    screenshot_file_id: null,
  };
}

export function answerPayload(): ApprovalPayload {
  return {
    type: "answer",
    questions: [
      {
        ref: "q1",
        question: "Do you require visa sponsorship?",
        field_kind: "radio",
        required: true,
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
        question_key: "work_auth.sponsorship_required",
        sensitivity: "protected",
        suggestion: {
          value: "no",
          value_source: "fact",
          fact_key: "work_auth.sponsorship_required",
        },
      },
      {
        ref: "q2",
        question: "What is your notice period?",
        field_kind: "text",
        required: false,
        options: [],
        question_key: null,
        sensitivity: "none",
        suggestion: null,
      },
    ],
  };
}

export function cvVariantPayload(
  cvvId: string,
  fileId: string
): ApprovalPayload {
  return {
    type: "cv_variant",
    cv_variant_id: cvvId,
    file_id: fileId,
    sha256: SHA_D,
    template: "standard",
    rephrased_bullets: 2,
    notes_for_user: ["The posting asks for GraphQL; it isn't in your CV."],
  };
}

export function ruleActivationPayload(
  rule: AutomationRuleRecord
): ApprovalPayload {
  return {
    type: "rule_activation",
    rule_id: rule.id,
    name: rule.name,
    mode: "auto",
    summary:
      "Up to 5 applications a day to Greenhouse and Lever jobs scoring 85+, at most 2 per company in 30 days, between 08:00 and 20:00.",
    criteria: rule.criteria,
    limits: rule.limits,
    allowed_domains: ["greenhouse.io", "lever.co"],
  };
}

// ── CV variants and files ───────────────────────────────────────────────────

export function makeDiff(
  overrides: Partial<CvVariantDiff> = {}
): CvVariantDiff {
  return CvVariantDiffSchema.parse({
    prompt_version: "tailor-prompt-v1",
    model: "gpt-6.1-sol",
    section_order: {
      from: ["summary", "experience", "education", "skills", "projects"],
      to: ["summary", "skills", "experience", "projects", "education"],
    },
    excluded_entries: [
      { section: "projects", entry_id: "p-3", label: "Old portfolio site" },
    ],
    bullets: [
      {
        entry_id: "exp-1",
        operation: "keep",
        text: "Led the migration of the teacher dashboard to React 18.",
        sources: [
          {
            id: "experience:exp-1:0",
            text: "Led the migration of the teacher dashboard to React 18.",
          },
        ],
      },
      {
        entry_id: "exp-1",
        operation: "rephrase",
        text: "Built an accessible component library used by 4 product teams.",
        sources: [
          {
            id: "experience:exp-1:2",
            text: "Created a component library with accessibility built in, adopted by 4 product teams.",
          },
        ],
      },
      {
        entry_id: "exp-2",
        operation: "merge",
        text: "Cut page load time by 40% with code splitting and image work.",
        sources: [
          {
            id: "experience:exp-2:0",
            text: "Introduced code splitting across the storefront.",
          },
          {
            id: "experience:exp-2:1",
            text: "Optimised images, cutting page load time by 40%.",
          },
        ],
      },
      {
        entry_id: "exp-2",
        operation: "reorder",
        text: "Mentored two junior engineers.",
        sources: [
          { id: "experience:exp-2:3", text: "Mentored two junior engineers." },
        ],
      },
    ],
    summary: {
      from: "Frontend engineer with five years of experience in education technology.",
      to: "Frontend engineer with five years of React and accessibility work in education technology.",
      sources: ["experience:exp-1:0", "experience:exp-1:2"],
    },
    notes_for_user: [
      "The posting asks for GraphQL; it isn't in your CV.",
      "Your summary now leads with React and accessibility.",
    ],
    validator: { fallbacks_to_keep: 1 },
    ...overrides,
  });
}

export function makeFileView(overrides: Partial<FileView> = {}): FileView {
  return FileViewSchema.parse({
    id: fixtureId("fil"),
    user_id: USER_ID,
    kind: "cv_pdf",
    content_type: "application/pdf",
    size_bytes: 84_213,
    sha256: SHA_D,
    original_name: "rina-wulandari-cv-t-k3m9q4x1d7.pdf",
    status: "ready",
    retention_until: null,
    created_at: NOW - HOUR,
    ...overrides,
  });
}

export function makeCvVariant(
  overrides: Partial<CvVariantRecord> = {}
): CvVariantRecord {
  return CvVariantRecordSchema.parse({
    id: fixtureId("cvv"),
    user_id: USER_ID,
    application_id: null,
    base_cv_id: "rina-wulandari",
    tailored_cv_id: "rina-wulandari-t-k3m9q4x1d7",
    template: "standard",
    status: "draft",
    file_id: null,
    diff: makeDiff(),
    model: "gpt-6.1-sol",
    approved_at: null,
    revision: 2,
    created_at: NOW - 2 * HOUR,
    updated_at: NOW - HOUR,
    ...overrides,
  });
}

export function makeCvVariantDetail(
  overrides: Partial<CvVariantDetail> = {}
): CvVariantDetail {
  const variant = overrides.cv_variant ?? makeCvVariant();
  return CvVariantDetailSchema.parse({
    cv_variant: variant,
    file: variant.file_id ? makeFileView({ id: variant.file_id }) : null,
    edited_after_approval: false,
    ...overrides,
  });
}

// ── Email drafts ────────────────────────────────────────────────────────────

export function makeEmail(
  applicationId: string,
  overrides: Partial<EmailApplicationRecord> = {}
): EmailApplicationRecord {
  return EmailApplicationRecordSchema.parse({
    id: fixtureId("eml"),
    user_id: USER_ID,
    application_id: applicationId,
    to_address: "careers@acme.example",
    subject: "Application for Senior Frontend Engineer — Rina Wulandari",
    body_text:
      "Dear Hiring Team,\n\nI am writing to apply for the Senior Frontend Engineer position at Acme.\nPlease find my CV attached.\n\nKind regards,\nRina Wulandari",
    attachment_file_ids: [],
    delivery: "local_handoff",
    status: "draft",
    provider_message_id: null,
    approved_at: null,
    sent_at: null,
    revision: 1,
    created_at: NOW - HOUR,
    updated_at: NOW - HOUR,
    ...overrides,
  });
}

// ── Analytics ───────────────────────────────────────────────────────────────

export function makeAnalyticsSummary(
  overrides: Partial<AnalyticsSummaryResponse> = {}
): AnalyticsSummaryResponse {
  const median = 6 * DAY;
  return AnalyticsSummaryResponseSchema.parse({
    from: "2026-07-14",
    to: "2026-10-12",
    tz: "Asia/Jakarta",
    cohort_size: 18,
    funnel: {
      tracked: 64,
      applied: 18,
      interviewing: 6,
      offer: 2,
      accepted: 1,
      rejected_total: 7,
      withdrawn_total: 2,
    },
    rates: {
      response_rate: 0.5,
      interview_rate: 0.33,
      offer_rate: 0.11,
      acceptance_rate: 0.5,
      rejection_rate: 0.39,
      ghosting_rate: 0.25,
    },
    rejection_by_stage: {
      before_applying: 1,
      after_applying: 4,
      after_interview: [
        { round: 1, count: 1 },
        { round: 2, count: 1 },
      ],
      after_offer: 0,
    },
    time_metrics: {
      time_to_first_response: { median, p75: 11 * DAY, n: 9 },
      time_to_interview: { median: 9 * DAY, p75: 14 * DAY, n: 6 },
      time_to_offer: { median: 24 * DAY, p75: 31 * DAY, n: 2 },
      prep_time: { median: 2 * DAY, p75: 4 * DAY, n: 15 },
    },
    automation: {
      apply_tasks: {
        submitted: 11,
        failed: 2,
        cancelled: 1,
        outcome_unknown: 1,
        expired: 0,
      },
      apply_success_rate: 0.79,
      verified_ratio: 0.82,
      pause_rate: 0.27,
      failure_classes: { login_required: 1, unsupported_form: 1 },
    },
    unconfirmed_count: 2,
    ...overrides,
  });
}

export function makeTimeseries(
  metric: AnalyticsMetric = "applied",
  values: readonly number[] = [1, 3, 2, 4, 0, 5, 3, 2, 6, 1, 2, 4, 3]
): AnalyticsTimeseriesResponse {
  // ISO weeks starting Monday 2026-07-13.
  const start = Date.UTC(2026, 6, 13);
  return AnalyticsTimeseriesResponseSchema.parse({
    metric,
    interval: "week",
    tz: "Asia/Jakarta",
    points: values.map((value, index) => ({
      bucket: new Date(start + index * 7 * DAY).toISOString().slice(0, 10),
      value,
    })),
  });
}

export function makeBreakdown(
  by: AnalyticsBreakdown = "source"
): AnalyticsBreakdownResponse {
  const rows: Record<AnalyticsBreakdown, [string, string, number][]> = {
    source: [
      ["greenhouse", "Greenhouse", 8],
      ["lever", "Lever", 5],
      ["career_page", "Career page", 3],
      ["manual", "Added by hand", 2],
    ],
    company: [
      ["acme", "Acme", 3],
      ["globex", "Globex", 2],
      ["other", "Other", 13],
    ],
    mode: [
      ["approval", "Approval", 9],
      ["assisted", "Assisted", 6],
      ["manual", "Manual", 3],
    ],
    method: [
      ["browser", "Browser", 12],
      ["email", "Email", 3],
      ["manual", "Manual", 3],
    ],
    cv_variant: [
      ["tailored", "Tailored CV", 11],
      ["base", "Base CV", 7],
    ],
    score_band: [
      ["80+", "80 and above", 9],
      ["60-79", "60–79", 6],
      ["<60", "Below 60", 2],
      ["unscored", "Unscored", 1],
    ],
    workplace_type: [
      ["remote", "Remote", 10],
      ["hybrid", "Hybrid", 5],
      ["onsite", "On-site", 3],
    ],
  };
  return AnalyticsBreakdownResponseSchema.parse({
    by,
    rows: rows[by].map(([key, label, applied]) => ({
      key,
      label,
      applied,
      interview_rate: applied >= 5 ? 0.4 : null,
      offer_rate: applied >= 5 ? 0.1 : null,
      rejection_rate: applied >= 5 ? 0.3 : null,
      n: applied,
    })),
  });
}

export {
  SHA_A as FIXTURE_SHA_A,
  SHA_C as FIXTURE_SHA_C,
  SHA_D as FIXTURE_SHA_D,
};
