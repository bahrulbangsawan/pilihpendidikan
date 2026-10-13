"""Time source of the discovery engine (politeness delays, backoff, timestamps).

The engine never calls `asyncio.sleep`/`time.monotonic` directly: it asks an
`EngineClock`, so the scheduler and the retry policy can be verified on a virtual clock
in tests (15 §16 "fake clock"). The minimum delays themselves are not configurable.
"""

from __future__ import annotations

import asyncio
import time
from typing import Protocol

from pilih_jobs.contracts import ids


class EngineClock(Protocol):
    def monotonic(self) -> float: ...

    async def sleep(self, seconds: float) -> None: ...

    def now_ms(self) -> int: ...


class RealClock:
    """Monotonic seconds, `asyncio.sleep`, and the server-corrected wall clock (20 §9)."""

    def monotonic(self) -> float:
        return time.monotonic()

    async def sleep(self, seconds: float) -> None:
        if seconds > 0:
            await asyncio.sleep(seconds)

    def now_ms(self) -> int:
        return ids.now_ms()


def default_engine_clock() -> EngineClock:
    return RealClock()
