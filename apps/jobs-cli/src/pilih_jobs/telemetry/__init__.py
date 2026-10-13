"""Opt-in anonymous telemetry, crash reports (22 §8).

Telemetry is **off by default** (`privacy.telemetry = false`). When on, the CLI keeps
daily counters in `<data>/telemetry.json` and sends completed days to
`POST /api/v1/telemetry` (unauthenticated) with a random install id that rotates every
30 days:

| Sent (aggregated, anonymous)                    | Never sent                                   |
|-------------------------------------------------|----------------------------------------------|
| CLI/Python versions, OS, arch, install channel  | email, user id, device name, IP              |
| command name, duration bucket, exit code        | arguments, URLs, company names, job titles   |
| adapter id + error_class counts                 | page content, form fields, answers, CV, tokens|
| agent step counts, outcome class (no ids)       | screenshots, DOM, cookies, hostnames, paths  |

Unhandled exceptions always write `<logs>/crash-<ts>.json` (exception type, redacted
message, frames as package-relative file + line + function; no locals). With telemetry
on, an interactive session is asked before a report is posted to
`POST /api/v1/telemetry/crash`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import secrets
import time
import traceback
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final, cast

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiError, NetworkError
from pilih_jobs.environment import detect_installer
from pilih_jobs.logging import redact_text
from pilih_jobs.paths import Paths, ensure_private_dir
from pilih_jobs.version import __version__, arch, device_platform, python_version

INSTALL_ID_ROTATION_MS: Final = 30 * 24 * 3600 * 1000
MAX_DAYS_KEPT: Final = 30
_ABSOLUTE_PATH = re.compile(r"(?:[A-Za-z]:\\|/)(?:[^\s'\"]+[/\\])+[^\s'\"]*")
_PACKAGE_MARKERS: Final = ("site-packages/", "dist-packages/", "/src/", "/lib/python")


def duration_bucket(seconds: float) -> str:
    if seconds < 1:
        return "<1s"
    if seconds < 10:
        return "1-10s"
    if seconds < 60:
        return "10-60s"
    if seconds < 600:
        return "1-10m"
    return ">10m"


def _day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=UTC).strftime("%Y-%m-%d")


def _empty_counters() -> dict[str, Any]:
    return {
        "commands": {},
        "error_classes": {},
        "exit_codes": {},
        "duration_buckets": {},
        "agent_steps": 0,
        "outcomes": {},
    }


class Telemetry:
    def __init__(
        self,
        paths: Paths,
        *,
        enabled: bool,
        now_ms: Callable[[], int] = lambda: time.time_ns() // 1_000_000,
    ) -> None:
        self.paths = paths
        self.enabled = enabled
        self._now = now_ms

    @property
    def file(self) -> Path:
        return self.paths.telemetry_file

    def _load(self) -> dict[str, Any]:
        try:
            data = cast(dict[str, Any], json.loads(self.file.read_text("utf-8")))
        except (OSError, json.JSONDecodeError):
            data = {}
        data.setdefault("days", {})
        return data

    def _save(self, data: dict[str, Any]) -> None:
        ensure_private_dir(self.file.parent)
        days = cast(dict[str, Any], data["days"])
        for day in sorted(days)[:-MAX_DAYS_KEPT]:
            del days[day]
        tmp = self.file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")
        if os.name == "posix":
            tmp.chmod(0o600)
        tmp.replace(self.file)

    # ------------------------------------------------------------------ install id
    def install_hash(self) -> str:
        """A random id, rotated every 30 days; never derived from the machine or user."""
        data = self._load()
        now = self._now()
        created = data.get("install_created_at")
        if (
            not isinstance(data.get("install_id"), str)
            or not isinstance(created, int)
            or now - created > INSTALL_ID_ROTATION_MS
        ):
            data["install_id"] = secrets.token_hex(16)
            data["install_created_at"] = now
            self._save(data)
        return str(data["install_id"])

    def was_prompted(self) -> bool:
        return bool(self._load().get("prompted"))

    def mark_prompted(self) -> None:
        data = self._load()
        data["prompted"] = True
        self._save(data)

    # ------------------------------------------------------------------ counters
    def _bump(self, update: Callable[[dict[str, Any]], None]) -> None:
        if not self.enabled:
            return
        data = self._load()
        days = cast(dict[str, Any], data["days"])
        counters = cast(dict[str, Any], days.setdefault(_day(self._now()), _empty_counters()))
        update(counters)
        self._save(data)

    def record_command(self, command: str, duration_s: float, exit_code: int) -> None:
        name = " ".join(part for part in command.split() if re.fullmatch(r"[a-z][a-z0-9-]*", part))

        def update(c: dict[str, Any]) -> None:
            for key, bucket in (
                ("commands", name or "unknown"),
                ("exit_codes", str(exit_code)),
                ("duration_buckets", duration_bucket(duration_s)),
            ):
                table = cast(dict[str, int], c.setdefault(key, {}))
                table[bucket] = table.get(bucket, 0) + 1

        self._bump(update)

    def record_error_class(self, adapter_id: str, error_class: str, count: int = 1) -> None:
        def update(c: dict[str, Any]) -> None:
            table = cast(dict[str, int], c.setdefault("error_classes", {}))
            key = f"{adapter_id}:{error_class}"
            table[key] = table.get(key, 0) + count

        self._bump(update)

    def record_agent(self, steps: int, outcome: str) -> None:
        def update(c: dict[str, Any]) -> None:
            c["agent_steps"] = int(c.get("agent_steps", 0)) + steps
            table = cast(dict[str, int], c.setdefault("outcomes", {}))
            table[outcome] = table.get(outcome, 0) + 1

        self._bump(update)

    def payloads(self, *, include_today: bool = False) -> list[dict[str, Any]]:
        """`TelemetryRequest` bodies for completed days (no user, device or path data)."""
        data = self._load()
        today = _day(self._now())
        install = self.install_hash()
        out: list[dict[str, Any]] = []
        for day, counters in sorted(cast(dict[str, Any], data["days"]).items()):
            if day == today and not include_today:
                continue
            out.append(
                {
                    "day": day,
                    "install_hash": install,
                    "cli_version": __version__,
                    "platform": device_platform(),
                    "arch": arch(),
                    "python_version": python_version(),
                    "install_channel": detect_installer(),
                    "counters": counters,
                }
            )
        return out

    async def flush(self, client: ApiClient) -> int:
        """Send completed days; returns how many were accepted. No-op when disabled."""
        if not self.enabled:
            return 0
        sent = 0
        for payload in self.payloads():
            try:
                await client.request("POST", "/api/v1/telemetry", json_body=payload, auth=False)
            except (ApiError, NetworkError):
                break
            data = self._load()
            cast(dict[str, Any], data["days"]).pop(payload["day"], None)
            self._save(data)
            sent += 1
        return sent


# ------------------------------------------------------------------ crash reports
def _relative_file(filename: str) -> str:
    normalized = filename.replace("\\", "/")
    for marker in _PACKAGE_MARKERS:
        if marker in normalized:
            return normalized.rsplit(marker, 1)[1].lstrip("/")
    return Path(normalized).name


def crash_payload(exc: BaseException, *, install_hash: str, now_ms: int) -> dict[str, Any]:
    """`CrashReportRequest`: frames with package-relative file and line only, no locals."""
    frames = [
        {
            "file": _relative_file(frame.filename)[:300],
            "line": frame.lineno or 0,
            "function": frame.name[:200],
        }
        for frame in traceback.extract_tb(exc.__traceback__)
    ][-100:]
    message = _ABSOLUTE_PATH.sub("<path>", redact_text(str(exc)))[:500]
    return {
        "install_hash": install_hash,
        "cli_version": __version__,
        "platform": device_platform(),
        "python_version": python_version(),
        "occurred_at": now_ms,
        "exception_type": type(exc).__name__[:200],
        "message": message,
        "frames": frames,
    }


def write_crash_report(paths: Paths, exc: BaseException) -> Path | None:
    """`<logs>/crash-<ts>.json` (0600). Returns the path, or None when it cannot be written."""
    now = time.time_ns() // 1_000_000
    payload = crash_payload(exc, install_hash="local-only", now_ms=now)
    try:
        ensure_private_dir(paths.log_dir)
        path = paths.log_dir / f"crash-{now}.json"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
    except OSError:
        return None
    return path


async def send_crash_report(client: ApiClient, path: Path, telemetry: Telemetry) -> bool:
    try:
        payload = cast(dict[str, Any], json.loads(await asyncio.to_thread(path.read_text, "utf-8")))
    except (OSError, json.JSONDecodeError):
        return False
    payload["install_hash"] = telemetry.install_hash()
    try:
        await client.request("POST", "/api/v1/telemetry/crash", json_body=payload, auth=False)
    except (ApiError, NetworkError):
        return False
    with contextlib.suppress(OSError):
        path.with_suffix(".sent").write_text("", encoding="utf-8")
    return True
