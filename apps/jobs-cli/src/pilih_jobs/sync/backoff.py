"""Retry delays (20 §5.3): full jitter, `delay = random(0, min(cap, base · 2^attempts))`."""

from __future__ import annotations

import secrets
from collections.abc import Callable
from typing import Final

BASE_MS: Final = 1_000
CAP_MS: Final = 300_000

_system_random = secrets.SystemRandom()


def backoff_ceiling_ms(attempts: int, *, base_ms: int = BASE_MS, cap_ms: int = CAP_MS) -> int:
    """`min(cap, base · 2^attempts)` without overflowing for large attempt counts."""
    if attempts >= 32:
        return cap_ms
    return min(cap_ms, base_ms * (2 ** max(0, attempts)))


def full_jitter_ms(
    attempts: int,
    *,
    rng: Callable[[], float] = _system_random.random,
    base_ms: int = BASE_MS,
    cap_ms: int = CAP_MS,
) -> int:
    return int(rng() * backoff_ceiling_ms(attempts, base_ms=base_ms, cap_ms=cap_ms))


def retry_delay_ms(
    attempts: int,
    *,
    retry_after_s: float | None = None,
    rng: Callable[[], float] = _system_random.random,
) -> int:
    """Backoff for a retryable failure; a 429 waits at least `Retry-After`."""
    delay = full_jitter_ms(attempts, rng=rng)
    if retry_after_s is not None:
        delay = max(delay, int(retry_after_s * 1000))
    return delay
