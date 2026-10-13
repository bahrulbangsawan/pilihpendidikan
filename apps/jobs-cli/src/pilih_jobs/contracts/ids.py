"""Prefixed ULID identifiers (03 §1, PLAN C2) — the Python mirror of `src/ids.ts`.

Format: `<prefix>_<ULID>`; the ULID is 26 Crockford base32 characters (10 of
big-endian millisecond time, first character 0-7, then 16 random). The CLI generates
ids only for client-originated records (`evt_`, `run_`, `att_` step logs, outbox keys);
the server accepts them when their time is within ±24 h of its clock, so ids use the
**server-corrected** time (20 §9): `pilih_jobs.clock.ClockSync` installs itself as the
time source with `set_time_source`.
"""

from __future__ import annotations

import re
import secrets
import time
from collections.abc import Callable
from typing import Final

ID_PREFIXES: Final = (
    "usr_",
    "pst_",
    "ujb_",
    "app_",
    "evt_",
    "ivw_",
    "ofr_",
    "scr_",
    "rul_",
    "dev_",
    "grt_",
    "rft_",
    "tsk_",
    "att_",
    "lse_",
    "apr_",
    "evd_",
    "fil_",
    "cvv_",
    "run_",
    "src_",
    "fct_",
    "ans_",
    "eml_",
    "sal_",
    "obs_",
)

CROCKFORD_ALPHABET: Final = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID_MAX_TIME_MS: Final = 281_474_976_710_655
ID_MAX_CLOCK_SKEW_MS: Final = 86_400_000
_TIME_LENGTH: Final = 10
_RANDOM_LENGTH: Final = 16
_ULID_RE = re.compile(r"^[0-7][0-9A-HJKMNP-TV-Z]{25}$")
_PREFIXED_ID_RE = re.compile(r"^([a-z]{3})_([0-7][0-9A-HJKMNP-TV-Z]{25})$")


def _wall_clock_ms() -> int:
    return time.time_ns() // 1_000_000


_time_source: Callable[[], int] = _wall_clock_ms


def set_time_source(source: Callable[[], int] | None) -> None:
    """Install the corrected clock used by `new_id()` (None restores the wall clock)."""
    global _time_source
    _time_source = source or _wall_clock_ms


def now_ms() -> int:
    """Current time in epoch milliseconds from the installed (corrected) source."""
    return _time_source()


def _to_prefix(prefix: str) -> str:
    full = prefix if prefix.endswith("_") else f"{prefix}_"
    if full not in ID_PREFIXES:
        raise ValueError(f'Unknown id prefix "{prefix}"')
    return full


def encode_ulid_time(ms: int) -> str:
    if ms < 0 or ms > ULID_MAX_TIME_MS:
        raise ValueError(f"ULID time out of range: {ms}")
    out: list[str] = []
    rest = ms
    for _ in range(_TIME_LENGTH):
        rest, digit = divmod(rest, 32)
        out.append(CROCKFORD_ALPHABET[digit])
    return "".join(reversed(out))


def decode_ulid_time(ulid: str) -> int | None:
    if not _ULID_RE.match(ulid):
        return None
    ms = 0
    for char in ulid[:_TIME_LENGTH]:
        ms = ms * 32 + CROCKFORD_ALPHABET.index(char)
    return ms


def new_ulid(now: int | None = None) -> str:
    stamp = now_ms() if now is None else now
    # 256 is a multiple of 32, so byte % 32 is uniform.
    random_part = "".join(CROCKFORD_ALPHABET[b % 32] for b in secrets.token_bytes(_RANDOM_LENGTH))
    return encode_ulid_time(stamp) + random_part


def new_id(prefix: str, now: int | None = None) -> str:
    """A new prefixed id, e.g. `new_id("evt")` → `evt_01JA6V8M3W8Z1T6Q4Y2B7K9C0D`."""
    return _to_prefix(prefix) + new_ulid(now)


def is_id(prefix: str, value: object) -> bool:
    if not isinstance(value, str):
        return False
    full = _to_prefix(prefix)
    return value.startswith(full) and _ULID_RE.match(value[len(full) :]) is not None


def id_prefix_of(value: str) -> str | None:
    match = _PREFIXED_ID_RE.match(value)
    if match is None:
        return None
    prefix = f"{match.group(1)}_"
    return prefix if prefix in ID_PREFIXES else None


def id_timestamp(value: str) -> int | None:
    match = _PREFIXED_ID_RE.match(value)
    if match is not None:
        return decode_ulid_time(match.group(2)) if id_prefix_of(value) else None
    return decode_ulid_time(value)


def is_id_within_clock_skew(value: str, now: int, max_skew_ms: int = ID_MAX_CLOCK_SKEW_MS) -> bool:
    stamp = id_timestamp(value)
    return stamp is not None and abs(stamp - now) <= max_skew_ms


def id_pattern(prefix: str) -> re.Pattern[str]:
    return re.compile(rf"^{_to_prefix(prefix)}[0-7][0-9A-HJKMNP-TV-Z]{{25}}$")
