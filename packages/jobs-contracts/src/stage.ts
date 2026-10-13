// State machines: application stages (03 §5.1), submission status (03 §5.2,
// 20 §6.2), automation tasks (21 §12) and approvals (03 §8).
import type {
  ActorKind,
  ApprovalState,
  Stage,
  StageActor,
  SubmissionStatus,
  TaskState,
} from "./enums";
import {
  NON_TERMINAL_STAGES,
  STAGES,
  STAGE_ACTORS,
  TERMINAL_STAGES,
} from "./enums";

// ---------------------------------------------------------------------------
// Application stages (03 §5.1)
// ---------------------------------------------------------------------------

export interface StageTransitionRule {
  /** Actors allowed to make this move (03 §5.1 "Who may move a card"). */
  actors: readonly StageActor[];
  from: Stage;
  /** Why the edge exists, for error messages and docs. */
  note: string;
  to: Stage;
}

const PREP_STAGES = ["saved", "preparing", "ready"] as const;

function rule(
  from: Stage,
  to: Stage,
  actors: readonly StageActor[],
  note: string
): StageTransitionRule {
  return { from, to, actors, note };
}

/** Automation may move these to `applied` (with submission evidence). */
function automationApplies(from: Stage): boolean {
  return (PREP_STAGES as readonly Stage[]).includes(from);
}

function buildStageTransitions(): StageTransitionRule[] {
  const rules: StageTransitionRule[] = [
    rule("saved", "preparing", ["user", "system"], "prep started"),
    rule("saved", "ready", ["user", "automation"], "materials ready"),
    rule(
      "preparing",
      "ready",
      ["user", "automation", "system"],
      "materials ready"
    ),
    rule("ready", "preparing", ["user"], "back to preparation"),
    rule("applied", "interviewing", ["user"], "interview scheduled"),
    rule("applied", "offer", ["user"], "offer without interviews"),
    rule("interviewing", "offer", ["user"], "offer received"),
    rule("offer", "accepted", ["user"], "offer accepted"),
    rule("rejected", "saved", ["user"], "reopen (user only)"),
    rule("withdrawn", "saved", ["user"], "reopen (user only)"),
  ];
  for (const from of PREP_STAGES) {
    rules.push(
      rule(
        from,
        "applied",
        automationApplies(from) ? ["user", "automation"] : ["user"],
        from === "ready" ? "submitted" : "applied elsewhere / from prep"
      )
    );
  }
  for (const from of NON_TERMINAL_STAGES) {
    rules.push(rule(from, "withdrawn", ["user"], "user withdrew"));
    rules.push(rule(from, "rejected", ["user"], "employer declined"));
  }
  return rules;
}

/**
 * Every legal stage edge with its actors (03 §5.1, driver interpretation):
 * - user: any edge below;
 * - automation: {saved, preparing, ready} → applied (with evidence) and
 *   {saved, preparing} → ready;
 * - system: saved → preparing and preparing → ready.
 * `accepted` has no outgoing edge; `from === to` is never a transition.
 */
export const STAGE_TRANSITIONS: readonly StageTransitionRule[] =
  buildStageTransitions();

const stageEdges = new Map<string, readonly StageActor[]>(
  STAGE_TRANSITIONS.map((edge) => [`${edge.from}>${edge.to}`, edge.actors])
);

export function isTerminalStage(stage: Stage): boolean {
  return (TERMINAL_STAGES as readonly Stage[]).includes(stage);
}

/** True when `actor` may move a card `from → to` (03 §5.1). */
export function canTransition(
  from: Stage,
  to: Stage,
  actor: StageActor
): boolean {
  if (from === to) {
    return false;
  }
  return stageEdges.get(`${from}>${to}`)?.includes(actor) ?? false;
}

/** Stages reachable from `from` for `actor`, in board order. */
export function nextStages(from: Stage, actor: StageActor): Stage[] {
  return STAGES.filter((to) => canTransition(from, to, actor));
}

/**
 * Maps an event `actor_kind` to the stage-machine actor: user and MCP are
 * user surfaces (03 §5.1 "User (web, CLI interactive, MCP)"); legacy
 * migration writes as the system.
 */
export function stageActorFor(actorKind: ActorKind): StageActor {
  switch (actorKind) {
    case "user":
    case "mcp":
      return "user";
    case "automation":
      return "automation";
    default:
      return "system";
  }
}

/** All 9 × 9 × 3 combinations with the expected result (T6-01 vectors). */
export function stageTransitionMatrix(): {
  actor: StageActor;
  allowed: boolean;
  from: Stage;
  to: Stage;
}[] {
  const rows: {
    actor: StageActor;
    allowed: boolean;
    from: Stage;
    to: Stage;
  }[] = [];
  for (const from of STAGES) {
    for (const to of STAGES) {
      for (const actor of STAGE_ACTORS) {
        rows.push({ from, to, actor, allowed: canTransition(from, to, actor) });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Submission status (03 §5.2, 20 §6.2)
// ---------------------------------------------------------------------------

/**
 * Forward order: not_started < in_progress <
 * {failed, outcome_unknown, submitted_unverified} < submitted_verified.
 */
export const SUBMISSION_STATUS_RANK: Readonly<
  Record<SubmissionStatus, number>
> = {
  not_started: 0,
  in_progress: 1,
  failed: 2,
  outcome_unknown: 2,
  submitted_unverified: 2,
  submitted_verified: 3,
};

/**
 * The two moves between equal ranks (or backwards) that still count as
 * forward for automation and system writes:
 *
 * - `failed → in_progress`, the explicit **retry** edge (03 §5.2, 20 §6.2).
 * - `outcome_unknown → submitted_unverified`, the **evidence** edge: an
 *   automation result or late evidence (a lost lease, 20 §6.3 A) whose
 *   verdict says the form was submitted but could not be confirmed
 *   (`unverified`, 19 §9.2) resolves "we do not know" — evidence is a fact,
 *   and the task already moves `outcome_unknown → submitted` (21 §12).
 *   13 §5 S-24: "submission status updated with evidence". The reverse
 *   (`submitted_unverified → outcome_unknown`, e.g. a lease that expires
 *   after an unconfirmed submission) stays refused, and the stage is never
 *   moved by this rule (the stage precedence of 20 §6.2 is separate).
 *
 * User decisions are not limited by this table (`canChangeSubmissionStatus`).
 */
export const SUBMISSION_FORWARD_EXCEPTIONS: readonly (readonly [
  SubmissionStatus,
  SubmissionStatus,
])[] = [
  ["failed", "in_progress"],
  ["outcome_unknown", "submitted_unverified"],
];

/**
 * True when `from → to` moves strictly forward by rank, or is one of the
 * `SUBMISSION_FORWARD_EXCEPTIONS` (the retry edge and the evidence edge).
 * Other equal ranks and `from === to` are not forward.
 */
export function isForwardSubmission(
  from: SubmissionStatus,
  to: SubmissionStatus
): boolean {
  if (
    SUBMISSION_FORWARD_EXCEPTIONS.some(
      ([exceptionFrom, exceptionTo]) =>
        exceptionFrom === from && exceptionTo === to
    )
  ) {
    return true;
  }
  return SUBMISSION_STATUS_RANK[to] > SUBMISSION_STATUS_RANK[from];
}

/** Actors whose explicit decisions may set any submission status. */
export const SUBMISSION_DECISION_ACTORS = [
  "user",
  "mcp",
  "legacy_migration",
] as const satisfies readonly ActorKind[];

/**
 * 20 §6.2: automation and system writes only move forward; an explicit user
 * decision (user, MCP on the user's behalf, or the legacy import of a
 * user-set status) may move any value. `from === to` is no change.
 */
export function canChangeSubmissionStatus(
  from: SubmissionStatus,
  to: SubmissionStatus,
  actor: ActorKind
): boolean {
  if (from === to) {
    return false;
  }
  if ((SUBMISSION_DECISION_ACTORS as readonly ActorKind[]).includes(actor)) {
    return true;
  }
  return isForwardSubmission(from, to);
}

// ---------------------------------------------------------------------------
// Automation tasks (21 §12)
// ---------------------------------------------------------------------------

export const TASK_ACTORS = ["user", "device", "system"] as const;
export type TaskActor = (typeof TASK_ACTORS)[number];

export interface TaskTransitionRule {
  actors: readonly TaskActor[];
  from: TaskState;
  /** Spec reference. */
  source: string;
  to: TaskState;
  trigger: string;
}

function task(
  from: TaskState,
  to: TaskState,
  trigger: string,
  actors: readonly TaskActor[],
  source = "21 §12"
): TaskTransitionRule {
  return { from, to, trigger, actors, source };
}

const LEASE_HOLDING: readonly TaskState[] = [
  "claimed",
  "running",
  "paused",
  "awaiting_approval",
];

/**
 * The task transition table of 21 §12 as data. Rows with several "from"
 * states in the spec are expanded. Additions, with their source: claimed →
 * failed (reaper with attempts exhausted, 21 §7.1) and running/paused →
 * cancelled (result `cancelled`, 21 §6.6 and 03 §7.2). "any live →
 * outcome_unknown" applies to the lease-holding states, the only ones that
 * can carry `submit_intent_at`.
 */
export const TASK_TRANSITIONS: readonly TaskTransitionRule[] = [
  task("queued", "claimed", "claim", ["device"]),
  task("queued", "cancelled", "cancel", ["user", "system"]),
  task("queued", "expired", "reaper: expires_at passed", ["system"]),
  task("claimed", "running", "first heartbeat / started", ["device"]),
  task("claimed", "queued", "lease expiry or release", ["system", "device"]),
  task(
    "claimed",
    "failed",
    "lease expiry, attempts exhausted",
    ["system"],
    "21 §7.1"
  ),
  task("running", "paused", "paused event", ["device"]),
  task("paused", "running", "resumed event", ["device"]),
  task("running", "awaiting_approval", "approval created", ["device"]),
  task("awaiting_approval", "running", "approved, device continues", [
    "user",
    "device",
  ]),
  task("awaiting_approval", "queued", "approved after release", ["user"]),
  task("awaiting_approval", "cancelled", "approval rejected or expired", [
    "user",
    "system",
  ]),
  task("running", "queued", "release or retryable failure", [
    "device",
    "system",
  ]),
  task("paused", "queued", "release or retryable failure", [
    "device",
    "system",
  ]),
  task("running", "submitted", "result submitted", ["device"]),
  task("running", "succeeded", "result succeeded (discover, render_cv)", [
    "device",
  ]),
  task("running", "failed", "result failed or attempts exhausted", [
    "device",
    "system",
  ]),
  task("paused", "failed", "result failed or attempts exhausted", [
    "device",
    "system",
  ]),
  task("running", "cancelled", "result cancelled", ["device"], "21 §6.6"),
  task("paused", "cancelled", "result cancelled", ["device"], "21 §6.6"),
  ...LEASE_HOLDING.map((from) =>
    task(
      from,
      "outcome_unknown",
      "lease expiry / revoke / result after submit_intent",
      ["system", "device"]
    )
  ),
  task("outcome_unknown", "submitted", "late evidence", ["system"]),
  task("outcome_unknown", "failed", "user: not submitted", ["user"]),
];

const taskEdges = new Map<string, readonly TaskActor[]>();
for (const edge of TASK_TRANSITIONS) {
  const key = `${edge.from}>${edge.to}`;
  taskEdges.set(key, [
    ...new Set([...(taskEdges.get(key) ?? []), ...edge.actors]),
  ]);
}

/** True when the task table allows `from → to` (optionally for one actor). */
export function canTaskTransition(
  from: TaskState,
  to: TaskState,
  actor?: TaskActor
): boolean {
  const actors = taskEdges.get(`${from}>${to}`);
  if (!actors) {
    return false;
  }
  return actor === undefined || actors.includes(actor);
}

// ---------------------------------------------------------------------------
// Approvals (03 §8)
// ---------------------------------------------------------------------------

/** `pending → approved | rejected | expired`; decided states are final. */
export const APPROVAL_TRANSITIONS: Readonly<
  Record<ApprovalState, readonly ApprovalState[]>
> = {
  pending: ["approved", "rejected", "expired"],
  approved: [],
  rejected: [],
  expired: [],
};

export function canApprovalTransition(
  from: ApprovalState,
  to: ApprovalState
): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

/** Default approval lifetimes (03 §8). */
export const APPROVAL_EXPIRY_MS = {
  submit: 86_400_000,
  answer: 86_400_000,
  cv_variant: 604_800_000,
  rule_activation: 604_800_000,
} as const;
