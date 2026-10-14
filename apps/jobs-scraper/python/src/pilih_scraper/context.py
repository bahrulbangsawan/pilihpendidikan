"""Per-request run context: deadline, stats, warnings and the protocol log (24 §3)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Final, Literal

from pilih_scraper import logs

LOG_MAX: Final = 100
WARNINGS_MAX: Final = 50
MESSAGE_MAX: Final = 500
Level = Literal["info", "warn", "error"]

_log = logs.get_logger("run")


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Stats:
    pages: int = 0
    postings_found: int = 0
    duplicates: int = 0
    invalid: int = 0
    relocated: int = 0
    robots_skipped: int = 0
    details_fetched: int = 0
    fetch_mode: str | None = None

    def as_dict(self, elapsed_ms: int) -> dict[str, Any]:
        return {
            "pages": self.pages,
            "postings_found": self.postings_found,
            "duplicates": self.duplicates,
            "invalid": self.invalid,
            "relocated": self.relocated,
            "robots_skipped": self.robots_skipped,
            "details_fetched": self.details_fetched,
            "elapsed_ms": elapsed_ms,
            "fetch_mode": self.fetch_mode,
        }


@dataclass
class RunContext:
    """What one scrape / probe / directory request accumulates."""

    run_id: str | None
    deadline_ms: int
    started: float = field(default_factory=time.monotonic)
    stats: Stats = field(default_factory=Stats)
    log: list[dict[str, Any]] = field(default_factory=lambda: [])
    _warnings: dict[tuple[str, str | None], dict[str, Any]] = field(default_factory=lambda: {})
    _dropped_log: int = 0

    # ------------------------------------------------------------------ time
    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    def remaining_ms(self) -> int:
        return self.deadline_ms - self.elapsed_ms()

    def out_of_time(self, reserve_ms: int = 3000) -> bool:
        """True when less than `reserve_ms` is left (stop paging and answer)."""
        return self.remaining_ms() < reserve_ms

    # ------------------------------------------------------------------ log
    def add_log(
        self,
        level: Level,
        event: str,
        message: str,
        *,
        url: str | None = None,
        http_status: int | None = None,
        ms: int | None = None,
    ) -> None:
        logs.event(
            _log,
            event,
            level=40 if level == "error" else 30 if level == "warn" else 20,
            run_id=self.run_id,
            url=url,
            http_status=http_status,
            ms=ms,
            detail=message[:200],
        )
        if len(self.log) >= LOG_MAX - 1:
            self._dropped_log += 1
            return
        entry: dict[str, Any] = {
            "at": now_ms(),
            "level": level,
            "event": event[:64],
            "message": message[:MESSAGE_MAX],
        }
        if url:
            entry["url"] = url[:2048]
        if http_status is not None:
            entry["http_status"] = http_status
        if ms is not None:
            entry["ms"] = max(0, ms)
        self.log.append(entry)

    def final_log(self) -> list[dict[str, Any]]:
        if not self._dropped_log:
            return list(self.log)
        return [
            *self.log,
            {
                "at": now_ms(),
                "level": "warn",
                "event": "log_truncated",
                "message": f"{self._dropped_log} more log lines were dropped",
            },
        ]

    # ------------------------------------------------------------------ warnings
    def warn(self, code: str, message: str, *, field: str | None = None, count: int = 1) -> None:
        """Aggregates by (code, field): one warning per kind with a running count."""
        key = (code, field)
        existing = self._warnings.get(key)
        if existing is not None:
            existing["count"] = int(existing.get("count", 0)) + count
            return
        if len(self._warnings) >= WARNINGS_MAX:
            return
        entry: dict[str, Any] = {
            "code": code[:64],
            "message": message[:MESSAGE_MAX],
            "count": count,
        }
        if field:
            entry["field"] = field[:64]
        self._warnings[key] = entry

    def warnings(self) -> list[dict[str, Any]]:
        return list(self._warnings.values())
