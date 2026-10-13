"""Wrapper-owned retry policy (15 §7.2).

Scrapling's HTTP fetchers retry with a fixed delay, so every Scrapling call gets
`retries=0` (browser: one attempt) and this policy decides::

    delay(attempt) = min(cap, base * 2^(attempt-1)) * uniform(0.8, 1.2)
    base = 2 s, cap = 120 s, max_attempts = 4 (network/timeout/5xx), 3 (429)
    429/503 with Retry-After → wait max(Retry-After, delay(attempt)), cap 15 min;
    beyond the cap → stop the source (rate_limited)

Only the classes marked retryable in 15 §8 are retried; `access_denied` and
`challenge_detected` never are (D-16: a denial is not a reason to try harder).
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Final

from pilih_jobs.discovery.errors import DiscoveryError

RETRY_AFTER_CAP_S: Final = 15 * 60.0


@dataclass(frozen=True)
class RetryDecision:
    retry: bool
    wait_s: float = 0.0
    #: Set when the failure must stop the whole source (Retry-After beyond the cap).
    stop_source: bool = False


@dataclass(frozen=True)
class RetryPolicy:
    base_s: float = 2.0
    cap_s: float = 120.0
    max_attempts: int = 4
    max_attempts_rate_limited: int = 3
    retry_after_cap_s: float = RETRY_AFTER_CAP_S
    jitter_low: float = 0.8
    jitter_high: float = 1.2

    def delay(self, attempt: int, rng: random.Random) -> float:
        """Backoff before attempt `attempt + 1` (attempt counts from 1)."""
        exponent = max(0, attempt - 1)
        raw = min(self.cap_s, self.base_s * (2**exponent))
        return raw * rng.uniform(self.jitter_low, self.jitter_high)

    def attempts_for(self, error: DiscoveryError) -> int:
        if error.error_class == "rate_limited":
            return self.max_attempts_rate_limited
        return self.max_attempts

    def decide(self, error: DiscoveryError, attempt: int, rng: random.Random) -> RetryDecision:
        """What to do after attempt number `attempt` failed with `error`."""
        if not error.retryable:
            return RetryDecision(retry=False)
        too_long = error.retry_after_s is not None and error.retry_after_s > self.retry_after_cap_s
        if error.error_class == "rate_limited" and too_long:
            return RetryDecision(retry=False, stop_source=True)
        if attempt >= self.attempts_for(error):
            return RetryDecision(retry=False)
        wait = self.delay(attempt, rng)
        if error.retry_after_s is not None:
            wait = max(error.retry_after_s, wait)
        return RetryDecision(retry=True, wait_s=min(wait, self.retry_after_cap_s))


def parse_retry_after(value: str | None, *, now_s: float) -> float | None:
    """`Retry-After` as seconds: delta-seconds or an HTTP-date (RFC 9110 §10.2.3)."""
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    if text.isdigit():
        return float(text)
    try:
        moment = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        return None
    return max(0.0, moment.timestamp() - now_s)
