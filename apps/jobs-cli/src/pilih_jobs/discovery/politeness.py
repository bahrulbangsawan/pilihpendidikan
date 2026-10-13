"""Per-domain politeness (15 §7.1): forced minimums; a source may be *more* polite only.

| Setting                          | Value                                                    |
|----------------------------------|----------------------------------------------------------|
| Global concurrent requests       | 4                                                        |
| Per registrable domain           | ≤ 2 (JSON APIs), 1 (HTML / browser), lower if manifest says |
| Delay between request starts     | ≥ 1.0 s JSON, ≥ 2.0 s HTML/browser, + 0–500 ms jitter;   |
|                                  | the manifest `min_delay_ms` or robots `Crawl-delay` if larger |

An HTML/browser request waits until nothing else runs against its domain; a JSON request
waits until fewer than two JSON requests and no HTML request run there. Start times are
reserved under the domain lock, so concurrent callers stay spaced out.
"""

from __future__ import annotations

import asyncio
import contextlib
import random
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Final

from pilih_jobs.discovery.clock import EngineClock

GLOBAL_CONCURRENCY: Final = 4
JSON_DOMAIN_CONCURRENCY: Final = 2
HTML_DOMAIN_CONCURRENCY: Final = 1
JSON_MIN_DELAY_S: Final = 1.0
HTML_MIN_DELAY_S: Final = 2.0
JITTER_MAX_S: Final = 0.5


@dataclass
class _DomainState:
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)
    json_in_flight: int = 0
    html_in_flight: int = 0
    last_start: float = float("-inf")


@dataclass(frozen=True)
class SlotRecord:
    domain: str
    html: bool
    start: float
    delay_s: float


class PolitenessScheduler:
    def __init__(
        self,
        clock: EngineClock,
        rng: random.Random,
        *,
        global_concurrency: int = GLOBAL_CONCURRENCY,
    ) -> None:
        self._clock = clock
        self._rng = rng
        self._global = asyncio.Semaphore(min(global_concurrency, GLOBAL_CONCURRENCY))
        self._domains: dict[str, _DomainState] = {}
        self.history: list[SlotRecord] = []

    @staticmethod
    def effective_delay(*, html: bool, min_delay_s: float) -> float:
        floor = HTML_MIN_DELAY_S if html else JSON_MIN_DELAY_S
        return max(floor, min_delay_s)

    @staticmethod
    def effective_concurrency(*, html: bool, concurrency: int) -> int:
        if html:
            return HTML_DOMAIN_CONCURRENCY
        return max(1, min(JSON_DOMAIN_CONCURRENCY, concurrency))

    def _state(self, domain: str) -> _DomainState:
        state = self._domains.get(domain)
        if state is None:
            state = _DomainState()
            self._domains[domain] = state
        return state

    @contextlib.asynccontextmanager
    async def slot(
        self, domain: str, *, html: bool, concurrency: int = 2, min_delay_s: float = 0.0
    ) -> AsyncGenerator[float]:
        """Hold a request slot for `domain`; yields the delay that was applied."""
        state = self._state(domain)
        limit = self.effective_concurrency(html=html, concurrency=concurrency)
        delay = self.effective_delay(html=html, min_delay_s=min_delay_s)
        async with state.condition:

            def free() -> bool:
                if html:
                    return state.html_in_flight == 0 and state.json_in_flight == 0
                return state.html_in_flight == 0 and state.json_in_flight < limit

            await state.condition.wait_for(free)
            if html:
                state.html_in_flight += 1
            else:
                state.json_in_flight += 1
            now = self._clock.monotonic()
            spacing = delay + self._rng.uniform(0.0, JITTER_MAX_S)
            start_at = max(now, state.last_start + spacing)
            state.last_start = start_at
        waited = max(0.0, start_at - now)
        try:
            if waited > 0:
                await self._clock.sleep(waited)
            async with self._global:
                self.history.append(SlotRecord(domain, html, self._clock.monotonic(), waited))
                yield waited
        finally:
            async with state.condition:
                if html:
                    state.html_in_flight -= 1
                else:
                    state.json_in_flight -= 1
                state.condition.notify_all()
