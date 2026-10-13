"""State machines (03 §5, 20 §6.2, 21 §12, 03 §8) — the Python mirror of `src/stage.ts`.

`packages/jobs-contracts/test-vectors/stage-transitions.json` lists every
stage × stage × actor combination with the expected result; the CLI tests replay it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

Stage = Literal[
    "saved",
    "preparing",
    "ready",
    "applied",
    "interviewing",
    "offer",
    "accepted",
    "rejected",
    "withdrawn",
]
StageActor = Literal["user", "automation", "system"]
SubmissionStatus = Literal[
    "not_started",
    "in_progress",
    "submitted_verified",
    "submitted_unverified",
    "failed",
    "outcome_unknown",
]
TaskState = Literal[
    "queued",
    "claimed",
    "running",
    "paused",
    "awaiting_approval",
    "submitted",
    "succeeded",
    "failed",
    "cancelled",
    "expired",
    "outcome_unknown",
]
TaskActor = Literal["user", "device", "system"]
ApprovalState = Literal["pending", "approved", "rejected", "expired"]

STAGES: Final[tuple[Stage, ...]] = (
    "saved",
    "preparing",
    "ready",
    "applied",
    "interviewing",
    "offer",
    "accepted",
    "rejected",
    "withdrawn",
)
STAGE_ACTORS: Final[tuple[StageActor, ...]] = ("user", "automation", "system")
TERMINAL_STAGES: Final[tuple[Stage, ...]] = ("accepted", "rejected", "withdrawn")
NON_TERMINAL_STAGES: Final[tuple[Stage, ...]] = tuple(s for s in STAGES if s not in TERMINAL_STAGES)
_PREP_STAGES: Final[tuple[Stage, ...]] = ("saved", "preparing", "ready")


@dataclass(frozen=True)
class StageTransitionRule:
    from_stage: Stage
    to_stage: Stage
    actors: tuple[StageActor, ...]
    note: str


def _build_stage_transitions() -> tuple[StageTransitionRule, ...]:
    rules = [
        StageTransitionRule("saved", "preparing", ("user", "system"), "prep started"),
        StageTransitionRule("saved", "ready", ("user", "automation"), "materials ready"),
        StageTransitionRule(
            "preparing", "ready", ("user", "automation", "system"), "materials ready"
        ),
        StageTransitionRule("ready", "preparing", ("user",), "back to preparation"),
        StageTransitionRule("applied", "interviewing", ("user",), "interview scheduled"),
        StageTransitionRule("applied", "offer", ("user",), "offer without interviews"),
        StageTransitionRule("interviewing", "offer", ("user",), "offer received"),
        StageTransitionRule("offer", "accepted", ("user",), "offer accepted"),
        StageTransitionRule("rejected", "saved", ("user",), "reopen (user only)"),
        StageTransitionRule("withdrawn", "saved", ("user",), "reopen (user only)"),
    ]
    rules.extend(
        StageTransitionRule(
            source,
            "applied",
            ("user", "automation"),
            "submitted" if source == "ready" else "applied elsewhere / from prep",
        )
        for source in _PREP_STAGES
    )
    for source in NON_TERMINAL_STAGES:
        rules.append(StageTransitionRule(source, "withdrawn", ("user",), "user withdrew"))
        rules.append(StageTransitionRule(source, "rejected", ("user",), "employer declined"))
    return tuple(rules)


STAGE_TRANSITIONS: Final = _build_stage_transitions()
_STAGE_EDGES: Final = {(r.from_stage, r.to_stage): r.actors for r in STAGE_TRANSITIONS}


def is_terminal_stage(stage: Stage) -> bool:
    return stage in TERMINAL_STAGES


def can_transition(from_stage: str, to_stage: str, actor: str) -> bool:
    """True when `actor` may move a card `from_stage → to_stage` (03 §5.1)."""
    if from_stage == to_stage:
        return False
    actors = _STAGE_EDGES.get((from_stage, to_stage))  # type: ignore[arg-type]
    return actors is not None and actor in actors


def next_stages(from_stage: Stage, actor: StageActor) -> list[Stage]:
    return [to for to in STAGES if can_transition(from_stage, to, actor)]


def stage_actor_for(actor_kind: str) -> StageActor:
    """Event `actor_kind` → stage-machine actor (user and MCP are user surfaces)."""
    if actor_kind in ("user", "mcp"):
        return "user"
    if actor_kind == "automation":
        return "automation"
    return "system"


# ------------------------------------------------------------------ submission status
#: Forward order: not_started < in_progress <
#: {failed, outcome_unknown, submitted_unverified} < submitted_verified.
SUBMISSION_STATUS_RANK: Final[dict[str, int]] = {
    "not_started": 0,
    "in_progress": 1,
    "failed": 2,
    "outcome_unknown": 2,
    "submitted_unverified": 2,
    "submitted_verified": 3,
}

#: The moves between equal ranks (or backwards) that still count as forward for
#: automation and system writes — `SUBMISSION_FORWARD_EXCEPTIONS` of `stage.ts`:
#:
#: - `failed → in_progress`, the explicit **retry** edge (03 §5.2, 20 §6.2);
#: - `outcome_unknown → submitted_unverified`, the **evidence** edge: an automation result
#:   or late evidence (a lost lease, 20 §6.3 A) whose verdict says the form was submitted
#:   but could not be confirmed (`unverified`, 19 §9.2) resolves "we do not know" —
#:   evidence is a fact, and the task already moves `outcome_unknown → submitted`
#:   (21 §12; 13 §5 S-24). The reverse (`submitted_unverified → outcome_unknown`, e.g. a
#:   lease that expires after an unconfirmed submission) stays refused, and the stage is
#:   never moved by this rule.
#:
#: User decisions are not limited by this table (`can_change_submission_status`).
SUBMISSION_FORWARD_EXCEPTIONS: Final[tuple[tuple[SubmissionStatus, SubmissionStatus], ...]] = (
    ("failed", "in_progress"),
    ("outcome_unknown", "submitted_unverified"),
)
SUBMISSION_DECISION_ACTORS: Final = ("user", "mcp", "legacy_migration")


def is_forward_submission(from_status: str, to_status: str) -> bool:
    """Strictly forward by rank, or one of `SUBMISSION_FORWARD_EXCEPTIONS` (03 §5.2).

    Other equal ranks and `from == to` are not forward.
    """
    if (from_status, to_status) in SUBMISSION_FORWARD_EXCEPTIONS:
        return True
    return SUBMISSION_STATUS_RANK[to_status] > SUBMISSION_STATUS_RANK[from_status]


def can_change_submission_status(from_status: str, to_status: str, actor_kind: str) -> bool:
    """20 §6.2: automation/system only move forward; explicit user decisions may set any."""
    if from_status == to_status:
        return False
    if actor_kind in SUBMISSION_DECISION_ACTORS:
        return True
    return is_forward_submission(from_status, to_status)


# ------------------------------------------------------------------ tasks (21 §12)
@dataclass(frozen=True)
class TaskTransitionRule:
    from_state: TaskState
    to_state: TaskState
    trigger: str
    actors: tuple[TaskActor, ...]
    source: str = "21 §12"


_LEASE_HOLDING: Final[tuple[TaskState, ...]] = ("claimed", "running", "paused", "awaiting_approval")

TASK_TRANSITIONS: Final[tuple[TaskTransitionRule, ...]] = (
    TaskTransitionRule("queued", "claimed", "claim", ("device",)),
    TaskTransitionRule("queued", "cancelled", "cancel", ("user", "system")),
    TaskTransitionRule("queued", "expired", "reaper: expires_at passed", ("system",)),
    TaskTransitionRule("claimed", "running", "first heartbeat / started", ("device",)),
    TaskTransitionRule("claimed", "queued", "lease expiry or release", ("system", "device")),
    TaskTransitionRule(
        "claimed", "failed", "lease expiry, attempts exhausted", ("system",), "21 §7.1"
    ),
    TaskTransitionRule("running", "paused", "paused event", ("device",)),
    TaskTransitionRule("paused", "running", "resumed event", ("device",)),
    TaskTransitionRule("running", "awaiting_approval", "approval created", ("device",)),
    TaskTransitionRule(
        "awaiting_approval", "running", "approved, device continues", ("user", "device")
    ),
    TaskTransitionRule("awaiting_approval", "queued", "approved after release", ("user",)),
    TaskTransitionRule(
        "awaiting_approval", "cancelled", "approval rejected or expired", ("user", "system")
    ),
    TaskTransitionRule("running", "queued", "release or retryable failure", ("device", "system")),
    TaskTransitionRule("paused", "queued", "release or retryable failure", ("device", "system")),
    TaskTransitionRule("running", "submitted", "result submitted", ("device",)),
    TaskTransitionRule(
        "running", "succeeded", "result succeeded (discover, render_cv)", ("device",)
    ),
    TaskTransitionRule(
        "running", "failed", "result failed or attempts exhausted", ("device", "system")
    ),
    TaskTransitionRule(
        "paused", "failed", "result failed or attempts exhausted", ("device", "system")
    ),
    TaskTransitionRule("running", "cancelled", "result cancelled", ("device",), "21 §6.6"),
    TaskTransitionRule("paused", "cancelled", "result cancelled", ("device",), "21 §6.6"),
    *(
        TaskTransitionRule(
            state,
            "outcome_unknown",
            "lease expiry / revoke / result after submit_intent",
            ("system", "device"),
        )
        for state in _LEASE_HOLDING
    ),
    TaskTransitionRule("outcome_unknown", "submitted", "late evidence", ("system",)),
    TaskTransitionRule("outcome_unknown", "failed", "user: not submitted", ("user",)),
)


def _task_edges() -> dict[tuple[str, str], frozenset[str]]:
    edges: dict[tuple[str, str], set[str]] = {}
    for rule in TASK_TRANSITIONS:
        edges.setdefault((rule.from_state, rule.to_state), set()).update(rule.actors)
    return {key: frozenset(value) for key, value in edges.items()}


_TASK_EDGES: Final = _task_edges()


def can_task_transition(from_state: str, to_state: str, actor: str | None = None) -> bool:
    actors = _TASK_EDGES.get((from_state, to_state))
    if actors is None:
        return False
    return actor is None or actor in actors


# ------------------------------------------------------------------ approvals (03 §8)
APPROVAL_TRANSITIONS: Final[dict[str, tuple[str, ...]]] = {
    "pending": ("approved", "rejected", "expired"),
    "approved": (),
    "rejected": (),
    "expired": (),
}

APPROVAL_EXPIRY_MS: Final[dict[str, int]] = {
    "submit": 86_400_000,
    "answer": 86_400_000,
    "cv_variant": 604_800_000,
    "rule_activation": 604_800_000,
}


def can_approval_transition(from_state: str, to_state: str) -> bool:
    return to_state in APPROVAL_TRANSITIONS.get(from_state, ())
