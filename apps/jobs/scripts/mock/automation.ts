// Mock api routes for Automation (12 §6, 05 §8): approvals (one of each
// kind) with payload-hash decisions, rules CRUD with the `auto` activation
// flow, tasks (list, detail, create, cancel, retry, resume) and their step
// events. The Initech run advances on its own while the mock runs, so the
// live monitor has something to show.

import type {
  BoardCard,
  TaskDetail,
} from "@pilihpendidikan/jobs-contracts/api";
import { TaskDetailSchema } from "@pilihpendidikan/jobs-contracts/api";
import type { ProgressStage } from "@pilihpendidikan/jobs-contracts/enums";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ApplicationEventRecord,
  ApprovalRecord,
  AutomationAttemptRecord,
  AutomationRuleRecord,
  AutomationTaskRecord,
  SubmissionEvidenceRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { DAY, makeEvent, NOW } from "../../src/test/fixtures";
import {
  answerPayload,
  cvVariantPayload,
  FIXTURE_SHA_C,
  FIXTURE_SHA_D,
  makeApproval,
  makeAttempt,
  makeEvidence,
  makeRule,
  makeTask,
  ruleActivationPayload,
  submitPayload,
} from "../../src/test/fixtures-rest";
import {
  applicationOf,
  bumpBoard,
  cardByCompany,
  cards,
  detailExtras,
  detailOf,
  extraEvents,
  fresh,
  SHIFT,
  state,
} from "./state";
import type { MockRequest, MockRoute, Reply } from "./types";
import {
  apiError,
  match,
  NOT_FOUND,
  ok,
  page,
  revisionConflict,
} from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const START = Date.now();
/** Seconds between the Initech run's progress steps. */
const STEP_EVERY_MS = 8000;

const device = state.devices[0];
const deviceId = device?.id ?? newId("dev");

// ── Data ────────────────────────────────────────────────────────────────────

const tasks = new Map<string, AutomationTaskRecord>();
const attempts = new Map<string, AutomationAttemptRecord[]>();
const evidence = new Map<string, SubmissionEvidenceRecord[]>();
const approvals = new Map<string, ApprovalRecord>();
const rules = new Map<string, AutomationRuleRecord>();
const events: ApplicationEventRecord[] = [];
/** Tasks resumed from the web: when the device "acts" on it. */
const resumeAt = new Map<string, number>();

function patchCard(id: string, patch: Partial<BoardCard>): void {
  state.board = {
    ...state.board,
    columns: state.board.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) =>
        card.id === id ? { ...card, ...patch } : card
      ),
    })),
  };
  bumpBoard();
}

function addTask(task: AutomationTaskRecord): AutomationTaskRecord {
  tasks.set(task.id, task);
  return task;
}

function event(
  task: AutomationTaskRecord,
  type: ApplicationEventRecord["type"],
  payload: Record<string, unknown>,
  at: number,
  attemptId: string | null = null
): void {
  if (!task.application_id) {
    return;
  }
  events.push(
    fresh(
      makeEvent(task.application_id, {
        type,
        payload: payload as ApplicationEventRecord["payload"],
        task_id: task.id,
        attempt_id: attemptId,
        actor_kind: "automation",
        actor_device_id: deviceId,
        occurred_at: at,
        recorded_at: at,
      })
    )
  );
}

function live(task: AutomationTaskRecord): NonNullable<BoardCard["live_task"]> {
  return {
    id: task.id,
    kind: task.kind,
    state: task.state,
    device_id: task.lease_device_id ?? task.target_device_id,
    device_name: device?.name ?? null,
    pause_reason: task.pause_reason,
    progress_stage: "stage" in task.progress ? task.progress.stage : null,
    submit_intent_at: task.submit_intent_at,
    updated_at: task.updated_at,
  };
}

function seedApplyTask(
  card: BoardCard | undefined,
  overrides: Partial<AutomationTaskRecord>,
  attemptOverrides: Partial<AutomationAttemptRecord> = {}
): AutomationTaskRecord | null {
  if (!card) {
    return null;
  }
  const task = addTask(
    fresh(
      makeTask({
        application_id: card.id,
        lease_device_id: deviceId,
        payload: { mode: card.mode },
        ...overrides,
      })
    )
  );
  const attempt = fresh(
    makeAttempt(task, deviceId, {
      lease_id: task.lease_id ?? newId("lse", NOW),
      started_at: NOW - 9 * MINUTE,
      ...attemptOverrides,
    })
  );
  attempts.set(task.id, [attempt]);
  // Event times are given on the fixture clock; `event` shifts them.
  event(
    task,
    "automation_task_created",
    { task_id: task.id, state: "queued" },
    task.created_at - SHIFT
  );
  event(
    task,
    "automation_task_claimed",
    { task_id: task.id, attempt_id: attempt.id, state: "claimed" },
    attempt.started_at - SHIFT,
    attempt.id
  );
  return task;
}

function progress(
  task: AutomationTaskRecord,
  stage: ProgressStage,
  step: number,
  message: string,
  at: number
): void {
  const attempt = attempts.get(task.id)?.[0];
  event(
    task,
    "automation_task_progress",
    { task_id: task.id, state: "running", stage, step, message },
    at,
    attempt?.id ?? null
  );
}

// Initech: a run in progress, its id the board card's live task.
const initech = cardByCompany("Initech");
const running = seedApplyTask(initech, {
  ...(initech?.live_task ? { id: initech.live_task.id } : {}),
  state: "running",
  progress: { stage: "opening", step: 3, message: "Opened the apply page" },
});
if (initech && running) {
  progress(
    running,
    "preparing_cv",
    1,
    "CV ready (sha verified)",
    NOW - 8 * MINUTE
  );
  progress(
    running,
    "opening",
    2,
    "Opened boards.greenhouse.io/initech/jobs/2",
    NOW - 7 * MINUTE
  );
  patchCard(initech.id, { live_task: live(running) });
}
/** The Initech run's script: one step every 8 s after the mock starts. */
const SCRIPT: [ProgressStage, string][] = [
  ["inspecting", "Reading the page: application form, 3 pages"],
  ["filling", "Filling form (page 1 of 3)"],
  ["filling", 'fill "First name" from fact contact.first_name'],
  ["filling", 'fill "Email" from fact contact.email'],
  ["uploading", 'upload "Resume" from the CV variant (sha verified)'],
  ["filling", 'choose "Next" (confidence 0.94)'],
  ["filling", "Filling form (page 2 of 3)"],
  ["filling", 'fill "Years of React" from the answer bank'],
];

function advanceRunning(now: number): void {
  if (!running) {
    return;
  }
  const done = Math.min(
    SCRIPT.length,
    Math.floor((now - START) / STEP_EVERY_MS)
  );
  const logged = events.filter(
    (entry) =>
      entry.task_id === running.id && entry.type === "automation_task_progress"
  ).length;
  for (let index = logged - 2; index < done; index += 1) {
    if (index < 0) {
      continue;
    }
    const [stage, message] = SCRIPT[index] ?? ["filling", ""];
    progress(
      running,
      stage,
      index + 3,
      message,
      START + (index + 1) * STEP_EVERY_MS - SHIFT
    );
  }
  const current = SCRIPT[Math.max(0, done - 1)];
  const task = tasks.get(running.id);
  if (task && task.state === "running" && current && done > 0) {
    tasks.set(task.id, {
      ...task,
      progress: { stage: current[0], step: done + 2, message: current[1] },
      updated_at: now,
      lease_expires_at: now + 90_000,
    });
  }
  const attempt = attempts.get(running.id)?.[0];
  if (attempt && attempt.ended_at === null) {
    attempts.set(running.id, [
      {
        ...attempt,
        last_heartbeat_at: now - 4000,
        steps_count: 12 + done * 2,
        ai_calls: 3 + Math.floor(done / 2),
      },
    ]);
  }
}

// Acme: filled, waiting for the submit approval.
const acme = cardByCompany("Acme");
const awaiting = seedApplyTask(acme, {
  state: "awaiting_approval",
  progress: {
    stage: "awaiting_approval",
    step: 14,
    message: "Waiting for your approval",
  },
});
if (acme && awaiting) {
  progress(
    awaiting,
    "filling",
    9,
    "Filled 12 fields on 2 pages",
    NOW - 6 * MINUTE
  );
  progress(
    awaiting,
    "reviewing",
    12,
    "Reached the review page",
    NOW - 5 * MINUTE
  );
  const attempt = attempts.get(awaiting.id)?.[0];
  const approval = fresh(
    makeApproval(
      {
        ...submitPayload(acme.posting.id),
        ...(attempt ? { attempt_id: attempt.id } : {}),
        device_id: deviceId,
      } as ReturnType<typeof submitPayload>,
      {
        task_id: awaiting.id,
        application_id: acme.id,
        created_at: NOW - 4 * MINUTE,
      }
    )
  );
  approvals.set(approval.id, approval);
  event(
    awaiting,
    "approval_requested",
    { approval_id: approval.id, kind: "submit" },
    NOW - 4 * MINUTE
  );
  patchCard(acme.id, { live_task: live(awaiting) });
}

// Tokopedia: paused, the site wants a login.
const tokopedia = cardByCompany("Tokopedia");
const login = seedApplyTask(tokopedia, {
  state: "paused",
  pause_reason: "login_required",
  progress: {
    stage: "opening",
    step: 3,
    message: "The site asks you to log in",
  },
});
if (tokopedia && login) {
  event(
    login,
    "automation_task_paused",
    {
      task_id: login.id,
      state: "paused",
      pause_reason: "login_required",
      message: "Sign-in page on accounts.tokopedia.example",
    },
    NOW - 2 * MINUTE
  );
  patchCard(tokopedia.id, { live_task: live(login) });
}

// Gojek: paused on a protected question; the answer approval waits.
const gojek = cardByCompany("Gojek");
const question = seedApplyTask(gojek, {
  state: "paused",
  pause_reason: "protected_question",
  progress: {
    stage: "filling",
    step: 7,
    message: "A question needs your answer",
  },
});
if (gojek && question) {
  const attempt = attempts.get(question.id)?.[0];
  const approval = fresh(
    makeApproval(
      {
        ...answerPayload(),
        ...(attempt ? { attempt_id: attempt.id } : {}),
      } as ReturnType<typeof answerPayload>,
      {
        task_id: question.id,
        application_id: gojek.id,
        created_at: NOW - 12 * MINUTE,
      }
    )
  );
  approvals.set(approval.id, approval);
  event(
    question,
    "automation_task_paused",
    {
      task_id: question.id,
      state: "paused",
      pause_reason: "protected_question",
    },
    NOW - 12 * MINUTE
  );
  patchCard(gojek.id, { live_task: live(question) });
}

// Traveloka: the device crashed after submit_intent.
const traveloka = cardByCompany("Traveloka");
const unknown = seedApplyTask(
  traveloka,
  {
    state: "outcome_unknown",
    submit_intent_at: NOW - 3 * HOUR,
    lease_id: null,
    lease_expires_at: null,
    finished_at: NOW - 3 * HOUR + 3 * MINUTE,
    error_class: "lease_expired",
    error_message: "The device stopped responding after it started submitting.",
    created_at: NOW - 3 * HOUR - 8 * MINUTE,
    progress: { stage: "submitting", step: 18, message: "Clicked Submit" },
  },
  {
    ended_at: NOW - 3 * HOUR + 3 * MINUTE,
    outcome: "lease_expired",
    started_at: NOW - 3 * HOUR - 7 * MINUTE,
    last_heartbeat_at: NOW - 3 * HOUR,
  }
);
if (traveloka && unknown) {
  const attempt = attempts.get(unknown.id)?.[0];
  event(
    unknown,
    "submit_intent",
    {
      task_id: unknown.id,
      attempt_id: attempt?.id ?? newId("att", NOW),
      form_hash: FIXTURE_SHA_C,
    },
    NOW - 3 * HOUR - MINUTE,
    attempt?.id ?? null
  );
  event(
    unknown,
    "automation_task_finished",
    {
      task_id: unknown.id,
      state: "outcome_unknown",
      error_class: "lease_expired",
    },
    NOW - 3 * HOUR + 3 * MINUTE
  );
  const record = applicationOf(traveloka);
  state.applications.set(traveloka.id, {
    ...record,
    submission_status: "outcome_unknown",
  });
  patchCard(traveloka.id, { submission_status: "outcome_unknown" });
}

// Bukalapak: submitted, not verified; Umbrella: submitted and verified.
for (const [company, verdict] of [
  ["Bukalapak", "unverified"],
  ["Umbrella", "verified"],
] as const) {
  const card = cardByCompany(company);
  const finishedAt = (card?.stage_changed_at ?? NOW) - SHIFT;
  const done = seedApplyTask(
    card,
    {
      state: "submitted",
      lease_id: null,
      lease_expires_at: null,
      submit_intent_at: finishedAt - 2 * MINUTE,
      finished_at: finishedAt,
      created_at: finishedAt - 12 * MINUTE,
      progress: { stage: "done", step: 21, message: "Done" },
    },
    {
      ended_at: finishedAt,
      outcome: "submitted",
      started_at: finishedAt - 11 * MINUTE,
      last_heartbeat_at: finishedAt,
    }
  );
  if (card && done) {
    evidence.set(done.id, [
      fresh(
        makeEvidence(card.id, {
          task_id: done.id,
          verdict,
          signals:
            verdict === "verified"
              ? { url_match: true, dom_marker: true, http_status: 200 }
              : {
                  url_match: false,
                  dom_marker: false,
                  form_gone: true,
                  http_status: 200,
                },
          page_title:
            verdict === "verified" ? "Thank you for applying" : "Careers",
          captured_at: finishedAt - MINUTE,
          recorded_at: finishedAt,
        })
      ),
    ]);
    event(
      done,
      "automation_task_finished",
      { task_id: done.id, state: "submitted" },
      finishedAt
    );
  }
}

// Hooli: failed on an unsupported form.
const hooli = cardByCompany("Hooli");
seedApplyTask(
  hooli,
  {
    state: "failed",
    lease_id: null,
    lease_expires_at: null,
    error_class: "unsupported_form",
    error_message: "The form uses a widget the agent can't fill.",
    finished_at: NOW - 2 * DAY,
    created_at: NOW - 2 * DAY - 20 * MINUTE,
    progress: { stage: "filling", step: 6, message: "Unsupported date widget" },
  },
  {
    ended_at: NOW - 2 * DAY,
    outcome: "failed",
    error_class: "unsupported_form",
    started_at: NOW - 2 * DAY - 19 * MINUTE,
    last_heartbeat_at: NOW - 2 * DAY,
  }
);

// A discovery run and a CV render, neither tied to an application.
addTask(
  fresh(
    makeTask({
      kind: "discover",
      application_id: null,
      state: "succeeded",
      payload: { source_ids: [] },
      required_capabilities: ["discover"],
      lease_id: null,
      lease_device_id: deviceId,
      lease_expires_at: null,
      progress: { stage: "done", step: 4, message: "312 found" },
      created_at: NOW - 5 * HOUR,
      finished_at: NOW - 5 * HOUR + 4 * MINUTE,
    })
  )
);
addTask(
  fresh(
    makeTask({
      kind: "render_cv",
      application_id: null,
      state: "queued",
      payload: {},
      required_capabilities: ["render_cv"],
      lease_id: null,
      lease_device_id: null,
      lease_expires_at: null,
      attempt_count: 0,
      progress: {},
      created_at: NOW - 2 * MINUTE,
    })
  )
);

// A CV waiting for review (Globex) and a rule waiting for activation.
const globex = cardByCompany("Globex");
if (globex) {
  const approval = fresh(
    makeApproval(
      cvVariantPayload(newId("cvv", NOW - HOUR), newId("fil", NOW - HOUR)),
      {
        application_id: globex.id,
        created_at: NOW - 40 * MINUTE,
        expires_at: NOW + 6 * DAY,
      }
    )
  );
  approvals.set(approval.id, approval);
}

for (const rule of [
  fresh(makeRule()),
  fresh(
    makeRule({
      name: "Greenhouse auto-apply",
      mode: "auto",
      enabled: false,
      criteria: {
        min_score: 85,
        require_ai_component: true,
        max_score_age_days: 7,
        exclude_blocking_gates: true,
        exclude_possible_gates: true,
        keywords: ["frontend", "react"],
      },
      limits: {
        max_per_day: 5,
        max_per_company_per_30d: 2,
        active_hours: { start: "08:00", end: "20:00" },
        expires_at: NOW + 30 * DAY,
      },
      allowed_domains: ["greenhouse.io", "lever.co"],
      cv_policy: { tailor: true, require_cv_approval: true },
    })
  ),
]) {
  rules.set(rule.id, rule);
  if (rule.mode === "auto") {
    const approval = fresh(
      makeApproval(ruleActivationPayload(rule), {
        created_at: NOW - 90 * MINUTE,
        expires_at: NOW + 22 * HOUR,
      })
    );
    approvals.set(approval.id, approval);
  }
}

function refreshCounts(): void {
  state.board = {
    ...state.board,
    counts: {
      ...state.board.counts,
      approvals_pending: [...approvals.values()].filter(
        (approval) => approval.state === "pending"
      ).length,
      tasks_live: cards().filter((card) => card.live_task !== null).length,
    },
  };
  bumpBoard();
}
refreshCounts();

// ── Views ───────────────────────────────────────────────────────────────────

function tick(now: number): void {
  advanceRunning(now);
  for (const [taskId, at] of resumeAt) {
    const task = tasks.get(taskId);
    if (!task || now < at) {
      continue;
    }
    resumeAt.delete(taskId);
    if (task.state !== "paused") {
      continue;
    }
    const next: AutomationTaskRecord = {
      ...task,
      state: "running",
      pause_reason: null,
      resume_requested: false,
      progress: {
        stage: "filling",
        step: task.attempt_count + 4,
        message: "Resumed after login",
      },
      updated_at: now,
      revision: task.revision + 1,
    };
    tasks.set(taskId, next);
    event(
      next,
      "automation_task_progress",
      {
        task_id: taskId,
        state: "running",
        stage: "filling",
        step: 5,
        message: "Resumed after login",
      },
      now - SHIFT
    );
    if (next.application_id) {
      patchCard(next.application_id, { live_task: live(next) });
    }
  }
}

/** The claim bundle of an apply task (21 §5.1), as the monitor reads it. */
function contextOf(task: AutomationTaskRecord): TaskDetail["context"] {
  if (task.kind !== "apply" || !task.application_id) {
    return null;
  }
  const card = cards().find((entry) => entry.id === task.application_id);
  if (!card) {
    return null;
  }
  const detail = detailOf(card);
  const mode = task.payload.mode ?? card.mode;
  return {
    kind: "apply",
    application: detail.application,
    posting: detail.posting,
    mode,
    cv:
      card.posting.company_name === "Tokopedia"
        ? null
        : {
            cv_variant_id: card.cv_variant_id,
            status: "approved",
            file: { file_id: newId("fil", NOW - DAY), sha256: FIXTURE_SHA_D },
          },
    cover_letter: null,
    rule: null,
    allowed_domains: ["greenhouse.io"],
    adapter: null,
    approval_policy: {
      submit_requires_approval: mode === "approval",
      generated_text_allowed: mode !== "auto",
      evidence_screenshots: "on_submit",
    },
    resume_from_approval: null,
  };
}

function detailOfTask(task: AutomationTaskRecord): TaskDetail {
  return TaskDetailSchema.parse({
    task,
    attempts: attempts.get(task.id) ?? [],
    approvals: [...approvals.values()].filter(
      (approval) => approval.task_id === task.id
    ),
    evidence: evidence.get(task.id) ?? [],
    device_name:
      task.lease_device_id || task.target_device_id
        ? (device?.name ?? null)
        : null,
    context: contextOf(task),
  });
}

detailExtras.push((card, detail) => ({
  ...detail,
  tasks: [...tasks.values()].filter((task) => task.application_id === card.id),
  approvals: [...approvals.values()].filter(
    (approval) => approval.application_id === card.id
  ),
  evidence: [
    ...detail.evidence,
    ...[...tasks.values()]
      .filter((task) => task.application_id === card.id)
      .flatMap((task) => evidence.get(task.id) ?? []),
  ],
}));

extraEvents.push((card) => {
  tick(Date.now());
  return events.filter((entry) => entry.application_id === card.id);
});

// ── Routes ──────────────────────────────────────────────────────────────────

const APPROVALS_RE = /^\/api\/v1\/approvals$/;
const DECIDE_RE = /^\/api\/v1\/approvals\/([^/]+)\/decide$/;
const RULES_RE = /^\/api\/v1\/rules$/;
const RULE_RE = /^\/api\/v1\/rules\/([^/]+)$/;
const TASKS_RE = /^\/api\/v1\/tasks$/;
const TASK_RE = /^\/api\/v1\/tasks\/([^/]+)$/;
const TASK_ACTION_RE = /^\/api\/v1\/tasks\/([^/]+)\/(cancel|retry|resume)$/;

function activationFor(
  rule: AutomationRuleRecord,
  now: number
): ApprovalRecord {
  for (const approval of approvals.values()) {
    if (
      approval.state === "pending" &&
      approval.payload.type === "rule_activation" &&
      approval.payload.rule_id === rule.id
    ) {
      approvals.set(approval.id, { ...approval, state: "expired" });
    }
  }
  const approval = makeApproval(ruleActivationPayload(rule), {
    id: newId("apr", now),
    created_at: now,
    expires_at: now + DAY,
    payload_hash: FIXTURE_SHA_D,
  });
  approvals.set(approval.id, approval);
  refreshCounts();
  return approval;
}

function listApprovals(request: MockRequest): Reply | null {
  if (!match(request, "GET", APPROVALS_RE)) {
    return null;
  }
  tick(Date.now());
  const wanted = request.url.searchParams.get("state");
  const kind = request.url.searchParams.get("kind");
  return page(
    [...approvals.values()].filter(
      (approval) =>
        (!wanted || approval.state === wanted) &&
        (!kind || approval.kind === kind)
    )
  );
}

const LIVE_STATES = [
  "queued",
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
] as const;

function isLive(task: AutomationTaskRecord): boolean {
  return (LIVE_STATES as readonly string[]).includes(task.state);
}

/** The task after its approval was decided (21 §6.3). */
function afterDecision(
  task: AutomationTaskRecord,
  approval: ApprovalRecord,
  approved: boolean,
  now: number
): AutomationTaskRecord {
  if (!approved) {
    return {
      ...task,
      state: "cancelled",
      error_class: "approval_rejected",
      finished_at: now,
      lease_id: null,
      lease_expires_at: null,
      updated_at: now,
      revision: task.revision + 1,
    };
  }
  const submitting = approval.kind === "submit";
  return {
    ...task,
    state: "running",
    pause_reason: null,
    progress: {
      stage: submitting ? "submitting" : "filling",
      step: 15,
      message: submitting ? "Submitting" : "Answers received",
    },
    updated_at: now,
    revision: task.revision + 1,
  };
}

function activateRule(approval: ApprovalRecord, now: number): void {
  if (approval.payload.type !== "rule_activation") {
    return;
  }
  const rule = rules.get(approval.payload.rule_id);
  if (rule) {
    rules.set(rule.id, {
      ...rule,
      enabled: true,
      activated_approval_id: approval.id,
      revision: rule.revision + 1,
      updated_at: now,
    });
  }
}

/** Why a decision is refused, like the api (first decision wins, 03 §8). */
function decideRefusal(
  approval: ApprovalRecord,
  payloadHash: unknown,
  now: number
): Reply | null {
  if (
    approval.state === "expired" ||
    (approval.state === "pending" && approval.expires_at <= now)
  ) {
    return apiError(410, "approval_expired", "This approval has expired.");
  }
  if (approval.state !== "pending") {
    return revisionConflict(approval);
  }
  if (payloadHash !== approval.payload_hash) {
    return apiError(409, "revision_conflict", "The approval changed.", {
      reason: "payload_hash_mismatch",
      current: approval,
    });
  }
  return null;
}

function decide(request: MockRequest): Reply | null {
  const found = match(request, "POST", DECIDE_RE);
  if (!found) {
    return null;
  }
  const approval = approvals.get(found[0] ?? "");
  if (!approval) {
    return NOT_FOUND;
  }
  const now = Date.now();
  const refusal = decideRefusal(approval, request.body.payload_hash, now);
  if (refusal) {
    return refusal;
  }
  const approved = request.body.decision === "approve";
  const decided: ApprovalRecord = {
    ...approval,
    state: approved ? "approved" : "rejected",
    response: (request.body.response as ApprovalRecord["response"]) ?? null,
    decided_via: "web",
    decided_by_user_id: approval.user_id,
    decided_at: now,
    revision: approval.revision + 1,
  };
  approvals.set(approval.id, decided);
  const before = approval.task_id ? tasks.get(approval.task_id) : undefined;
  const task = before ? afterDecision(before, approval, approved, now) : null;
  if (task) {
    tasks.set(task.id, task);
    event(
      task,
      "approval_decided",
      {
        approval_id: approval.id,
        kind: approval.kind,
        decision: decided.state,
      },
      now - SHIFT
    );
    if (task.application_id) {
      patchCard(task.application_id, {
        live_task: isLive(task) ? live(task) : null,
      });
    }
  }
  if (approved) {
    activateRule(approval, now);
  }
  refreshCounts();
  return ok({ approval: decided, task });
}

function createRule(request: MockRequest): Reply {
  const now = Date.now();
  const body = request.body as Partial<AutomationRuleRecord>;
  const auto = body.mode === "auto";
  let rule: AutomationRuleRecord;
  try {
    rule = makeRule({
      id: newId("rul", now),
      name: String(body.name ?? "Rule"),
      mode: body.mode ?? "approval",
      enabled: auto ? false : (body.enabled ?? true),
      ...(body.criteria ? { criteria: body.criteria } : {}),
      ...(body.limits ? { limits: body.limits } : {}),
      allowed_domains: body.allowed_domains ?? [],
      cv_policy: body.cv_policy ?? {},
      revision: 1,
      created_at: now,
      updated_at: now,
    });
  } catch {
    return apiError(400, "invalid_request", "Invalid rule.");
  }
  rules.set(rule.id, rule);
  const approval =
    auto && body.enabled !== false ? activationFor(rule, now) : undefined;
  return ok(approval ? { rule, approval } : { rule }, 201);
}

function updateRule(rule: AutomationRuleRecord, request: MockRequest): Reply {
  if (request.body.base_revision !== rule.revision) {
    return revisionConflict(rule);
  }
  const now = Date.now();
  const { base_revision: _base, ...changes } = request.body;
  const next = {
    ...rule,
    ...(changes as Partial<AutomationRuleRecord>),
    revision: rule.revision + 1,
    updated_at: now,
  } as AutomationRuleRecord;
  let approval: ApprovalRecord | undefined;
  // Turning an auto rule on never turns it on: it asks for an activation.
  if (next.mode === "auto" && changes.enabled === true) {
    next.enabled = false;
    next.activated_approval_id = null;
    approval = activationFor(next, now);
  }
  rules.set(next.id, next);
  return ok(approval ? { rule: next, approval } : { rule: next });
}

function deleteRule(rule: AutomationRuleRecord, request: MockRequest): Reply {
  const base = request.url.searchParams.get("base_revision");
  if (base && Number(base) !== rule.revision) {
    return revisionConflict(rule);
  }
  rules.delete(rule.id);
  return ok({ id: rule.id, deleted: true });
}

function rulesRoute(request: MockRequest): Reply | null {
  if (match(request, "GET", RULES_RE)) {
    return page([...rules.values()]);
  }
  if (match(request, "POST", RULES_RE)) {
    return createRule(request);
  }
  const found = RULE_RE.exec(request.path);
  if (!found) {
    return null;
  }
  const rule = rules.get(found[1] ?? "");
  if (!rule) {
    return NOT_FOUND;
  }
  switch (request.method) {
    case "GET":
      return ok({ rule });
    case "DELETE":
      return deleteRule(rule, request);
    case "PATCH":
      return updateRule(rule, request);
    default:
      return null;
  }
}

function listTasks(request: MockRequest): Reply {
  tick(Date.now());
  const wanted = request.url.searchParams.get("state");
  const appId = request.url.searchParams.get("application_id");
  return page(
    [...tasks.values()]
      .filter(
        (task) =>
          (!wanted || task.state === wanted) &&
          (!appId || task.application_id === appId)
      )
      .sort((a, b) => b.created_at - a.created_at)
  );
}

function queuedTask(
  now: number,
  fields: Partial<AutomationTaskRecord>
): AutomationTaskRecord {
  const task = addTask(
    makeTask({
      id: newId("tsk", now),
      state: "queued",
      lease_id: null,
      lease_device_id: null,
      lease_expires_at: null,
      attempt_count: 0,
      progress: {},
      created_at: now,
      updated_at: now,
      not_before: now,
      expires_at: now + 3 * DAY,
      ...fields,
    })
  );
  attempts.set(task.id, []);
  if (task.application_id) {
    patchCard(task.application_id, { live_task: live(task) });
    refreshCounts();
  }
  return task;
}

function createTask(request: MockRequest): Reply {
  const now = Date.now();
  const body = request.body as {
    kind?: AutomationTaskRecord["kind"];
    application_id?: string | null;
    payload?: AutomationTaskRecord["payload"];
    target_device_id?: string | null;
    idempotency_key?: string;
  };
  const kind = body.kind ?? "apply";
  const duplicate = [...tasks.values()].some(
    (task) => task.application_id === body.application_id && isLive(task)
  );
  if (duplicate && kind === "apply") {
    return apiError(
      409,
      "duplicate",
      "A run for this application is already live."
    );
  }
  const task = queuedTask(now, {
    kind,
    application_id: body.application_id ?? null,
    payload: body.payload ?? {},
    target_device_id: body.target_device_id ?? null,
    idempotency_key: body.idempotency_key ?? `mock:${now}`,
  });
  return ok({ task }, 201);
}

function resumeTask(task: AutomationTaskRecord, now: number): Reply {
  if (task.state !== "paused") {
    return apiError(
      422,
      "invalid_transition",
      "Only a paused task can be resumed."
    );
  }
  const next = {
    ...task,
    resume_requested: true,
    updated_at: now,
    revision: task.revision + 1,
  };
  tasks.set(task.id, next);
  resumeAt.set(task.id, now + 6000);
  return ok({ task: next });
}

function cancelTask(task: AutomationTaskRecord, now: number): Reply {
  if (!isLive(task)) {
    return apiError(
      422,
      "invalid_transition",
      `A ${task.state} task cannot be cancelled.`
    );
  }
  const queued = task.state === "queued";
  const next: AutomationTaskRecord = queued
    ? {
        ...task,
        state: "cancelled",
        finished_at: now,
        updated_at: now,
        revision: task.revision + 1,
      }
    : {
        ...task,
        cancel_requested: true,
        updated_at: now,
        revision: task.revision + 1,
      };
  tasks.set(task.id, next);
  if (queued && task.application_id) {
    patchCard(task.application_id, { live_task: null });
    refreshCounts();
  }
  return ok({ task: next });
}

/** "Not submitted": the application's outcome_unknown becomes failed. */
function markNotSubmitted(applicationId: string): void {
  const card = cards().find((entry) => entry.id === applicationId);
  if (!card) {
    return;
  }
  const record = applicationOf(card);
  state.applications.set(card.id, {
    ...record,
    submission_status: "failed",
    revision: record.revision + 1,
  });
  patchCard(card.id, { submission_status: "failed" });
}

function retryTask(
  task: AutomationTaskRecord,
  request: MockRequest,
  now: number
): Reply {
  if (task.state !== "failed" && task.state !== "outcome_unknown") {
    return apiError(
      422,
      "invalid_transition",
      "Only failed or outcome-unknown tasks can be retried."
    );
  }
  const unknown = task.state === "outcome_unknown";
  if (unknown && request.body.confirm_not_submitted !== true) {
    return apiError(
      422,
      "policy_violation",
      "Confirm that nothing was submitted first."
    );
  }
  if (unknown && task.application_id) {
    markNotSubmitted(task.application_id);
  }
  const retry = queuedTask(now, {
    kind: task.kind,
    application_id: task.application_id,
    payload: task.payload,
    retry_of: task.id,
  });
  return ok({ task: retry }, 201);
}

function taskAction(request: MockRequest): Reply | null {
  const action = match(request, "POST", TASK_ACTION_RE);
  if (!action) {
    return null;
  }
  const [taskId = "", verb] = action;
  const task = tasks.get(taskId);
  if (!task) {
    return NOT_FOUND;
  }
  const now = Date.now();
  if (verb === "resume") {
    return resumeTask(task, now);
  }
  if (verb === "cancel") {
    return cancelTask(task, now);
  }
  return retryTask(task, request, now);
}

function tasksRoute(request: MockRequest): Reply | null {
  if (match(request, "GET", TASKS_RE)) {
    return listTasks(request);
  }
  if (match(request, "POST", TASKS_RE)) {
    return createTask(request);
  }
  const one = match(request, "GET", TASK_RE);
  if (one) {
    tick(Date.now());
    const task = tasks.get(one[0] ?? "");
    return task ? ok(detailOfTask(task)) : NOT_FOUND;
  }
  return taskAction(request);
}

export const routes: MockRoute[] = [
  listApprovals,
  decide,
  rulesRoute,
  tasksRoute,
];
