// Realistic example payloads: one row per table and one request/query/
// response per route. The TypeScript tests round-trip them (TC-ROUNDTRIP)
// and `bun run build` writes them to examples/*.json for the CLI's Pydantic
// round-trip tests (16 §481).
import adaptersFile from "../adapters.json" with { type: "json" };
import { CROCKFORD_ALPHABET } from "../src/ids";

const ULID_HEAD = "01JA6V8M3W8Z1T6Q4Y2B7K9C";

/** Deterministic canonical id: `<prefix>_01JA6V8M3W8Z1T6Q4Y2B7K9C<2 chars>`. */
export function fixedId(prefix: string, n = 0): string {
  return `${prefix}_${ULID_HEAD}${CROCKFORD_ALPHABET.charAt(Math.floor(n / 32) % 32)}${CROCKFORD_ALPHABET.charAt(n % 32)}`;
}

export const T = 1_791_770_000_000;
const MIN = 60_000;
const DAY = 86_400_000;
export const SHA =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const SHA2 = "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752";
const FORM_HASH =
  "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a";

export const USR = fixedId("usr");
const GRT = fixedId("grt");
const RFT = fixedId("rft");
const DEV = fixedId("dev");
const SAL = fixedId("sal");
const PST = fixedId("pst");
const UJB = fixedId("ujb");
const APP = fixedId("app");
const APP2 = fixedId("app", 2);
const EVT = fixedId("evt");
const IVW = fixedId("ivw");
const OFR = fixedId("ofr");
const FCT = fixedId("fct");
const ANS = fixedId("ans");
const SCR = fixedId("scr");
const RUL = fixedId("rul");
const SRC = fixedId("src");
const RUN = fixedId("run");
const FIL = fixedId("fil");
const FIL_SHOT = fixedId("fil", 3);
const FIL_LOG = fixedId("fil", 4);
const CVV = fixedId("cvv");
const EML = fixedId("eml");
const TSK = fixedId("tsk");
const ATT = fixedId("att");
const LSE = fixedId("lse");
const APR = fixedId("apr");
const EVD = fixedId("evd");
const OBS = fixedId("obs");

const locations = [
  { raw: "Jakarta, Indonesia", city: "Jakarta", country_code: "ID" },
];

export const EXTRACTION = {
  v: 1,
  adapter: "greenhouse",
  adapter_version: "1.0.0",
  engine: { pilih_jobs: "0.1.0", scrapling: "0.4.15", playwright: "1.63.0" },
  fetch_mode: "json_api",
  method: "json_api",
  source_urls: {
    listing:
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
    detail: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345",
  },
  relocated_fields: [],
  confidence: 0.98,
  flags: [],
  observed_at: T - 5 * MIN,
  run_id: RUN,
  device_id: DEV,
};

const SCORE_COMPONENTS = {
  rubric_version: "r1",
  features: {
    skills_overlap: {
      value: 0.67,
      matched: ["python", "postgresql", "aws"],
      missing: ["kubernetes"],
      weight: 0.25,
    },
    title_similarity: {
      value: 0.8,
      best_target: "Backend Engineer",
      weight: 0.15,
    },
    location_fit: { value: 1, reason: "remote_in_country", weight: 0.15 },
    seniority_fit: { value: 0.65, posting: "senior", user: "mid", weight: 0.1 },
    salary_fit: null,
    language_fit: null,
    freshness: { value: 1, age_days: 3, weight: 0.05 },
  },
  ai: {
    status: "ok",
    overall_fit: { score: 2.9, confidence: 0.71 },
    weight: 0.2,
    predicates: {
      requires_unavailable_work_authorization: 0.04,
      requires_degree_user_lacks: 0.12,
      requires_onsite_outside_user_locations: 0.02,
    },
    refused: [],
  },
  gates: [],
  base: 0.78,
  score: 78,
  posting_revision: 1,
};

const CV_DIFF = {
  prompt_version: "tailor-prompt-v1",
  model: "gpt-6.1-sol",
  section_order: {
    from: ["summary", "experience", "education", "skills"],
    to: ["summary", "skills", "experience", "education"],
  },
  excluded_entries: [
    { section: "projects", entry_id: "p-3", label: "Old portfolio site" },
  ],
  bullets: [
    {
      entry_id: "exp-1",
      operation: "rephrase",
      text: "Built payment APIs in Go serving 2M requests a day.",
      sources: [
        {
          id: "experience:exp-1:2",
          text: "Built the payment API in Go (2M requests/day).",
        },
      ],
    },
  ],
  summary: {
    from: "Backend engineer.",
    to: "Backend engineer focused on payments.",
    sources: ["experience:exp-1:2"],
  },
  notes_for_user: ["Posting asks for Kubernetes; not in your CV"],
  validator: { fallbacks_to_keep: 1 },
  tailored_cv_sha256: SHA2,
};

const RULE_CRITERIA = {
  min_score: 85,
  require_ai_component: true,
  max_score_age_days: 14,
  exclude_blocking_gates: true,
  exclude_possible_gates: true,
  keywords: ["backend", "golang"],
  source_ids: [SRC],
  workplace_types: ["remote", "hybrid"],
};
const RULE_LIMITS = {
  max_per_day: 5,
  max_per_company_per_30d: 2,
  active_hours: { start: "08:00", end: "20:00" },
  expires_at: T + 30 * DAY,
};

const SUBMIT_PAYLOAD = {
  type: "browser_submit",
  form_hash: FORM_HASH,
  url: "https://job-boards.greenhouse.io/acme/jobs/4012345/apply",
  posting_id: PST,
  attempt_id: ATT,
  device_id: DEV,
  fields: [
    {
      label: "Email",
      value_display: "r…@example.com",
      value_source: "fact",
      sensitivity: "none",
      ai_written: false,
    },
    {
      label: "Resume",
      value_display: "Rahma Putri - CV - Acme.pdf",
      value_source: "cv_file",
      sensitivity: "none",
      ai_written: false,
    },
  ],
  attachments: [
    { file_id: FIL, sha256: SHA, name: "Rahma Putri - CV - Acme.pdf" },
  ],
  screenshot_file_id: FIL_SHOT,
  injection_suspected: false,
};

// ===========================================================================
// One row per table
// ===========================================================================

export const RECORD_EXAMPLES = {
  users: {
    id: USR,
    email: "rahma@example.com",
    created_at: T - 90 * DAY,
    updated_at: T - 90 * DAY,
    deleted_at: null,
  },
  mcp_tokens: {
    id: "8c1f6a7e-2b4d-4c3a-9e5f-0a1b2c3d4e5f",
    user_email: "rahma@example.com",
    token_hash: SHA,
    label: "pilih-jobs CLI",
    status: "active",
    kind: "oauth",
    scope: "write",
    created_at: T - MIN,
    revoked_at: null,
    last_used_at: T,
    expires_at: T + 59 * MIN,
    user_id: USR,
    scopes:
      "jobs:read jobs:write discovery:write automation:execute cv:read files:read files:write ai:invoke offline_access",
    grant_id: GRT,
    device_id: DEV,
  },
  oauth_clients: {
    client_id: "pilih-jobs-cli",
    client_secret_hash: "",
    client_name: "pilih-jobs CLI",
    redirect_uris: ["http://127.0.0.1/callback", "http://[::1]/callback"],
    token_endpoint_auth_method: "none",
    created_at: T - 120 * DAY,
    first_party: true,
    allowed_scopes:
      "jobs:read jobs:write discovery:write automation:execute automation:manage cv:read cv:write files:read files:write ai:invoke devices:manage offline_access",
    loopback_any_port: true,
  },
  oauth_grants: {
    id: GRT,
    user_id: USR,
    client_id: "pilih-jobs-cli",
    device_id: DEV,
    scopes:
      "jobs:read jobs:write discovery:write automation:execute cv:read files:read files:write ai:invoke offline_access",
    created_at: T - 30 * DAY,
    last_used_at: T,
    revoked_at: null,
    revoked_reason: null,
  },
  oauth_refresh_tokens: {
    id: RFT,
    grant_id: GRT,
    token_hash: SHA2,
    parent_id: null,
    created_at: T - DAY,
    expires_at: T + 29 * DAY,
    used_at: null,
    revoked_at: null,
  },
  devices: {
    id: DEV,
    user_id: USR,
    grant_id: GRT,
    name: "MacBook (macOS)",
    platform: "macos",
    arch: "arm64",
    cli_version: "0.1.0",
    public_key: null,
    capabilities: ["discover", "apply", "render_cv", "headed_browser"],
    accepts_tasks: true,
    created_at: T - 30 * DAY,
    last_seen_at: T - 2 * MIN,
    last_ip_hash: "3f9a1c2b4d5e6f70",
    revoked_at: null,
    revision: 2,
  },
  feature_flags: {
    key: "JOBS_V1_ENABLED",
    value: true,
    updated_at: T - 10 * DAY,
    updated_by: "ops@pilihpendidikan.com",
  },
  support_access_log: {
    id: SAL,
    operator_email: "ops@pilihpendidikan.com",
    subject_user_id: USR,
    reason: "User reported cards missing from the board",
    ticket_ref: "SUP-142",
    scope: "read:applications",
    created_at: T - DAY,
  },
  request_log: {
    id: 1042,
    ts: T,
    caller_email: "rahma@example.com",
    caller_email_hash: "8d969eef6ecad3c2",
    tool: "jobs_list",
    category: "jobs",
    resource_id: null,
    status: "ok",
    duration_ms: 34,
    params: '{"limit":50}',
    retention_until: T + 90 * DAY,
  },
  job_postings: {
    id: PST,
    fingerprint: `fp1:${SHA}`,
    visibility: "public",
    owner_user_id: null,
    source_kind: "greenhouse",
    source_org: "acme",
    source_job_ref: "4012345",
    canonical_url: "https://boards.greenhouse.io/acme/jobs/4012345",
    apply_url: "https://job-boards.greenhouse.io/acme/jobs/4012345",
    apply_domain: "greenhouse.io",
    company_name: "Acme",
    company_domain: "acme.com",
    title: "Senior Backend Engineer",
    department: "Engineering",
    locations,
    workplace_type: "hybrid",
    employment_type: "full_time",
    seniority: "senior",
    salary: {
      min: 30_000_000,
      max: 45_000_000,
      currency: "IDR",
      period: "month",
      raw: "IDR 30.000.000 - 45.000.000 / bulan",
    },
    description_text:
      "We are hiring a backend engineer to build payment APIs in Go and PostgreSQL.",
    description_truncated: false,
    requirements: ["5+ years of Go", "PostgreSQL", "AWS"],
    content_hash: SHA2,
    dedupe_group: SHA,
    posted_at: T - 3 * DAY,
    first_seen_at: T - 2 * DAY,
    last_seen_at: T - 5 * MIN,
    last_checked_at: T - 5 * MIN,
    status: "open",
    closed_at: null,
    missed_runs: 0,
    extraction: EXTRACTION,
    application_support: "browser_supported",
    revision: 1,
    created_at: T - 2 * DAY,
    updated_at: T - 2 * DAY,
  },
  user_jobs: {
    id: UJB,
    user_id: USR,
    posting_id: PST,
    origin: "discovered",
    inbox_state: "tracked",
    first_run_id: RUN,
    source_id: SRC,
    user_notes: "Referral from Dimas",
    revision: 3,
    created_at: T - 2 * DAY,
    updated_at: T - DAY,
  },
  applications: {
    id: APP,
    user_id: USR,
    user_job_id: UJB,
    legacy_job_id: null,
    stage: "ready",
    stage_changed_at: T - DAY,
    submission_status: "not_started",
    submitted_at: null,
    submission_method: null,
    mode: "approval",
    automation_rule_id: RUL,
    cv_variant_id: CVV,
    base_cv_id: "rahma-cv",
    priority: 1,
    board_rank: "i0000",
    archived: false,
    follow_up_at: null,
    sections: [
      {
        id: "sec-1",
        name: "Prep",
        items: [
          {
            id: "item-1",
            title: "Read engineering blog",
            notes: "",
            url: "https://acme.com/blog",
            done: true,
          },
        ],
      },
    ],
    last_change_source: "web",
    revision: 7,
    created_at: T - DAY,
    updated_at: T - DAY,
  },
  application_events: {
    id: EVT,
    user_id: USR,
    application_id: APP,
    type: "stage_changed",
    from_value: "preparing",
    to_value: "ready",
    payload: { from: "preparing", to: "ready" },
    actor_kind: "user",
    actor_device_id: null,
    task_id: null,
    attempt_id: null,
    applied_to_state: true,
    occurred_at: T - DAY,
    recorded_at: T - DAY,
    idempotency_key: "01JA6V8M3W8Z1T6Q4Y2B7K9C00",
  },
  interviews: {
    id: IVW,
    user_id: USR,
    application_id: APP,
    round: 1,
    kind: "phone_screen",
    scheduled_at: T + 3 * DAY,
    duration_min: 30,
    timezone: "Asia/Jakarta",
    location: "https://meet.example.com/abc-defg",
    interviewers: ["Dimas (Recruiter)"],
    outcome: "pending",
    notes: "",
    revision: 1,
    created_at: T,
    updated_at: T,
  },
  offers: {
    id: OFR,
    user_id: USR,
    application_id: APP,
    received_at: T,
    compensation: {
      base: 42_000_000,
      currency: "IDR",
      period: "month",
      bonus: "1 month THR",
      raw: "IDR 42 juta/bulan",
    },
    deadline_at: T + 7 * DAY,
    status: "open",
    notes: "",
    revision: 1,
    created_at: T,
    updated_at: T,
  },
  applicant_facts: {
    id: FCT,
    user_id: USR,
    key: "contact.phone",
    value: "+62 812-3456-7890",
    source: "cv_import",
    cv_id: "rahma-cv",
    cv_entry_id: null,
    revision: 2,
    created_at: T - 30 * DAY,
    updated_at: T - 2 * DAY,
  },
  screening_answers: {
    id: ANS,
    user_id: USR,
    question_key: "requires_sponsorship",
    match_patterns: ["will you require sponsorship", "visa sponsorship"],
    answer: "No",
    answer_kind: "boolean",
    sensitivity: "protected",
    auto_use: "approval",
    revision: 1,
    created_at: T - 10 * DAY,
    updated_at: T - 10 * DAY,
  },
  match_scores: {
    id: SCR,
    user_id: USR,
    posting_id: PST,
    profile_version: 12,
    rubric_version: "r1",
    model: "gpt-6-luna",
    score: 78,
    confidence: 0.71,
    components: SCORE_COMPONENTS,
    explanation: "78 · Good match",
    status: "ready",
    created_at: T - DAY,
  },
  automation_rules: {
    id: RUL,
    user_id: USR,
    name: "Remote Go backend roles",
    enabled: true,
    mode: "approval",
    criteria: RULE_CRITERIA,
    limits: RULE_LIMITS,
    allowed_domains: ["greenhouse.io", "lever.co"],
    cv_policy: {
      base_cv_id: "rahma-cv",
      tailor: true,
      require_cv_approval: true,
    },
    activated_approval_id: null,
    revision: 4,
    created_at: T - 20 * DAY,
    updated_at: T - 5 * DAY,
  },
  job_sources: {
    id: SRC,
    user_id: USR,
    adapter: "greenhouse",
    label: "Acme (Greenhouse)",
    config: { board_token: "acme" },
    enabled: true,
    schedule: "daily@08:00",
    last_run_id: RUN,
    last_success_at: T - 5 * MIN,
    cursor_state: {
      v: 1,
      listing: { etag: 'W/"abc"', last_modified: null },
      watermark_updated_at: T - DAY,
      seen_refs_digest: SHA,
      detail_etags: { "4012345": '"etag-1"' },
    },
    revision: 9,
    created_at: T - 30 * DAY,
    updated_at: T - 5 * MIN,
  },
  discovery_runs: {
    id: RUN,
    user_id: USR,
    device_id: DEV,
    task_id: null,
    sources: [
      { source_id: SRC, adapter: "greenhouse", label: "Acme (Greenhouse)" },
    ],
    status: "partial",
    started_at: T - 10 * MIN,
    finished_at: T - 5 * MIN,
    stats: {
      pages: 3,
      postings_found: 143,
      new: 12,
      updated: 2,
      unchanged: 129,
      duplicates: 1,
      invalid: 0,
      errors_by_class: { rate_limited: 1 },
    },
    errors: [
      {
        source_id: SRC,
        source: "greenhouse:acme",
        error_class: "rate_limited",
        message: "Retry-After exceeded 15 min",
        http_status: 429,
        at: T - 6 * MIN,
      },
    ],
    engine_version: "pilih-jobs 0.1.0; scrapling 0.4.15",
    revision: 2,
  },
  discovery_run_items: {
    run_id: RUN,
    posting_id: PST,
    user_id: USR,
    outcome: "new",
  },
  files: {
    id: FIL,
    user_id: USR,
    kind: "cv_pdf",
    r2_key: `u/${USR}/cv_pdf/${FIL}.pdf`,
    content_type: "application/pdf",
    size_bytes: 84_213,
    sha256: SHA,
    original_name: "rahma-cv-t-7k2m9q4x1d.pdf",
    status: "ready",
    retention_until: null,
    created_at: T - DAY,
  },
  cv_variants: {
    id: CVV,
    user_id: USR,
    application_id: APP,
    base_cv_id: "rahma-cv",
    tailored_cv_id: "rahma-cv-t-7k2m9q4x1d",
    template: "harvard",
    status: "approved",
    file_id: FIL,
    diff: CV_DIFF,
    model: "gpt-6.1-sol",
    approved_at: T - DAY,
    revision: 3,
    created_at: T - 2 * DAY,
    updated_at: T - DAY,
  },
  email_applications: {
    id: EML,
    user_id: USR,
    application_id: APP2,
    to_address: "careers@acme.co.id",
    subject: "Application for Finance Staff — Rahma Putri",
    body_text:
      "Dear Hiring Team,\n\nI am writing to apply for the Finance Staff position at Acme.",
    attachment_file_ids: [FIL],
    delivery: "local_handoff",
    status: "approved",
    provider_message_id: null,
    approved_at: T,
    sent_at: null,
    revision: 2,
    created_at: T - MIN,
    updated_at: T,
  },
  automation_tasks: {
    id: TSK,
    user_id: USR,
    kind: "apply",
    application_id: APP,
    cv_variant_id: null,
    payload: { mode: "approval", rule_id: RUL },
    state: "running",
    target_device_id: null,
    required_capabilities: ["apply"],
    priority: 0,
    not_before: T - 5 * MIN,
    expires_at: T + 3 * DAY,
    lease_id: LSE,
    lease_device_id: DEV,
    lease_expires_at: T + 2 * MIN,
    attempt_count: 1,
    max_attempts: 3,
    submit_intent_at: null,
    pause_reason: null,
    resume_requested: false,
    retry_of: null,
    cancel_requested: false,
    progress: {
      stage: "filling",
      step: 3,
      message: "Filling form (page 2 of 3)",
      percent: 40,
    },
    local_state: "running",
    error_class: null,
    error_message: null,
    created_by: "rule",
    idempotency_key: `rule:${RUL}:${PST}`,
    revision: 6,
    created_at: T - 6 * MIN,
    updated_at: T - 30_000,
    finished_at: null,
  },
  automation_attempts: {
    id: ATT,
    task_id: TSK,
    user_id: USR,
    device_id: DEV,
    lease_id: LSE,
    attempt_no: 1,
    started_at: T - 5 * MIN,
    last_heartbeat_at: T - 30_000,
    ended_at: null,
    outcome: null,
    error_class: null,
    steps_count: 23,
    ai_calls: 6,
    log_file_id: null,
    cli_version: "0.1.0",
  },
  approvals: {
    id: APR,
    user_id: USR,
    kind: "submit",
    task_id: TSK,
    application_id: APP,
    payload: SUBMIT_PAYLOAD,
    payload_hash: FORM_HASH,
    state: "pending",
    response: null,
    decided_via: null,
    decided_by_user_id: null,
    decided_at: null,
    expires_at: T + DAY,
    created_at: T,
    revision: 1,
  },
  submission_evidence: {
    id: EVD,
    user_id: USR,
    application_id: APP,
    task_id: TSK,
    attempt_id: ATT,
    kind: "browser_confirmation",
    verdict: "verified",
    signals: {
      url_match: true,
      dom_marker: true,
      negative_marker: false,
      xhr_2xx: true,
      form_gone: true,
      application_received: 0.97,
      still_form_or_error: 0.02,
    },
    final_url:
      "https://job-boards.greenhouse.io/acme/jobs/4012345/confirmation",
    page_title: "Thank you for applying",
    text_excerpt: "Thank you for applying to Acme, [redacted]!",
    screenshot_file_id: FIL_SHOT,
    form_hash: FORM_HASH,
    captured_at: T,
    recorded_at: T,
  },
  change_log: {
    seq: 1204,
    user_id: USR,
    entity: "application",
    entity_id: APP,
    revision: 7,
    op: "upsert",
    changed_at: T - DAY,
  },
  idempotency_keys: {
    user_id: USR,
    key: "01JA6V8M3W8Z1T6Q4Y2B7K9C01",
    request_hash: SHA2,
    status_code: 200,
    response_body: '{"application":{"id":"app_…"}}',
    created_at: T,
    expires_at: T + 7 * DAY,
  },
  user_settings: {
    user_id: USR,
    locale: "id",
    timezone: "Asia/Jakarta",
    default_mode: "approval",
    automation_paused: false,
    generated_text_allowed: false,
    allow_mcp_approvals: false,
    ai_consent_at: T - 30 * DAY,
    ai_scoring_sensitive: true,
    evidence_screenshots: "on_submit",
    evidence_retention_days: 180,
    revision: 3,
    updated_at: T - 30 * DAY,
  },
  ai_usage: {
    user_id: USR,
    month: "2026-10",
    purpose: "score",
    input_tokens: 412_000,
    output_tokens: 0,
    cost_micro_usd: 41_200,
    calls: 140,
  },
  telemetry_daily: {
    day: "2026-10-11",
    install_hash: "b6f0c1d2e3a4",
    cli_version: "0.1.0",
    platform: "macos",
    counters: {
      commands: { discover: 2, sync: 5 },
      error_classes: { rate_limited: 1 },
    },
  },
  analytics_daily: {
    user_id: USR,
    day: "2026-10-11",
    metrics: {
      tracked: 3,
      applied: 2,
      applied_unverified: 1,
      interviews_scheduled: 1,
      offers: 0,
      rejected: { applied: 1 },
      withdrawn: 0,
      discovered: 140,
      scored: 140,
      tasks: { submitted: 2, failed: 0, paused: 1, outcome_unknown: 0 },
      ai_cost_micro_usd: 41_200,
    },
  },
};

const R = RECORD_EXAMPLES;

// ===========================================================================
// API views
// ===========================================================================

const { grant_id: _grant, last_ip_hash: _ip, ...deviceBase } = R.devices;
const DEVICE_VIEW = { ...deviceBase, online: true, active: true };
const { r2_key: _key, ...FILE_VIEW } = R.files;

const SCORE_SUMMARY = {
  posting_id: PST,
  score: 78,
  status: "ready",
  confidence: 0.71,
  deterministic_only: false,
  profile_version: 12,
  rubric_version: "r1",
  explanation: "78 · Good match",
  created_at: T - DAY,
};

const BOARD_CARD = {
  id: APP,
  revision: 7,
  user_job_id: UJB,
  legacy_job_id: null,
  stage: "ready",
  stage_changed_at: T - DAY,
  board_rank: "i0000",
  submission_status: "not_started",
  mode: "approval",
  priority: 1,
  archived: false,
  follow_up_at: null,
  follow_up_due: false,
  cv_variant_id: CVV,
  updated_at: T - DAY,
  posting: {
    id: PST,
    title: "Senior Backend Engineer",
    company_name: "Acme",
    company_domain: "acme.com",
    location: "Jakarta, Indonesia",
    workplace_type: "hybrid",
    source_kind: "greenhouse",
    apply_url: "https://job-boards.greenhouse.io/acme/jobs/4012345",
    status: "open",
    closed_at: null,
  },
  score: SCORE_SUMMARY,
  live_task: {
    id: TSK,
    kind: "apply",
    state: "running",
    device_id: DEV,
    device_name: "MacBook (macOS)",
    pause_reason: null,
    progress_stage: "filling",
    submit_intent_at: null,
    updated_at: T - 30_000,
  },
  next_interview_at: T + 3 * DAY,
  latest_offer_status: null,
};

const page = <I>(items: I[]) => ({ items, next_cursor: null });

const EVIDENCE_INPUT = {
  kind: "browser_confirmation",
  verdict: "verified",
  signals: R.submission_evidence.signals,
  final_url: R.submission_evidence.final_url,
  page_title: R.submission_evidence.page_title,
  text_excerpt: R.submission_evidence.text_excerpt,
  screenshot_file_id: FIL_SHOT,
  form_hash: FORM_HASH,
  captured_at: T,
};

const OBSERVATION = {
  observation_id: OBS,
  attempt_id: ATT,
  step: 3,
  url: "https://job-boards.greenhouse.io/acme/jobs/4012345/apply",
  origin: "https://job-boards.greenhouse.io",
  registrable_domain: "greenhouse.io",
  allowlisted: true,
  title: "Apply — Senior Backend Engineer at Acme",
  http_status: 200,
  aria_snapshot: '- heading "Apply for this job"\n- textbox "First name"',
  visible_text_excerpt: "Apply for this job. First name. Email. Resume.",
  fields: [
    {
      ref: "f1",
      signature: "9c1e2a3b4c5d6e7f",
      kind: "text",
      label: "First name",
      label_sources: ["label[for]"],
      description: "",
      required: true,
      options: [],
      options_dynamic: false,
      accept: null,
      multiple: false,
      has_value: false,
      user_touched: false,
      invalid: false,
      validation_message: null,
      section: "Personal information",
    },
    {
      ref: "f2",
      signature: "0a1b2c3d4e5f6a7b",
      kind: "radio_group",
      label: "Will you now or in the future require sponsorship?",
      label_sources: ["legend"],
      description: "",
      required: true,
      options: [
        { value: "yes", label: "Yes", selected: false, disabled: false },
        { value: "no", label: "No", selected: false, disabled: false },
      ],
      options_dynamic: false,
      accept: null,
      multiple: false,
      has_value: false,
      user_touched: false,
      invalid: false,
      validation_message: null,
      section: "Questions",
    },
  ],
  controls: [
    {
      ref: "c-submit",
      kind: "submit",
      text: "Submit application",
      role_hint: "submit",
      enabled: true,
      in_viewport: false,
    },
  ],
  errors: [],
  opaque_regions: [],
  challenge: { detected: false, kind: null },
  form_hash: FORM_HASH,
  screenshot_jpeg_b64: null,
};

const FIELD_PLAN = {
  items: [
    {
      plan_item: "p1",
      ref: "f1",
      signature: "9c1e2a3b4c5d6e7f",
      action: "fill",
      value_source: "fact",
      fact_key: "contact.first_name",
      answer_id: null,
      option_value: null,
      value: "Rahma",
      confidence: 0.97,
      sensitivity: "none",
      needs_human: false,
      question_key: null,
      reason: "First name field maps to contact.first_name",
    },
    {
      plan_item: "p2",
      ref: "f2",
      signature: "0a1b2c3d4e5f6a7b",
      action: "select",
      value_source: "answer",
      fact_key: null,
      answer_id: ANS,
      option_value: "no",
      value: "No",
      confidence: 0.9,
      sensitivity: "protected",
      needs_human: true,
      question_key: "requires_sponsorship",
      reason: "Protected question; stored answer needs approval",
    },
  ],
  missing: [],
};

const TASK_CONTEXT_APPLY = {
  kind: "apply",
  application: R.applications,
  posting: R.job_postings,
  mode: "approval",
  cv: {
    cv_variant_id: CVV,
    status: "approved",
    file: { file_id: FIL, sha256: SHA },
  },
  cover_letter: null,
  rule: {
    id: RUL,
    mode: "approval",
    limits: RULE_LIMITS,
    cv_policy: R.automation_rules.cv_policy,
  },
  allowed_domains: ["greenhouse.io"],
  adapter: {
    id: "greenhouse",
    headless_ok: true,
    auto_ok: true,
    confirmation_url_patterns: ["/confirmation(?:[/?#]|$)"],
    confirmation_selectors: ["#application_confirmation"],
  },
  approval_policy: {
    submit_requires_approval: true,
    generated_text_allowed: false,
    evidence_screenshots: "on_submit",
  },
  resume_from_approval: null,
};

const DELETED = (id: string) => ({ id, deleted: true });

/** The pending `submit` approval of an email draft (09 §4). */
const EMAIL_APPROVAL_PENDING = {
  ...R.approvals,
  kind: "submit",
  task_id: null,
  application_id: APP2,
  payload: {
    type: "email_submit",
    email_application_id: EML,
    to: "careers@acme.co.id",
    cc: [],
    subject: R.email_applications.subject,
    body_text: R.email_applications.body_text,
    attachments: [
      { file_id: FIL, sha256: SHA, name: "Rahma Putri - CV - Acme.pdf" },
    ],
    ai_drafted: false,
    recipient_confirmed: false,
  },
  payload_hash: SHA2,
  state: "pending",
  decided_via: null,
  decided_by_user_id: null,
  decided_at: null,
};

// ===========================================================================
// One example per route
// ===========================================================================

export interface RouteExample {
  query?: unknown;
  request?: unknown;
  response: unknown;
}

const I = "/api/v1/applications/{app_id}/interviews";
const O = "/api/v1/applications/{app_id}/offers";
const L = "/api/v1/tasks/{tsk_id}/lease/{lease_id}";

export const ROUTE_EXAMPLES: Record<string, RouteExample> = {
  "GET /api/v1/meta": {
    response: {
      api_version: "v1",
      min_cli_version: "0.1.0",
      recommended_cli_version: "0.1.0",
      features: ["automation", "ai"],
    },
  },
  "GET /api/v1/me": {
    response: {
      user_id: USR,
      email: "rahma@example.com",
      is_admin: false,
      scopes: [
        "jobs:read",
        "jobs:write",
        "automation:execute",
        "offline_access",
      ],
      device: { id: DEV, name: "MacBook (macOS)" },
      credential_kind: "oauth_cli",
    },
  },
  "POST /api/v1/devices": {
    request: {
      name: "MacBook (macOS)",
      platform: "macos",
      arch: "arm64",
      cli_version: "0.1.0",
      capabilities: ["discover", "apply", "render_cv", "headed_browser"],
    },
    response: { device: DEVICE_VIEW },
  },
  "GET /api/v1/devices": {
    query: { limit: "20", include_revoked: "true" },
    response: page([DEVICE_VIEW]),
  },
  "PATCH /api/v1/devices/{dev_id}": {
    request: { base_revision: 2, accepts_tasks: false },
    response: { device: { ...DEVICE_VIEW, accepts_tasks: false, revision: 3 } },
  },
  "POST /api/v1/devices/{dev_id}/revoke": {
    request: null,
    response: {
      device: { ...DEVICE_VIEW, revoked_at: T, online: false, active: false },
      tasks: {
        outcome_unknown: 0,
        requeued: 1,
        awaiting_approval: 0,
        cancelled: 0,
      },
    },
  },
  "POST /api/v1/devices/{dev_id}/heartbeat": {
    request: {
      cli_version: "0.1.0",
      local_state_summary: { running: 1, sync_pending: 0 },
      active_lease_ids: [LSE],
      outbox_depth: 2,
      last_sync_at: T - MIN,
      browser: { mode: "managed", status: "busy" },
      capabilities: ["discover", "apply", "render_cv", "headed_browser"],
    },
    response: {
      server_time: T,
      poll_interval_ms: 5000,
      cancel_lease_ids: [],
      min_cli_version: "0.1.0",
    },
  },
  "GET /api/v1/sources": {
    query: { enabled: "1", limit: "50" },
    response: page([R.job_sources]),
  },
  "POST /api/v1/sources": {
    request: {
      adapter: "greenhouse",
      label: "Acme (Greenhouse)",
      config: { board_token: "acme" },
      enabled: true,
      schedule: "daily@08:00",
    },
    response: { source: R.job_sources },
  },
  "PATCH /api/v1/sources/{src_id}": {
    request: { base_revision: 9, enabled: false },
    response: { source: { ...R.job_sources, enabled: false, revision: 10 } },
  },
  "DELETE /api/v1/sources/{src_id}": {
    query: { base_revision: "10" },
    response: DELETED(SRC),
  },
  "GET /api/v1/sources/adapters": { response: adaptersFile },
  "POST /api/v1/discovery/runs": {
    request: {
      id: RUN,
      sources: [
        { source_id: SRC, adapter: "greenhouse", label: "Acme (Greenhouse)" },
      ],
      device_id: DEV,
      engine_version: "pilih-jobs 0.1.0; scrapling 0.4.15",
      started_at: T - 10 * MIN,
    },
    response: {
      run: {
        ...R.discovery_runs,
        status: "running",
        finished_at: null,
        stats: {},
        errors: [],
      },
    },
  },
  "POST /api/v1/discovery/runs/{run_id}/postings:batch": {
    request: {
      items: [
        {
          client_ref: "1",
          fingerprint: `fp1:${SHA}`,
          visibility: "public",
          source_kind: "greenhouse",
          source_org: "acme",
          source_job_ref: "4012345",
          source_id: SRC,
          canonical_url: "https://boards.greenhouse.io/acme/jobs/4012345",
          apply_url: "https://job-boards.greenhouse.io/acme/jobs/4012345",
          apply_domain: "greenhouse.io",
          company_name: "Acme",
          company_domain: "acme.com",
          title: "Senior Backend Engineer",
          department: "Engineering",
          locations,
          workplace_type: "hybrid",
          employment_type: "full_time",
          description_text: R.job_postings.description_text,
          requirements: R.job_postings.requirements,
          posted_at: T - 3 * DAY,
          application_support: "browser_supported",
          content_hash: SHA2,
          dedupe_group: SHA,
          observed_at: T - 5 * MIN,
          extraction: EXTRACTION,
        },
        {
          client_ref: "2",
          fingerprint: `fp1:${SHA2}`,
          content_hash: SHA,
          observed_at: T - 5 * MIN,
        },
      ],
    },
    response: {
      items: [
        { client_ref: "1", outcome: "new", posting_id: PST, user_job_id: UJB },
        {
          client_ref: "2",
          outcome: "unchanged",
          posting_id: fixedId("pst", 9),
        },
      ],
    },
  },
  "POST /api/v1/discovery/runs/{run_id}/complete": {
    request: {
      status: "partial",
      finished_at: T - 5 * MIN,
      stats: R.discovery_runs.stats,
      errors: R.discovery_runs.errors,
      complete_sources: [
        { source_id: SRC, source_kind: "greenhouse", source_org: "acme" },
      ],
      cursor_states: [
        { source_id: SRC, cursor_state: R.job_sources.cursor_state },
      ],
    },
    response: { run: R.discovery_runs, closed_postings: 2 },
  },
  "GET /api/v1/discovery/runs": {
    query: { limit: "20" },
    response: page([R.discovery_runs]),
  },
  "GET /api/v1/inbox": {
    query: { state: "new", min_score: "70", source: SRC, q: "backend" },
    response: page([
      {
        user_job: { ...R.user_jobs, inbox_state: "new" },
        posting: R.job_postings,
        score: SCORE_SUMMARY,
        provenance: {
          run_id: RUN,
          source_id: SRC,
          source_label: "Acme (Greenhouse)",
          source_kind: "greenhouse",
        },
        duplicates: 0,
      },
    ]),
  },
  "POST /api/v1/inbox:bulk": {
    request: { user_job_ids: [UJB, fixedId("ujb", 2)], action: "track" },
    response: {
      results: [
        {
          user_job_id: UJB,
          status: "ok",
          inbox_state: "tracked",
          application_id: APP,
        },
        { user_job_id: fixedId("ujb", 2), status: "not_found" },
      ],
    },
  },
  "POST /api/v1/user-jobs": {
    request: { url: "https://careers.example.co.id/jobs/42", private: false },
    response: {
      user_job: {
        ...R.user_jobs,
        origin: "manual",
        inbox_state: "new",
        first_run_id: null,
        source_id: null,
      },
      posting: {
        ...R.job_postings,
        source_kind: "custom_url",
        source_org: null,
        source_job_ref: null,
        extraction: {},
      },
    },
  },
  "GET /api/v1/user-jobs/{ujb_id}": {
    response: {
      user_job: R.user_jobs,
      posting: R.job_postings,
      score: SCORE_SUMMARY,
      application: R.applications,
    },
  },
  "GET /api/v1/board": {
    query: { include_archived: "0" },
    response: {
      columns: [
        { stage: "saved", cards: [], total: 0, has_more: false },
        { stage: "ready", cards: [BOARD_CARD], total: 1, has_more: false },
      ],
      counts: {
        approvals_pending: 1,
        inbox_new: 12,
        follow_ups_due: 0,
        unconfirmed: 0,
        tasks_live: 1,
      },
      cursor: 1204,
      generated_at: T,
    },
  },
  "GET /api/v1/applications": {
    query: { stage: "ready", q: "acme" },
    response: page([BOARD_CARD]),
  },
  "POST /api/v1/applications": {
    request: { user_job_id: UJB, stage: "saved", mode: "approval" },
    response: { application: { ...R.applications, stage: "saved" } },
  },
  "GET /api/v1/applications/{app_id}": {
    response: {
      application: R.applications,
      user_job: R.user_jobs,
      posting: R.job_postings,
      score: R.match_scores,
      cv_variants: [R.cv_variants],
      interviews: [R.interviews],
      offers: [R.offers],
      approvals: [R.approvals],
      tasks: [R.automation_tasks],
      evidence: [],
      emails: [],
    },
  },
  "GET /api/v1/applications/{app_id}/interviews/{ivw_id}.ics": {
    response:
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//pilihpendidikan//jobs//EN\r\nBEGIN:VEVENT\r\nUID:ivw@pilihpendidikan.com\r\nDTSTART:20261015T020000Z\r\nSUMMARY:Phone screen — Acme\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  },
  "PATCH /api/v1/applications/{app_id}": {
    request: {
      base_revision: 7,
      priority: 0,
      follow_up_at: T + 7 * DAY,
      sections: R.applications.sections,
    },
    response: { application: { ...R.applications, priority: 0, revision: 8 } },
  },
  "POST /api/v1/applications/{app_id}/move": {
    request: {
      base_revision: 7,
      stage: "applied",
      before_id: APP2,
      after_id: null,
    },
    response: {
      application: { ...R.applications, stage: "applied", revision: 8 },
    },
  },
  "POST /api/v1/applications/{app_id}/submission": {
    request: {
      base_revision: 7,
      action: "mark_applied",
      applied_at: T,
      method: "manual",
      note: "Applied on the company site",
    },
    response: {
      application: {
        ...R.applications,
        stage: "applied",
        submission_status: "submitted_verified",
        submitted_at: T,
        submission_method: "manual",
        revision: 8,
      },
      evidence: {
        ...R.submission_evidence,
        task_id: null,
        attempt_id: null,
        kind: "user_attestation",
        signals: { method: "manual", user_confirmed: true },
        screenshot_file_id: null,
        form_hash: null,
      },
    },
  },
  "GET /api/v1/applications/{app_id}/events": {
    query: { limit: "50" },
    response: page([R.application_events]),
  },
  "POST /api/v1/applications/{app_id}/events": {
    request: {
      type: "note_added",
      payload: { text: "Recruiter called; **second round** next week." },
      idempotency_key: "01JA6V8M3W8Z1T6Q4Y2B7K9C02",
      occurred_at: T,
    },
    response: {
      event: {
        ...R.application_events,
        type: "note_added",
        from_value: null,
        to_value: null,
        payload: { text: "Recruiter called; **second round** next week." },
        idempotency_key: "01JA6V8M3W8Z1T6Q4Y2B7K9C02",
      },
    },
  },
  [`GET ${I}`]: { response: page([R.interviews]) },
  [`POST ${I}`]: {
    request: {
      kind: "phone_screen",
      scheduled_at: T + 3 * DAY,
      duration_min: 30,
      timezone: "Asia/Jakarta",
      location: "https://meet.example.com/abc-defg",
      interviewers: ["Dimas (Recruiter)"],
      move_application: true,
    },
    response: {
      interview: R.interviews,
      application: { ...R.applications, stage: "interviewing", revision: 8 },
    },
  },
  [`GET ${I}/{ivw_id}`]: { response: { interview: R.interviews } },
  [`PATCH ${I}/{ivw_id}`]: {
    request: { base_revision: 1, outcome: "passed", notes: "Good chat" },
    response: {
      interview: {
        ...R.interviews,
        outcome: "passed",
        notes: "Good chat",
        revision: 2,
      },
    },
  },
  [`DELETE ${I}/{ivw_id}`]: { response: DELETED(IVW) },
  [`GET ${O}`]: { response: page([R.offers]) },
  [`POST ${O}`]: {
    request: {
      received_at: T,
      compensation: R.offers.compensation,
      deadline_at: T + 7 * DAY,
      move_application: true,
    },
    response: {
      offer: R.offers,
      application: { ...R.applications, stage: "offer" },
    },
  },
  [`GET ${O}/{ofr_id}`]: { response: { offer: R.offers } },
  [`PATCH ${O}/{ofr_id}`]: {
    request: { base_revision: 1, status: "accepted", move_application: true },
    response: {
      offer: { ...R.offers, status: "accepted", revision: 2 },
      application: { ...R.applications, stage: "accepted" },
    },
  },
  [`DELETE ${O}/{ofr_id}`]: { response: DELETED(OFR) },
  "DELETE /api/v1/applications/{app_id}": {
    query: { purge: "0" },
    response: {
      id: APP,
      archived: true,
      purged: false,
      application: { ...R.applications, archived: true, revision: 8 },
    },
  },
  "POST /api/v1/scores:request": {
    request: { posting_ids: [PST, fixedId("pst", 2)] },
    response: { queued: [fixedId("pst", 2)], cached: [PST] },
  },
  "GET /api/v1/scores/{posting_id}": {
    response: { score: R.match_scores, profile_version: 12 },
  },
  "GET /api/v1/cvs": {
    response: page([
      {
        id: "rahma-cv",
        full_name: "Rahma Putri",
        job_title: "Backend Engineer",
        visibility: "public",
        is_tailored: false,
      },
    ]),
  },
  "POST /api/v1/applications/{app_id}/cv-variants": {
    request: { base_cv_id: "rahma-cv", template: "harvard", tailor: true },
    response: {
      cv_variant: {
        ...R.cv_variants,
        status: "generating",
        tailored_cv_id: null,
        file_id: null,
        diff: {},
        model: null,
        approved_at: null,
        revision: 1,
      },
    },
  },
  "GET /api/v1/cv-variants/{cvv_id}": {
    query: { include: "cv_data" },
    response: {
      cv_variant: R.cv_variants,
      file: FILE_VIEW,
      tailored_cv: {
        personalInfo: { fullName: "Rahma Putri" },
        sectionOrder: ["summary"],
      },
      edited_after_approval: false,
    },
  },
  "POST /api/v1/cv-variants/{cvv_id}/render-ticket": {
    request: null,
    response: {
      ticket: "Zq3x9k2m7p4w8r1t6y5u0i3o2a7s9d4f6g8h1j3k5l",
      url: `https://jobs.pilihpendidikan.com/render/cv/${CVV}?ticket=Zq3x9k2m7p4w8r1t6y5u0i3o2a7s9d4f6g8h1j3k5l`,
      expires_in: 120,
    },
  },
  "POST /api/v1/cv-variants/{cvv_id}/approve": {
    request: { base_revision: 2 },
    response: { cv_variant: R.cv_variants, application: R.applications },
  },
  "POST /api/v1/cv-variants/{cvv_id}/reject": {
    request: { base_revision: 2, reason: "Summary sounds off" },
    response: {
      cv_variant: { ...R.cv_variants, status: "rejected", approved_at: null },
    },
  },
  "POST /api/v1/files": {
    request: {
      meta: {
        kind: "cv_pdf",
        sha256: SHA,
        content_type: "application/pdf",
        size_bytes: 84_213,
        original_name: "rahma-cv-t-7k2m9q4x1d.pdf",
        links: { cv_variant_id: CVV },
      },
      file: {
        binary: true,
        content_type: "application/pdf",
        size_bytes: 84_213,
      },
    },
    response: { file: FILE_VIEW },
  },
  "GET /api/v1/files/{fil_id}": { response: { file: FILE_VIEW } },
  "GET /api/v1/files/{fil_id}/content": {
    response: {
      binary: true,
      content_type: "application/pdf",
      sha256: SHA,
      size_bytes: 84_213,
      content_disposition: 'attachment; filename="rahma-cv.pdf"',
    },
  },
  "DELETE /api/v1/files/{fil_id}": {
    response: { file: { ...FILE_VIEW, status: "deleted" } },
  },
  "GET /api/v1/rules": { response: page([R.automation_rules]) },
  "POST /api/v1/rules": {
    request: {
      name: "Remote Go backend roles",
      mode: "approval",
      enabled: true,
      criteria: RULE_CRITERIA,
      limits: RULE_LIMITS,
      allowed_domains: ["greenhouse.io", "lever.co"],
      cv_policy: {
        base_cv_id: "rahma-cv",
        tailor: true,
        require_cv_approval: true,
      },
    },
    response: { rule: R.automation_rules },
  },
  "GET /api/v1/rules/{rul_id}": { response: { rule: R.automation_rules } },
  "PATCH /api/v1/rules/{rul_id}": {
    request: { base_revision: 4, mode: "auto", enabled: true },
    response: {
      rule: { ...R.automation_rules, mode: "auto", revision: 5 },
      approval: {
        ...R.approvals,
        kind: "rule_activation",
        task_id: null,
        application_id: null,
        payload: {
          type: "rule_activation",
          rule_id: RUL,
          name: "Remote Go backend roles",
          mode: "auto",
          summary:
            "Up to 5 applications a day to Greenhouse and Lever jobs scoring 85+",
          criteria: RULE_CRITERIA,
          limits: RULE_LIMITS,
          allowed_domains: ["greenhouse.io", "lever.co"],
        },
        expires_at: T + 7 * DAY,
      },
    },
  },
  "DELETE /api/v1/rules/{rul_id}": { response: DELETED(RUL) },
  "POST /api/v1/tasks": {
    request: {
      kind: "apply",
      application_id: APP,
      payload: { mode: "approval" },
      target_device_id: DEV,
      idempotency_key: "01JA6V8M3W8Z1T6Q4Y2B7K9C03",
    },
    response: {
      task: {
        ...R.automation_tasks,
        state: "queued",
        lease_id: null,
        lease_device_id: null,
        lease_expires_at: null,
        attempt_count: 0,
        progress: {},
        local_state: null,
        created_by: "cli",
        target_device_id: DEV,
      },
    },
  },
  "GET /api/v1/tasks": {
    query: { state: "running", application_id: APP },
    response: page([R.automation_tasks]),
  },
  "GET /api/v1/tasks/{tsk_id}": {
    response: {
      task: R.automation_tasks,
      attempts: [R.automation_attempts],
      approvals: [R.approvals],
      evidence: [],
      device_name: "MacBook (macOS)",
      context: TASK_CONTEXT_APPLY,
    },
  },
  "POST /api/v1/tasks/{tsk_id}/cancel": {
    request: null,
    response: { task: { ...R.automation_tasks, cancel_requested: true } },
  },
  "POST /api/v1/tasks/{tsk_id}/retry": {
    request: {
      confirm_not_submitted: true,
      idempotency_key: "01JA6V8M3W8Z1T6Q4Y2B7K9C04",
    },
    response: {
      task: {
        ...R.automation_tasks,
        id: fixedId("tsk", 2),
        state: "queued",
        retry_of: TSK,
        lease_id: null,
        lease_device_id: null,
        lease_expires_at: null,
        attempt_count: 0,
        progress: {},
        local_state: null,
      },
    },
  },
  "POST /api/v1/tasks/{tsk_id}/resume": {
    request: null,
    response: {
      task: {
        ...R.automation_tasks,
        state: "paused",
        pause_reason: "login_required",
        resume_requested: true,
      },
    },
  },
  "POST /api/v1/devices/{dev_id}/tasks:claim": {
    request: { capabilities: ["apply", "headed_browser"], max: 1 },
    response: {
      task: { ...R.automation_tasks, state: "claimed" },
      lease: {
        lease_id: LSE,
        attempt_id: ATT,
        expires_at: T + 2 * MIN,
        heartbeat_interval_ms: 30_000,
      },
      context: TASK_CONTEXT_APPLY,
      poll_interval_ms: 5000,
    },
  },
  [`POST ${L}/heartbeat`]: {
    request: {
      progress: {
        stage: "filling",
        step: 3,
        message: "Filling form (page 2 of 3)",
      },
      local_state: "running",
    },
    response: {
      lease_expires_at: T + 2 * MIN,
      cancel_requested: false,
      resume_requested: false,
      poll_interval_ms: 5000,
      server_time: T,
    },
  },
  [`POST ${L}/events`]: {
    request: {
      events: [
        { type: "started", idempotency_key: "evt-1", occurred_at: T - 5 * MIN },
        {
          type: "progress",
          idempotency_key: "evt-2",
          occurred_at: T - 4 * MIN,
          progress: { stage: "opening", step: 1, message: "Opened apply page" },
        },
        {
          type: "paused",
          idempotency_key: "evt-3",
          occurred_at: T - 3 * MIN,
          pause_reason: "login_required",
          message: "Login required on boards.greenhouse.io",
        },
        { type: "resumed", idempotency_key: "evt-4", occurred_at: T - 2 * MIN },
        {
          type: "log",
          idempotency_key: "evt-5",
          occurred_at: T - MIN,
          level: "info",
          message: "fill First name <- fact contact.first_name",
        },
      ],
    },
    response: {
      results: [
        { idempotency_key: "evt-1", status: "recorded", event_id: EVT },
        { idempotency_key: "evt-2", status: "duplicate" },
      ],
      task_state: "running",
    },
  },
  [`POST ${L}/submit-intent`]: {
    request: { form_hash: FORM_HASH, approval_id: APR },
    response: { submit_intent_at: T },
  },
  [`POST ${L}/result`]: {
    request: {
      outcome: "submitted",
      evidence: EVIDENCE_INPUT,
      application_update: {
        base_revision: 7,
        submission_status: "submitted_verified",
        stage: "applied",
      },
      log_file_id: FIL_LOG,
      stats: { steps_count: 41, ai_calls: 9, duration_ms: 312_000 },
    },
    response: {
      task: { ...R.automation_tasks, state: "submitted", finished_at: T },
      application: {
        ...R.applications,
        stage: "applied",
        submission_status: "submitted_verified",
        submitted_at: T,
        submission_method: "browser",
      },
      evidence: R.submission_evidence,
      conflict_recorded: false,
    },
  },
  [`POST ${L}/release`]: {
    request: { reason: "awaiting_approval" },
    response: {
      task: {
        ...R.automation_tasks,
        state: "awaiting_approval",
        lease_id: null,
        lease_device_id: null,
        lease_expires_at: null,
      },
    },
  },
  "POST /api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence": {
    request: { evidence: EVIDENCE_INPUT, outcome: "submitted" },
    response: {
      evidence: R.submission_evidence,
      task: { ...R.automation_tasks, state: "submitted" },
      application: {
        ...R.applications,
        stage: "rejected",
        submission_status: "submitted_verified",
      },
      conflict_recorded: true,
    },
  },
  "GET /api/v1/approvals": {
    query: { state: "pending" },
    response: page([R.approvals]),
  },
  "POST /api/v1/approvals/{apr_id}/decide": {
    request: { decision: "approve", payload_hash: FORM_HASH },
    response: {
      approval: {
        ...R.approvals,
        state: "approved",
        decided_via: "web",
        decided_by_user_id: USR,
        decided_at: T,
        revision: 2,
      },
      task: { ...R.automation_tasks, state: "running" },
    },
  },
  [`POST ${L}/approvals`]: {
    request: {
      kind: "submit",
      payload: SUBMIT_PAYLOAD,
      payload_hash: FORM_HASH,
    },
    response: { approval: R.approvals },
  },
  [`GET ${L}/approvals/{apr_id}`]: { response: { approval: R.approvals } },
  "POST /api/v1/ai/page-classify": {
    request: {
      lease_ref: { task_id: TSK, lease_id: LSE },
      observation: OBSERVATION,
    },
    response: {
      page_kind: "application_form",
      confidence: 0.93,
      probabilities: { application_form: 0.93, review_page: 0.05 },
      injection_suspected: 0.02,
      form_requires_upload: 0.88,
      form_present: true,
      refused: [],
    },
  },
  "POST /api/v1/ai/next-action": {
    request: {
      lease_ref: { task_id: TSK, lease_id: LSE },
      observation_id: OBS,
      step: 3,
      page_kind: "application_form",
      state: { required_remaining: 0, errors: 0, form_hash: FORM_HASH },
      candidates: [
        { id: "c1", type: "click_ref", ref: "c-next", role_hint: "next" },
        { id: "c2", type: "scroll", ref: null, direction: "down" },
        {
          id: "c3",
          type: "pause_for_human",
          reason: "unclear_page",
          message: "Ask the applicant to look at this page",
        },
      ],
    },
    response: { choice: "c1", confidence: 0.94, refused: false },
  },
  "POST /api/v1/ai/field-plan": {
    request: {
      lease_ref: { task_id: TSK, lease_id: LSE },
      observation: OBSERVATION,
      fact_keys: ["contact.first_name", "contact.email"],
      file_slots: { cv_file: true, cover_letter_file: false },
      attempt: 1,
    },
    response: FIELD_PLAN,
  },
  "POST /api/v1/ai/verify-submission": {
    request: {
      lease_ref: { task_id: TSK, lease_id: LSE },
      observation_id: OBS,
      final_url:
        "https://job-boards.greenhouse.io/acme/jobs/4012345/confirmation",
      page_title: "Thank you for applying",
      text_excerpt: "Thank you for applying to Acme, [redacted]!",
      screenshot_jpeg_b64: null,
      signals: {
        url_match: true,
        dom_marker: true,
        form_gone: true,
        xhr_2xx: true,
      },
    },
    response: {
      application_received: 0.97,
      still_form_or_error: 0.02,
      verdict: "verified",
      refused: [],
    },
  },
  "GET /api/v1/profile/facts": {
    response: { facts: [R.applicant_facts], profile_version: 12 },
  },
  "PUT /api/v1/profile/facts": {
    request: {
      facts: [
        { key: "contact.phone", value: "+62 812-3456-7890", base_revision: 2 },
        {
          key: "work_auth.ID",
          value: { status: "citizen" },
          source: "user_entered",
        },
      ],
      delete_keys: ["links.website"],
    },
    response: {
      facts: [R.applicant_facts],
      results: [
        { key: "contact.phone", status: "unchanged", fact: R.applicant_facts },
        { key: "work_auth.ID", status: "created" },
        { key: "links.website", status: "deleted" },
      ],
      profile_version: 13,
    },
  },
  "POST /api/v1/profile/facts:import-cv": {
    request: { cv_id: "rahma-cv" },
    response: {
      proposals: [
        {
          key: "contact.full_name",
          value: "Rahma Putri",
          source: "cv_import",
          cv_id: "rahma-cv",
          cv_entry_id: null,
          current: null,
        },
      ],
    },
  },
  "GET /api/v1/profile/answers": { response: page([R.screening_answers]) },
  "POST /api/v1/profile/answers": {
    request: {
      question_key: "notice_period",
      match_patterns: ["notice period", "earliest start date"],
      answer: "1 month",
      answer_kind: "text",
      sensitivity: "none",
      auto_use: "always",
    },
    response: {
      answer: {
        ...R.screening_answers,
        question_key: "notice_period",
        answer: "1 month",
        answer_kind: "text",
        sensitivity: "none",
        auto_use: "always",
      },
    },
  },
  "GET /api/v1/profile/answers/{ans_id}": {
    response: { answer: R.screening_answers },
  },
  "PATCH /api/v1/profile/answers/{ans_id}": {
    request: { base_revision: 1, auto_use: "never" },
    response: {
      answer: { ...R.screening_answers, auto_use: "never", revision: 2 },
    },
  },
  "DELETE /api/v1/profile/answers/{ans_id}": { response: DELETED(ANS) },
  "GET /api/v1/settings": { response: { settings: R.user_settings } },
  "PATCH /api/v1/settings": {
    request: { base_revision: 3, automation_paused: true, locale: "en" },
    response: {
      settings: {
        ...R.user_settings,
        automation_paused: true,
        locale: "en",
        revision: 4,
      },
    },
  },
  "POST /api/v1/account/export": {
    request: null,
    response: { export_id: "exp_2026_10_12_a1", status: "pending" },
  },
  "GET /api/v1/account/exports/{export_id}": {
    response: {
      binary: true,
      content_type: "application/zip",
      size_bytes: 482_113,
      content_disposition:
        'attachment; filename="pilihpendidikan-export-2026-10-12.zip"',
    },
  },
  "GET /api/v1/account/delete/confirm": {
    query: { token: "dlt_9f2c1a7e4b" },
    response: "<!doctype html><title>Delete your account</title>",
  },
  "POST /api/v1/account/delete/confirm": {
    request: { token: "dlt_9f2c1a7e4b" },
    response: { status: "deleting" },
  },
  "POST /api/v1/account/delete": {
    request: { also_delete_cvs: false },
    response: { status: "confirmation_sent", confirmation_expires_at: T + DAY },
  },
  "POST /api/v1/telemetry": {
    request: {
      day: "2026-10-11",
      install_hash: "b6f0c1d2e3a4",
      cli_version: "0.1.0",
      platform: "macos",
      arch: "arm64",
      python_version: "3.12.7",
      install_channel: "uv",
      counters: R.telemetry_daily.counters,
    },
    response: { accepted: true },
  },
  "POST /api/v1/telemetry/crash": {
    request: {
      install_hash: "b6f0c1d2e3a4",
      cli_version: "0.1.0",
      platform: "linux",
      occurred_at: T,
      exception_type: "KeyError",
      message: "[redacted]",
      frames: [
        { file: "pilih_jobs/sync/outbox.py", line: 214, function: "flush" },
      ],
    },
    response: { accepted: true },
  },
  "GET /api/v1/changes": {
    query: { cursor: "1200", limit: "500" },
    response: {
      changes: [
        {
          seq: 1204,
          entity: "application",
          entity_id: APP,
          revision: 7,
          op: "upsert",
          data: R.applications,
        },
        {
          seq: 1205,
          entity: "rule",
          entity_id: fixedId("rul", 2),
          revision: 3,
          op: "delete",
        },
      ],
      next_cursor: 1205,
      has_more: false,
    },
  },
  "GET /api/v1/snapshot": {
    query: { entities: "applications,rules,sources,facts,answers" },
    response: {
      cursor: 1205,
      taken_at: T,
      applications: [R.applications],
      rules: [R.automation_rules],
      sources: [R.job_sources],
      facts: [R.applicant_facts],
      answers: [R.screening_answers],
    },
  },
  "GET /api/v1/analytics/summary": {
    query: { from: "2026-09-01", to: "2026-09-30", tz: "Asia/Jakarta" },
    response: {
      from: "2026-09-01",
      to: "2026-09-30",
      tz: "Asia/Jakarta",
      cohort_size: 12,
      funnel: {
        tracked: 30,
        applied: 12,
        interviewing: 4,
        offer: 1,
        accepted: 0,
        rejected_total: 5,
        withdrawn_total: 1,
      },
      rates: {
        response_rate: 0.5,
        interview_rate: 0.33,
        offer_rate: 0.08,
        acceptance_rate: 0,
        rejection_rate: 0.42,
        ghosting_rate: null,
      },
      rejection_by_stage: {
        before_applying: 0,
        after_applying: 3,
        after_interview: [{ round: 1, count: 2 }],
        after_offer: 0,
      },
      time_metrics: {
        time_to_first_response: { median: 6 * DAY, p75: 9 * DAY, n: 6 },
        time_to_interview: { median: 8 * DAY, p75: 11 * DAY, n: 4 },
        time_to_offer: { median: null, p75: null, n: 0 },
        prep_time: { median: DAY, p75: 2 * DAY, n: 10 },
      },
      automation: {
        apply_tasks: {
          submitted: 8,
          failed: 1,
          cancelled: 1,
          outcome_unknown: 0,
          expired: 0,
        },
        apply_success_rate: 0.89,
        verified_ratio: 0.75,
        pause_rate: 0.3,
        failure_classes: { login_required: 1 },
      },
      unconfirmed_count: 1,
    },
  },
  "GET /api/v1/analytics/timeseries": {
    query: {
      metric: "applied",
      interval: "week",
      from: "2026-09-01",
      to: "2026-09-30",
    },
    response: {
      metric: "applied",
      interval: "week",
      tz: "Asia/Jakarta",
      points: [
        { bucket: "2026-08-31", value: 2 },
        { bucket: "2026-09-07", value: 4 },
      ],
    },
  },
  "GET /api/v1/analytics/breakdown": {
    query: { by: "source" },
    response: {
      by: "source",
      rows: [
        {
          key: "greenhouse",
          label: "Greenhouse",
          applied: 8,
          interview_rate: 0.38,
          offer_rate: 0.13,
          rejection_rate: 0.25,
          n: 8,
        },
        {
          key: "lever",
          label: "Lever",
          applied: 2,
          interview_rate: null,
          offer_rate: null,
          rejection_rate: null,
          n: 2,
        },
      ],
    },
  },
  "POST /api/v1/applications/{app_id}/emails": {
    request: {
      to: "careers@acme.co.id",
      subject: "Application for Finance Staff — Rahma Putri",
      body_text: R.email_applications.body_text,
      attachment_file_ids: [FIL],
      delivery: "local_handoff",
      locale: "en",
    },
    response: {
      email: { ...R.email_applications, status: "draft", approved_at: null },
      approval: EMAIL_APPROVAL_PENDING,
      review: {
        payload_hash: SHA2,
        locale: "en",
        templated: { subject: false, body: false },
        recipient: {
          address: "careers@acme.co.id",
          domain: "acme.co.id",
          employerDomains: ["acme.co.id"],
          freeMail: false,
          matchesEmployer: true,
          ownDomain: false,
          confirmationRequired: false,
          confirmed: false,
        },
        warnings: [],
        ai_paragraph: null,
      },
    },
  },
  "GET /api/v1/emails/{eml_id}": {
    response: {
      email: { ...R.email_applications, status: "draft", approved_at: null },
      approval: EMAIL_APPROVAL_PENDING,
      payload_hash: SHA2,
    },
  },
  "POST /api/v1/emails/{eml_id}/approve": {
    request: { payload_hash: SHA2, recipient_confirmed: true },
    response: {
      email: R.email_applications,
      approval: {
        ...R.approvals,
        kind: "submit",
        task_id: null,
        application_id: APP2,
        payload: {
          type: "email_submit",
          email_application_id: EML,
          to: "careers@acme.co.id",
          cc: [],
          subject: R.email_applications.subject,
          body_text: R.email_applications.body_text,
          attachments: [
            { file_id: FIL, sha256: SHA, name: "Rahma Putri - CV - Acme.pdf" },
          ],
          ai_drafted: false,
          recipient_confirmed: true,
        },
        payload_hash: SHA2,
        state: "approved",
        decided_via: "web",
        decided_by_user_id: USR,
        decided_at: T,
      },
      application: {
        ...R.applications,
        id: APP2,
        submission_status: "in_progress",
      },
      evidence: null,
    },
  },
  "POST /api/v1/emails/{eml_id}/handed-off": {
    request: { sent_confirmed: true, sent_at: T },
    response: {
      email: { ...R.email_applications, status: "handed_off", sent_at: T },
      application: {
        ...R.applications,
        id: APP2,
        stage: "applied",
        submission_status: "submitted_unverified",
      },
      evidence: {
        ...R.submission_evidence,
        application_id: APP2,
        task_id: null,
        attempt_id: null,
        kind: "email_sent",
        verdict: "unverified",
        signals: { method: "local_handoff", user_confirmed: true },
        final_url: null,
        page_title: null,
        text_excerpt: null,
        screenshot_file_id: null,
        form_hash: null,
      },
    },
  },
};

/** Agent payloads used by the TC-AGENT tests. */
export const AGENT_EXAMPLES = { OBSERVATION, FIELD_PLAN, SUBMIT_PAYLOAD };
