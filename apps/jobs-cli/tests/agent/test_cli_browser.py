"""`pilih-jobs browser …` commands (16 §3.3) in-process."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from tests.support.helpers import CliResult


def test_browser_profiles_create_list_delete(cli: Callable[..., CliResult]) -> None:
    created = cli(
        "--json",
        "browser",
        "profiles",
        "create",
        "--name",
        "work-portals",
        "--domain",
        "myworkdayjobs.com",
    )
    assert created.code == 0, created.stderr
    assert created.json["data"]["profile"] == "apply-work-portals"
    listed = cli("--json", "browser", "profiles", "list")
    profiles: list[dict[str, Any]] = listed.json["data"]["profiles"]
    assert [p["profile"] for p in profiles] == ["apply-work-portals"]
    assert profiles[0]["domains_hint"] == ["myworkdayjobs.com"]
    deleted = cli("--json", "--yes", "browser", "profiles", "delete", "work-portals")
    assert deleted.json["data"]["deleted"] is True


def test_browser_launch_connected_prints_but_never_runs(cli: Callable[..., CliResult]) -> None:
    result = cli("--json", "browser", "launch", "--mode", "connected", "--port", "9333")
    data = result.json["data"]
    assert result.code == 0
    assert "--remote-debugging-port=9333" in data["command"]
    assert "--remote-debugging-address=127.0.0.1" in data["command"]
    assert "remote-allow-origins" not in data["command"]
    assert "Close it when you are done" in data["warning"]


def test_T18_U_CDP_connect_refuses_non_loopback_cli(cli: Callable[..., CliResult]) -> None:
    result = cli("--json", "browser", "connect", "--cdp", "http://10.0.0.5:9222")
    assert result.code == 9
    assert result.json["error"]["code"] == "cdp_non_loopback"


def test_browser_status_reports_profiles_and_config(cli: Callable[..., CliResult]) -> None:
    cli("--json", "browser", "profiles", "create", "discovery")
    result = cli("--json", "browser", "status")
    data = result.json["data"]
    assert data["mode"] == "managed"
    assert data["channel"] == "chromium"
    assert any(
        p["profile"] == "discovery" and p["purpose"] == "discovery" for p in data["profiles"]
    )


def test_browser_login_needs_a_terminal(cli: Callable[..., CliResult]) -> None:
    result = cli("--json", "browser", "login", "work")
    assert result.code == 8
