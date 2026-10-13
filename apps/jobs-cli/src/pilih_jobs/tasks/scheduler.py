"""Local discovery schedules (16 §7 Scheduler): sources with a `schedule` hint.

Supported hints (`job_sources.schedule`, evaluated in the local timezone):

- `hourly` — at most once per hour;
- `daily@HH:MM` — once a day, at or after HH:MM;
- `weekly@<mon|tue|…>@HH:MM` — once a week;
- `every@<N>h` / `every@<N>m` — fixed interval (minimum 15 minutes).

The last local run per source is kept in `kv` (`schedule:last:<src_id>`); a source is due
when the most recent scheduled instant is after its last run. Unknown hints are ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final, Literal, cast

from pilih_jobs.storage.db import StateDB

_DAILY = re.compile(r"^daily@([01]\d|2[0-3]):([0-5]\d)$")
_WEEKLY = re.compile(r"^weekly@(mon|tue|wed|thu|fri|sat|sun)@([01]\d|2[0-3]):([0-5]\d)$")
_EVERY = re.compile(r"^every@(\d{1,4})([hm])$")
WEEKDAYS: Final = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
MIN_EVERY_MS: Final = 15 * 60_000


@dataclass(frozen=True)
class Schedule:
    kind: Literal["hourly", "daily", "weekly", "every"]
    hour: int = 0
    minute: int = 0
    weekday: int = 0
    every_ms: int = 0


def parse_schedule(text: str | None) -> Schedule | None:
    if not text:
        return None
    value = text.strip().lower()
    if value == "hourly":
        return Schedule("hourly")
    if match := _DAILY.match(value):
        return Schedule("daily", hour=int(match.group(1)), minute=int(match.group(2)))
    if match := _WEEKLY.match(value):
        return Schedule(
            "weekly",
            weekday=WEEKDAYS.index(match.group(1)),
            hour=int(match.group(2)),
            minute=int(match.group(3)),
        )
    if match := _EVERY.match(value):
        amount = int(match.group(1)) * (3_600_000 if match.group(2) == "h" else 60_000)
        return Schedule("every", every_ms=max(MIN_EVERY_MS, amount))
    return None


def _local(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000).astimezone()


def last_slot_ms(schedule: Schedule, now_ms: int) -> int:
    """The most recent scheduled instant at or before `now_ms` (local time)."""
    now = _local(now_ms)
    if schedule.kind == "hourly":
        slot = now.replace(minute=0, second=0, microsecond=0)
    elif schedule.kind == "daily":
        slot = now.replace(hour=schedule.hour, minute=schedule.minute, second=0, microsecond=0)
        if slot > now:
            slot -= timedelta(days=1)
    elif schedule.kind == "weekly":
        slot = now.replace(hour=schedule.hour, minute=schedule.minute, second=0, microsecond=0)
        slot -= timedelta(days=(now.weekday() - schedule.weekday) % 7)
        if slot > now:
            slot -= timedelta(days=7)
    else:
        return now_ms - (now_ms % schedule.every_ms)
    return int(slot.timestamp() * 1000)


def is_due(schedule: Schedule, last_run_ms: int | None, now_ms: int) -> bool:
    if last_run_ms is None:
        return True
    if schedule.kind == "every":
        return now_ms - last_run_ms >= schedule.every_ms
    return last_run_ms < last_slot_ms(schedule, now_ms)


def _kv_key(source_id: str) -> str:
    return f"schedule:last:{source_id}"


def last_run(db: StateDB, source_id: str) -> int | None:
    value = db.kv_get(_kv_key(source_id))
    return int(value) if value and value.isdigit() else None


def mark_run(db: StateDB, source_id: str, at_ms: int) -> None:
    db.kv_set(_kv_key(source_id), str(at_ms))


def due_sources(db: StateDB, sources: list[dict[str, Any]], now_ms: int) -> list[str]:
    """Enabled sources whose schedule hint is due (oldest first)."""
    due: list[tuple[int, str]] = []
    for source in sources:
        if not source.get("enabled"):
            continue
        schedule = parse_schedule(cast(str | None, source.get("schedule")))
        source_id = source.get("id")
        if schedule is None or not isinstance(source_id, str):
            continue
        previous = last_run(db, source_id)
        if is_due(schedule, previous, now_ms):
            due.append((previous or 0, source_id))
    return [source_id for _, source_id in sorted(due)]
