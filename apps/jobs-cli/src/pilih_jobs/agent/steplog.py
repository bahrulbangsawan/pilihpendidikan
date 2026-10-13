"""The attempt step log `<run_dir>/steps.jsonl` (19 §11).

Every line goes through `pilih_jobs.logging.StepLog` (the shared redaction). On top of it:

- field values are logged only as `[redacted:len=13,sha=4f2a]` — except option values of
  fixed enumerations ("Yes", a country) on non-sensitive fields;
- fact and answer contents, generated text bodies, cookies, headers, tokens and screenshots
  are never logged; raw aria snapshots are summarized by their SHA-256 and size;
- profile paths never appear (only the profile name).

Event types: `attempt_started`, `observation`, `ai_call`, `plan_validated`,
`action_executed`, `action_failed`, `pause_started`, `pause_resolved`,
`approval_requested`, `approval_decided`, `submit_intent`, `evidence`,
`attempt_finished`.
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any, Final

from pilih_jobs.logging import StepLog, bind

STEPS_FILE: Final = "steps.jsonl"
EVENT_TYPES: Final = frozenset(
    {
        "attempt_started",
        "observation",
        "ai_call",
        "plan_validated",
        "action_executed",
        "action_failed",
        "pause_started",
        "pause_resolved",
        "approval_requested",
        "approval_decided",
        "submit_intent",
        "evidence",
        "attempt_finished",
    }
)


def redacted_value(value: str | None) -> str:
    """`[redacted:len=13,sha=4f2a]` — the only form a typed value takes in the log."""
    text = value or ""
    digest = hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()[:4]
    return f"[redacted:len={len(text)},sha={digest}]"


def loggable_value(
    value: str | None, *, value_source: str, sensitivity: str, is_option: bool
) -> str:
    if is_option and value_source == "option" and sensitivity == "none" and value is not None:
        return value[:80]
    return redacted_value(value)


class AttemptLog:
    def __init__(self, run_dir: Path, *, attempt_id: str, task_id: str, lease_id: str) -> None:
        self.path = run_dir / STEPS_FILE
        self.attempt_id = attempt_id
        self.task_id = task_id
        self.lease_id = lease_id
        self._log = StepLog(self.path)
        self.count = 0

    def event(self, event: str, *, step: int | None = None, **data: Any) -> None:
        if event not in EVENT_TYPES:
            raise ValueError(f"unknown step-log event {event!r}")
        payload: dict[str, Any] = {"attempt_id": self.attempt_id, **data}
        if step is not None:
            payload["step"] = step
        payload["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with bind(attempt_id=self.attempt_id, task_id=self.task_id, lease_id=self.lease_id):
            self._log.write(event, **payload)
        self.count += 1

    def action(
        self,
        event: str,
        *,
        step: int,
        action: dict[str, Any],
        field: dict[str, Any] | None,
        result: dict[str, Any],
        page: dict[str, Any],
    ) -> None:
        self.event(event, step=step, action=action, field=field, result=result, page=page, ai=None)
