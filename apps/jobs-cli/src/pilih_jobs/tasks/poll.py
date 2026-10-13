"""Claiming work: the adaptive poll interval and `tasks:claim` (21 §1.1, §3, §5.1).

Interval (before jitter):

| Condition                                                  | Interval |
|------------------------------------------------------------|----------|
| the server sent `poll_interval_ms` (claim/heartbeat)       | that     |
| work was claimed or a task created here in the last 5 min  | 5 s      |
| otherwise                                                  | 30 s     |
| no work claimed for 1 h                                    | 60 s     |
| `204` + `Retry-After` / `429`                              | obey     |

±20 % jitter is applied and the result is never below 2 s.
"""

from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, cast

from pilih_jobs.api.client import ApiClient
from pilih_jobs.contracts import ids
from pilih_jobs.tasks.constants import (
    DORMANT_AFTER_MS,
    POLL_ACTIVE_MS,
    POLL_DORMANT_MS,
    POLL_IDLE_MS,
    POLL_JITTER,
    POLL_MIN_MS,
    RECENT_TASK_MS,
)
from pilih_jobs.tasks.lease import LeaseGrant, mono_ms


@dataclass
class PollPolicy:
    """Computes the next poll delay; feed it with server hints and claim outcomes."""

    monotonic: Callable[[], int] = mono_ms
    rng: Callable[[], float] = random.random
    server_interval_ms: int | None = None
    retry_after_ms: int | None = None
    started_mono: int = field(default=-1)
    last_work_mono: int | None = None
    last_task_created_mono: int | None = None

    def __post_init__(self) -> None:
        if self.started_mono < 0:
            self.started_mono = self.monotonic()

    def observe_server(self, interval_ms: int | None) -> None:
        if isinstance(interval_ms, int) and interval_ms > 0:
            self.server_interval_ms = max(POLL_MIN_MS, interval_ms)

    def observe_retry_after(self, seconds: float | None) -> None:
        self.retry_after_ms = None if seconds is None else max(0, int(seconds * 1000))

    def work_claimed(self) -> None:
        self.last_work_mono = self.monotonic()

    def task_created(self) -> None:
        self.last_task_created_mono = self.monotonic()

    def base_ms(self) -> int:
        now = self.monotonic()
        if self.server_interval_ms is not None:
            return self.server_interval_ms
        recent = [m for m in (self.last_work_mono, self.last_task_created_mono) if m is not None]
        if recent and now - max(recent) <= RECENT_TASK_MS:
            return POLL_ACTIVE_MS
        reference = self.last_work_mono if self.last_work_mono is not None else self.started_mono
        if now - reference >= DORMANT_AFTER_MS:
            return POLL_DORMANT_MS
        return POLL_IDLE_MS

    def next_delay_ms(self) -> int:
        if self.retry_after_ms is not None:
            delay = max(POLL_MIN_MS, self.retry_after_ms)
            self.retry_after_ms = None
            return delay
        base = self.base_ms()
        jitter = (self.rng() * 2 - 1) * POLL_JITTER  # uniform in [-20 %, +20 %]
        return max(POLL_MIN_MS, int(base * (1 + jitter)))


def claim_key(device_id: str) -> str:
    """`claim:<dev_id>:<ULID>` (21 §5.1)."""
    return f"claim:{device_id}:{ids.new_ulid()}"


@dataclass
class ClaimOutcome:
    grant: LeaseGrant | None
    retry_after: float | None = None
    poll_interval_ms: int | None = None


async def claim(
    api: ApiClient,
    device_id: str,
    capabilities: list[str],
    *,
    now_ms: Callable[[], int] = ids.now_ms,
) -> ClaimOutcome:
    """`POST /api/v1/devices/{dev}/tasks:claim {capabilities, max: 1}` → grant or `204`."""
    response = await api.request(
        "POST",
        f"/api/v1/devices/{device_id}/tasks:claim",
        json_body={"capabilities": sorted(set(capabilities)), "max": 1},
        idempotency_key=claim_key(device_id),
    )
    retry_after_raw = response.headers.get("retry-after")
    retry_after: float | None = None
    if retry_after_raw is not None:
        try:
            retry_after = max(0.0, float(retry_after_raw))
        except ValueError:
            retry_after = None
    data = response.data
    if response.status == 204 or not isinstance(data, dict):
        return ClaimOutcome(None, retry_after=retry_after)
    body = cast(dict[str, Any], data)
    if body.get("task") is None:
        return ClaimOutcome(None, retry_after=retry_after)
    grant = LeaseGrant.from_claim(body, server_time=now_ms())
    return ClaimOutcome(grant, retry_after=retry_after, poll_interval_ms=grant.poll_interval_ms)
