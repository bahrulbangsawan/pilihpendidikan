"""Cross-leaf types of the browser agent (PLAN C6; owned by leaf 4.3 afterwards).

`tasks/` (leaf 4.4) implements `LeaseChannel` over the API client and owns claim,
heartbeat and fencing; the agent (leaf 4.3) receives an `AttemptContext`, talks to the
cloud only through `ctx.channel`, and returns an `AttemptResult`.

Contract of `LeaseChannel` (21 §5–§6, 19 §8–§11) — what the agent sends and expects:

- `events(items)` — queue lease events (`POST …/lease/{l}/events`, ≤ 50 per request or
  every 5 s, through the outbox as `lease_report`). Every item is a `LeaseEvent` of 05 §8
  built by the agent (`type` ∈ `started`, `progress`, `paused`, `resumed`, `log`, with
  `idempotency_key` and `occurred_at`; `progress` carries `{stage, step, message}`,
  `paused` carries `pause_reason` + `message`). The agent never sends `submit_intent`
  or `approval_requested` here.
- `create_approval(kind, payload, payload_hash)` — `kind` is `submit` (payload type
  `browser_submit`) or `answer` (payload type `answer`); returns the approval record
  (`id`, `state`, `expires_at`, …). `poll_approval(approval_id)` returns the record with
  `state` ∈ `pending|approved|rejected|expired` and `response` (answers).
  `payload_hash = sha256(canonical JSON of payload)` (19 §8.2); the submit payload also
  carries `form_hash`, which is what `submit_intent` sends.
- `submit_intent(form_hash, approval_id=None, rule_id=None)` — **synchronous**
  `POST …/submit-intent`; returns `{submit_intent_at}` and raises on anything but 200
  (never queued offline, 21 §6.5). The agent clicks Submit only after it returned.
- `ai(endpoint, body)` — `endpoint` is the route suffix: `page-classify`, `next-action`,
  `field-plan` or `verify-submission` (→ `POST /api/v1/ai/<endpoint>`, 05 §9). The body
  already carries `lease_ref = {task_id, lease_id}`; the response dict is validated by
  the agent against the generated models.
- `upload_file(kind, path, links)` — the agent uploads `evidence_screenshot` files
  (`links = {application_id, task_id}`); it never uploads the step log itself:
  `AttemptResult.log_path` points at `steps.jsonl` for the `run_log` upload (19 §11.1).
- `download_file(file_id, dest, sha256)` — R2 files with SHA-256 verification (18 §7.1);
  the agent re-hashes the staged copy before every upload.
- `lost` is set when the lease is lost (409 `lease_lost`, 110 s without heartbeat, 401
  revoked): the agent stops acting at once, closes the page without submitting and never
  reports under that lease. A 401 / 409 raised by any channel call has the same effect.
  `cancel_requested` / `resume_requested` are delivered by heartbeats.

`AttemptContext.headed` is the runner's choice (`tasks.runner.decide_headed`: the
`--headed/--headless` flags, else `apply.headless_approval` for approval mode); 18 §5 still
forces a headed window for `assisted`, and for `auto` on adapters without `headless_ok`.
`AttemptContext.options` is the caller's `AttemptOptions` completed by the runner (data dir,
configured browser, an `on_event` relay; terminal hooks only for an interactive `apply`).
`AttemptResult.outcome = "cancelled"` with `error_class = "dry_run"` is a
completed `--dry-run` (filled, stopped before the submit gate, no `submit_intent`).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

from pilih_jobs.agent.options import AttemptOptions

AttemptMode = Literal["assisted", "approval", "auto"]
AttemptOutcome = Literal["submitted", "failed", "cancelled", "outcome_unknown", "paused"]


class LeaseChannel(Protocol):
    lost: asyncio.Event
    cancel_requested: asyncio.Event
    resume_requested: asyncio.Event

    async def events(self, items: list[dict[str, Any]]) -> None: ...

    async def create_approval(
        self, kind: str, payload: dict[str, Any], payload_hash: str
    ) -> dict[str, Any]: ...

    async def poll_approval(self, approval_id: str) -> dict[str, Any]: ...

    async def submit_intent(
        self, form_hash: str, approval_id: str | None = None, rule_id: str | None = None
    ) -> dict[str, Any]: ...

    async def ai(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]: ...

    async def upload_file(self, kind: str, path: Path, links: dict[str, Any]) -> dict[str, Any]: ...

    async def download_file(self, file_id: str, dest: Path, sha256: str) -> Path: ...


@dataclass
class AttemptContext:
    task: dict[str, Any]
    lease_id: str
    attempt_id: str
    context: dict[str, Any]  # the claim context (21 §5.1)
    channel: LeaseChannel
    mode: AttemptMode
    headed: bool
    interactive: bool
    run_dir: Path
    dry_run: bool
    approve_in_cli: bool
    #: Optional knobs and terminal hooks (`agent.options`); None = config defaults.
    options: AttemptOptions | None = None


@dataclass
class AttemptResult:
    outcome: AttemptOutcome
    error_class: str | None = None
    retryable: bool = False
    evidence: dict[str, Any] | None = None
    submission_status: str | None = None
    submit_intent_at: int | None = None
    steps: int = 0
    ai_calls: int = 0
    log_path: Path | None = None
    pause_reason: str | None = None
    #: Extra facts for the runner (optional, PLAN C6 extension): `reason`
    #: (approval_rejected …), `email` (email_application_required), `auto_failures`,
    #: `back_to_approval`, `via` (`assisted_user_click`), `message`, `lease_lost`.
    details: dict[str, Any] | None = None
