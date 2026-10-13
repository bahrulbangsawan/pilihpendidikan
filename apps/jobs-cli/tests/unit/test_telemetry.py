"""TCLI-TELEMETRY: opt-in counters, rotating install id, crash reports (22 §8)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import pytest

from pilih_jobs.api.client import ApiClient
from pilih_jobs.contracts.index import model
from pilih_jobs.paths import resolve_paths
from pilih_jobs.telemetry import (
    INSTALL_ID_ROTATION_MS,
    Telemetry,
    crash_payload,
    duration_bucket,
    send_crash_report,
    write_crash_report,
)
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult

DAY = 86_400_000


class Clock:
    def __init__(self, now: int) -> None:
        self.now = now

    def __call__(self) -> int:
        return self.now


def test_TCLI_TELEMETRY_off_by_default_records_nothing(home: Path) -> None:
    telemetry = Telemetry(resolve_paths(), enabled=False)
    telemetry.record_command("sync", 0.5, 0)
    telemetry.record_error_class("greenhouse", "schema_invalid")
    assert not resolve_paths().telemetry_file.exists()


def test_TCLI_TELEMETRY_counters_are_anonymous_and_contract_valid(home: Path) -> None:
    clock = Clock(1_791_770_000_000)
    telemetry = Telemetry(resolve_paths(), enabled=True, now_ms=clock)
    telemetry.record_command("config set", 0.2, 0)
    telemetry.record_command("sync --force https://secret.example/x", 75, 7)  # arguments never kept
    telemetry.record_error_class("greenhouse", "schema_invalid", 2)
    telemetry.record_agent(41, "submitted")
    clock.now += DAY
    payloads = telemetry.payloads()
    assert len(payloads) == 1
    body = payloads[0]
    model("TelemetryRequest").model_validate(body)
    counters = body["counters"]
    assert counters["commands"] == {"config set": 1, "sync": 1}
    assert counters["exit_codes"] == {"0": 1, "7": 1}
    assert counters["duration_buckets"] == {"<1s": 1, "1-10m": 1}
    assert counters["error_classes"] == {"greenhouse:schema_invalid": 2}
    assert counters["agent_steps"] == 41
    assert counters["outcomes"] == {"submitted": 1}
    text = json.dumps(body)
    for forbidden in ("secret.example", "rahma", "usr_", "dev_", str(home)):
        assert forbidden not in text


def test_TCLI_TELEMETRY_install_id_rotates_every_30_days(home: Path) -> None:
    clock = Clock(1_791_770_000_000)
    telemetry = Telemetry(resolve_paths(), enabled=True, now_ms=clock)
    first = telemetry.install_hash()
    assert telemetry.install_hash() == first
    assert len(first) == 32
    clock.now += INSTALL_ID_ROTATION_MS + 1
    assert telemetry.install_hash() != first


@pytest.mark.parametrize(
    ("seconds", "bucket"),
    [(0.1, "<1s"), (3, "1-10s"), (30, "10-60s"), (120, "1-10m"), (3600, ">10m")],
)
def test_TCLI_TELEMETRY_duration_buckets(seconds: float, bucket: str) -> None:
    assert duration_bucket(seconds) == bucket


async def test_TCLI_TELEMETRY_flush_posts_completed_days_unauthenticated(
    home: Path, fake_api: FakeApi
) -> None:
    clock = Clock(1_791_770_000_000)
    telemetry = Telemetry(resolve_paths(), enabled=True, now_ms=clock)
    telemetry.record_command("status", 0.1, 0)
    async with ApiClient(fake_api.issuer, transport=fake_api.transport) as client:
        assert await telemetry.flush(client) == 0  # today is not complete yet
        clock.now += DAY
        assert await telemetry.flush(client) == 1
    assert len(fake_api.telemetry) == 1
    assert "authorization" not in fake_api.request_headers[-1]
    assert telemetry.payloads() == []


async def test_TCLI_TELEMETRY_crash_reports_are_redacted_and_local_first(
    home: Path, fake_api: FakeApi
) -> None:
    paths = resolve_paths()
    try:
        raise ValueError("cannot open /Users/rahma/cv.pdf for rahma@example.com token=abcDEF123456")
    except ValueError as exc:
        path = write_crash_report(paths, exc)
        payload = crash_payload(exc, install_hash="x" * 32, now_ms=1)
    assert path is not None
    assert path.parent == paths.log_dir
    stored = json.loads(path.read_text())
    assert "rahma@example.com" not in stored["message"]
    assert "/Users/rahma" not in stored["message"]
    assert stored["frames"]
    assert all(set(f) == {"file", "line", "function"} for f in stored["frames"])
    assert "locals" not in json.dumps(stored)
    model("CrashReportRequest").model_validate(payload)
    async with ApiClient(fake_api.issuer, transport=fake_api.transport) as client:
        assert await send_crash_report(client, path, Telemetry(paths, enabled=True))
    assert fake_api.crash_reports[0]["exception_type"] == "ValueError"


def test_TCLI_TELEMETRY_commands_record_when_enabled(
    cli: Callable[..., CliResult], home: Path
) -> None:
    assert cli("config", "set", "privacy.telemetry", "true").code == 0
    assert cli("--json", "version").code == 0
    data = json.loads((home / "data" / "telemetry.json").read_text())
    counters = next(iter(data["days"].values()))
    assert counters["commands"]["version"] == 1
    assert counters["exit_codes"]["0"] >= 1


def test_TCLI_TELEMETRY_first_interactive_run_asks_once(
    cli: Callable[..., CliResult], home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import typer

    from pilih_jobs.cli.context import CliState

    asked: list[str] = []
    monkeypatch.setattr(CliState, "interactive", property(lambda self: not self.json))
    monkeypatch.setattr(typer, "confirm", lambda text, default=False: asked.append(text) or True)
    assert cli("version").code == 0
    assert len(asked) == 1
    assert "anonymous usage counters" in asked[0]
    assert cli("config", "get", "privacy.telemetry").stdout.strip() == "true"
    assert cli("version").code == 0
    assert len(asked) == 1  # asked once


def test_TCLI_TELEMETRY_crash_report_is_offered_only_with_telemetry_on(
    cli: Callable[..., CliResult], home: Path, monkeypatch: pytest.MonkeyPatch, fake_api: FakeApi
) -> None:
    import typer

    import pilih_jobs.cli.system as system
    from pilih_jobs.cli.context import CliState

    def boom() -> dict[str, object]:
        raise RuntimeError("kaput")

    asked: list[str] = []
    monkeypatch.setattr(system, "version_info", boom)
    monkeypatch.setattr(CliState, "interactive", property(lambda self: True))
    monkeypatch.setattr(typer, "confirm", lambda text, default=False: asked.append(text) or True)
    assert cli("config", "set", "privacy.telemetry", "false").code == 0
    assert cli("version").code == 1
    assert "Send crash report?" not in asked
    assert fake_api.crash_reports == []
    assert cli("config", "set", "privacy.telemetry", "true").code == 0
    assert cli("version").code == 1
    assert "Send crash report?" in asked
    assert fake_api.crash_reports[0]["exception_type"] == "RuntimeError"
