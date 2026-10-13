"""Clock skew handling (20 §9).

The server time seen in `/meta` (`Date` header) and in every heartbeat (`server_time`)
is stored in `account.last_seen_server_time` together with the local clocks, and the CLI
derives an offset:

- `now_ms()` — local wall clock corrected by the offset. Every timestamp the CLI sends
  (`occurred_at`, `observed_at`) and every client-generated ULID uses it;
- `lease_deadline()` — a lease is treated as expiring at
  `local_monotonic_now + (lease_expires_at - server_time_at_grant) - 10 s`, on the
  **monotonic** clock, so wall-clock jumps cannot extend a lease locally.

An HTTP `Date` header has a 1-second resolution: the server time lies in `[D, D + 1 s)`.
When the corrected clock already falls inside that window the offset is kept (a heartbeat's
millisecond `server_time` stays authoritative); otherwise the offset moves to `D`, which can
step `now_ms()` back by up to about a second. `Outbox.ready()` tolerates that step.

Lease expiry itself is evaluated only on the server.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Final

from pilih_jobs.contracts import ids
from pilih_jobs.storage.db import StateDB

LEASE_SAFETY_MARGIN_MS: Final = 10_000
#: Resolution of an HTTP `Date` header (RFC 9110 §5.6.7: whole seconds).
HTTP_DATE_RESOLUTION_MS: Final = 1_000
#: kv key of the persisted offset, so a new process starts corrected.
KV_OFFSET: Final = "clock_offset"


def _wall_ms() -> int:
    return time.time_ns() // 1_000_000


def _mono_ms() -> int:
    return time.monotonic_ns() // 1_000_000


@dataclass(frozen=True)
class ServerTimeSample:
    server_time_ms: int
    local_wall_ms: int
    local_monotonic_ms: int

    @property
    def offset_ms(self) -> int:
        return self.server_time_ms - self.local_wall_ms


class ClockSync:
    """Process-wide server clock estimate."""

    def __init__(
        self,
        *,
        wall: Callable[[], int] = _wall_ms,
        monotonic: Callable[[], int] = _mono_ms,
        db: StateDB | None = None,
        issuer: str | None = None,
    ) -> None:
        self._wall = wall
        self._monotonic = monotonic
        self._db = db
        self._issuer = issuer
        self.sample: ServerTimeSample | None = None
        self._offset_ms = 0
        if db is not None:
            stored = db.kv_get_json(KV_OFFSET)
            if isinstance(stored, dict) and isinstance(stored.get("offset_ms"), int):  # pyright: ignore[reportUnknownMemberType]
                self._offset_ms = int(stored["offset_ms"])  # pyright: ignore[reportUnknownArgumentType]

    @property
    def offset_ms(self) -> int:
        return self._offset_ms

    def observe(self, server_time_ms: int, *, rtt_ms: int = 0) -> ServerTimeSample:
        """Record a server time (heartbeat `server_time` or `/meta` `Date`)."""
        local = self._wall() - rtt_ms // 2
        return self._record(
            ServerTimeSample(server_time_ms, local, self._monotonic() - rtt_ms // 2)
        )

    def _record(self, sample: ServerTimeSample) -> ServerTimeSample:
        server_time_ms = sample.server_time_ms
        self.sample = sample
        self._offset_ms = sample.offset_ms
        if self._db is not None:
            self._db.kv_set_json(
                KV_OFFSET, {"offset_ms": self._offset_ms, "observed_at": server_time_ms}
            )
            if self._issuer is not None:
                self._db.execute(
                    "UPDATE account SET last_seen_server_time = ? WHERE issuer = ?",
                    (server_time_ms, self._issuer),
                )
        return sample

    def observe_http_date(self, value: str | None, *, rtt_ms: int = 0) -> ServerTimeSample | None:
        """Record an HTTP `Date` header (1 s resolution)."""
        if not value:
            return None
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
        server_ms = int(parsed.timestamp() * 1000)
        local = self._wall() - rtt_ms // 2
        estimate = local + self._offset_ms
        if server_ms <= estimate < server_ms + HTTP_DATE_RESOLUTION_MS:
            # Consistent with the header: keep the finer offset instead of truncating it.
            server_ms = estimate
        return self._record(ServerTimeSample(server_ms, local, self._monotonic() - rtt_ms // 2))

    def now_ms(self) -> int:
        """Wall clock corrected to the server's time."""
        return self._wall() + self._offset_ms

    def skew_ms(self) -> int:
        """How far the local clock is behind (+) or ahead (-) of the server."""
        return self._offset_ms

    def lease_deadline(self, lease_expires_at_ms: int, server_time_at_grant_ms: int) -> int:
        """Monotonic deadline (ms) after which the CLI must treat the lease as lost."""
        remaining = lease_expires_at_ms - server_time_at_grant_ms - LEASE_SAFETY_MARGIN_MS
        return self._monotonic() + remaining

    def monotonic_ms(self) -> int:
        return self._monotonic()

    def install(self) -> ClockSync:
        """Make `contracts.ids.new_id()` use the corrected clock."""
        ids.set_time_source(self.now_ms)
        return self


def corrected(value_ms: int, clock: ClockSync) -> int:
    """Correct a local timestamp (`occurred_at`) by the server offset."""
    return value_ms + clock.offset_ms
