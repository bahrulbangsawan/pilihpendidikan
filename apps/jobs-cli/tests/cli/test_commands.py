"""This leaf's commands end to end in-process: config, sync, status, devices, version,
doctor, update, uninstall (16 §3.3) — against the fake API."""

from __future__ import annotations

import json
import sys
import tomllib
from collections.abc import Callable
from pathlib import Path

import pytest

from pilih_jobs.cli import system
from pilih_jobs.contracts import ids
from pilih_jobs.runtime import Runtime
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.outbox import Outbox
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult

Cli = Callable[..., CliResult]


def _db(home: Path) -> StateDB:
    return StateDB(home / "data" / "state.db")


# ---------------------------------------------------------------------------- config
def test_T16_UNIT_config_commands(cli: Cli, home: Path) -> None:
    assert (
        cli("--json", "config", "set", "browser.mode", "connected").json["data"]["value"]
        == "connected"
    )
    got = cli("--json", "config", "get", "browser.mode").json["data"]
    assert got == {"key": "browser.mode", "value": "connected", "source": "file"}
    listed = cli("--json", "config", "list").json["data"]["items"]
    assert {i["key"] for i in listed} >= {"api.url", "privacy.telemetry", "credentials.store"}
    path = cli("--json", "config", "path").json["data"]
    assert path["config_file"] == str(home / "config" / "config.toml")
    assert (
        tomllib.loads((home / "config" / "config.toml").read_text())["browser"]["mode"]
        == "connected"
    )
    assert cli("--json", "config", "set", "browser.nope", "1").code == 2
    assert cli("--json", "config", "unset", "browser.mode").json["data"]["removed"] is True
    human = cli("config", "get", "browser.mode")
    assert human.stdout.strip() == "managed"


def test_T16_UNIT_flag_beats_env_beats_file(cli: Cli, monkeypatch: pytest.MonkeyPatch) -> None:
    cli("config", "set", "api.url", "http://127.0.0.1:9000")
    monkeypatch.setenv("PILIH_JOBS_API_URL", "http://127.0.0.1:9100")
    assert (
        cli("--json", "config", "get", "api.url").json["data"]["value"] == "http://127.0.0.1:9100"
    )
    flagged = cli("--json", "--api-url", "http://127.0.0.1:9200", "config", "get", "api.url").json[
        "data"
    ]
    assert flagged == {"key": "api.url", "value": "http://127.0.0.1:9200", "source": "flag"}
    bad = cli("--json", "--api-url", "http://evil.example", "config", "get", "api.url")
    assert bad.code == 2
    assert bad.json["error"]["code"] == "invalid_config"


def test_T16_UNIT_config_purge_keeps_the_outbox(cli: Cli, home: Path) -> None:
    (home / "cache").mkdir(parents=True)
    (home / "cache" / "blob.bin").write_bytes(b"x")
    staging = home / "data" / "runs" / "att_01JA6V8M3W8Z1T6Q4Y2B7K9C00" / "staging"
    staging.mkdir(parents=True)
    (staging / "cv.pdf").write_bytes(b"%PDF")
    profile = home / "data" / "browser-profiles" / "default"
    profile.mkdir(parents=True)
    db = _db(home)
    Outbox(db, "https://api.test").enqueue("POST", "/api/v1/inbox:bulk", {"x": 1}, ordering_key="k")
    db.close()
    result = cli("--json", "--yes", "config", "purge")
    assert result.code == 0
    deleted = result.json["data"]["deleted"]
    assert str(home / "cache" / "blob.bin") in deleted
    assert str(staging) in deleted
    assert profile.exists()  # only with --profiles
    assert cli("--json", "--yes", "config", "purge", "--profiles").code == 0
    assert not profile.exists()
    db = _db(home)
    assert len(Outbox(db, "https://api.test").entries()) == 1
    db.close()


# ---------------------------------------------------------------------------- sync
def test_T16_UNIT_sync_pushes_pulls_and_reports(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str, home: Path
) -> None:
    app = fake_api.new_application(user_id)
    db = _db(home)
    Outbox(db, fake_api.issuer).enqueue(
        "POST",
        f"/api/v1/applications/{app['id']}/move",
        {"base_revision": 1, "stage": "applied"},
        ordering_key=f"app:{app['id']}",
        kind="conditional",
    )
    db.close()
    result = cli_signed_in("--json", "sync")
    assert result.code == 0, result.stdout + result.stderr
    data = result.json["data"]
    assert data["pushed"] == 1
    assert data["outbox_depth"] == 0
    assert data["cursor"] >= 2
    assert fake_api.application(app["id"])["stage"] == "applied"
    status = cli_signed_in("--json", "sync", "--status").json["data"]
    assert status["outbox"]["done"] == 1
    assert status["problems"] == []
    assert cli_signed_in("--json", "sync", "--push-only", "--pull-only").code == 2


def test_T16_UNIT_sync_status_works_offline_and_dead_letter_tools(
    cli_signed_in: Cli, fake_api: FakeApi, user_id: str, home: Path
) -> None:
    app = fake_api.new_application(user_id)
    fake_api.web_move(app["id"], "preparing")
    db = _db(home)
    entry = Outbox(db, fake_api.issuer).enqueue(
        "POST",
        f"/api/v1/applications/{app['id']}/move",
        {"base_revision": 1, "stage": "withdrawn"},
        ordering_key=f"app:{app['id']}",
        kind="conditional",
    )
    db.close()
    assert cli_signed_in("--json", "sync").json["data"]["conflicts"] == 1
    fake_api.offline = True
    status = cli_signed_in("--json", "sync", "--status").json["data"]
    assert status["outbox"]["conflict"] == 1
    assert status["problems"][0]["id"] == entry.id
    shown = cli_signed_in("--json", "sync", "--show", str(entry.id)).json["data"]
    assert shown["body"] == {"base_revision": 1, "stage": "withdrawn"}
    offline = cli_signed_in("--json", "sync")
    assert offline.code == 7
    assert offline.json["error"]["details"]["queued"] == 1
    fake_api.offline = False
    retried = cli_signed_in("--json", "--yes", "sync", "--retry", str(entry.id)).json["data"]
    assert retried["retried"] is True
    assert retried["entry"]["state"] == "pending"
    assert cli_signed_in("--json", "sync").json["data"]["pushed"] == 1
    assert fake_api.application(app["id"])["stage"] == "withdrawn"
    other = cli_signed_in("--json", "--yes", "sync", "--discard", str(entry.id))
    assert other.code == 0
    assert other.json["data"]["discarded"] == entry.id
    assert cli_signed_in("--json", "sync", "--show", "999").code == 5


def test_T16_UNIT_sync_without_login_exits_3(cli: Cli) -> None:
    result = cli("--json", "sync")
    assert result.code == 3
    assert result.json["error"]["code"] == "not_authenticated"


def test_TCLI_426_sync_exits_10_when_the_server_requires_an_upgrade(
    cli_signed_in: Cli, fake_api: FakeApi
) -> None:
    fake_api.min_cli_version = "99.0.0"
    result = cli_signed_in("--json", "sync")
    assert result.code == 10
    assert result.json["error"]["code"] == "cli_upgrade_required"
    assert cli_signed_in("--json", "version").code == 0  # exempt from the gate


# ---------------------------------------------------------------------------- status / whoami
def test_T16_UNIT_status_overview(cli_signed_in: Cli, fake_api: FakeApi, user_id: str) -> None:
    approval = {"id": ids.new_id("apr"), "revision": 1, "state": "pending"}
    fake_api.put_entity("approval", approval, user_id)
    data = cli_signed_in("--json", "status").json["data"]
    assert data["auth"]["signed_in"]
    assert data["auth"]["email"] == "rahma@example.com"
    assert data["device"]["id"].startswith("dev_")
    assert data["worker"] == {"running": False}
    assert data["approvals_pending"] == 1
    assert data["offline"] is None
    assert set(data) >= {
        "auth",
        "device",
        "worker",
        "outbox",
        "browser",
        "last_sync_at",
        "approvals_pending",
    }
    fake_api.offline = True
    offline = cli_signed_in("--json", "status").json["data"]
    assert offline["offline"].startswith("offline")
    assert offline["approvals_pending"] == 1
    human = cli_signed_in("status")
    assert "rahma@example.com" in human.stdout


def test_T16_UNIT_status_and_whoami_signed_out(cli: Cli) -> None:
    data = cli("--json", "status").json["data"]
    assert data["auth"]["signed_in"] is False
    assert data["offline"] == "not signed in"
    assert cli("--json", "whoami", "--cached").code == 3


def test_T16_UNIT_personal_token_for_read_only_commands(
    cli: Cli, fake_api: FakeApi, user_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PILIH_JOBS_TOKEN", fake_api.personal_token(user_id))
    data = cli("--json", "whoami").json["data"]
    assert data["user_id"] == user_id
    assert data["credential_kind"] == "personal_read"
    assert data["device"] is None


# ---------------------------------------------------------------------------- devices
def test_T16_UNIT_devices_rename_and_revoke(
    cli_signed_in: Cli, fake_api: FakeApi, home: Path
) -> None:
    items = cli_signed_in("--json", "devices", "list").json["data"]["items"]
    mine = items[0]["id"]
    renamed = cli_signed_in("--json", "devices", "rename", mine, "Work laptop (macOS)")
    assert renamed.json["data"]["device"]["name"] == "Work laptop (macOS)"
    creds = json.loads((home / "config" / "credentials.json").read_text())
    assert next(iter(creds["accounts"].values()))["device_name"] == "Work laptop (macOS)"
    assert cli_signed_in("--json", "devices", "rename", "nope", "x").code == 2
    assert cli_signed_in("--json", "devices", "revoke", mine).code == 8  # confirmation needed
    revoked = cli_signed_in("--json", "--yes", "devices", "revoke", mine)
    assert revoked.json["data"]["revoked"] is True
    assert cli_signed_in("--json", "whoami").code == 3  # this device's tokens died with it


def test_T16_UNIT_devices_need_the_step_up_scope(cli: Cli, fake_api: FakeApi, user_id: str) -> None:
    from pilih_jobs.auth import BASE_SCOPES
    from tests.support.helpers import sign_in

    rt = Runtime.create()
    sign_in(rt, fake_api, user_id, list(BASE_SCOPES))
    rt.close()
    result = cli("--json", "devices", "list")
    assert result.code == 4
    assert result.json["error"]["code"] == "insufficient_scope"
    assert result.json["error"]["hint"] == "pilih-jobs login --scope devices:manage"


# ---------------------------------------------------------------------------- system
def test_T16_UNIT_version(cli: Cli) -> None:
    data = cli("--json", "version").json["data"]
    assert data["pilih_jobs"]
    assert data["python"]
    assert data["contracts"]
    assert data["playwright"].startswith("1.63")
    assert data["scrapling"] == "0.4.15"
    assert "pilih-jobs" in cli("version").stdout


@pytest.fixture
def no_browser_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        system,
        "_check_browser",
        lambda rt: [system.Check("browser", True, "stubbed", None, "warning")],
    )


def test_T16_UNIT_doctor_checks_and_bundle(
    cli_signed_in: Cli,
    no_browser_probe: None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    home: Path,
) -> None:
    monkeypatch.chdir(tmp_path)
    # The policy check guards the real CLI process; in a whole-suite run the browser and
    # discovery tests have already imported the drivers into this one.
    for name in ("scrapling", "playwright", "patchright"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    result = cli_signed_in("--json", "doctor", "--bundle")
    assert result.code == 0, result.stdout
    checks = {c["name"]: c for c in result.json["data"]["checks"]}
    assert {
        "python",
        "installer",
        "disk",
        "browser",
        "keyring",
        "policy",
        "api",
        "clock",
        "auth",
    } <= set(checks)
    assert checks["python"]["ok"]
    assert checks["policy"]["ok"]
    assert checks["auth"]["ok"]
    bundle = Path(result.json["data"]["bundle"]["path"])
    import zipfile

    with zipfile.ZipFile(bundle) as archive:
        names = set(archive.namelist())
        assert names == {
            "doctor.json",
            "versions.json",
            "config.json",
            "outbox.json",
            "local_tasks.json",
            "browsers.json",
            "logs/pilih-jobs.log",
        }
        content = b"".join(archive.read(n) for n in names)
    assert b"state.db" not in content
    assert b"refresh" not in content.lower().replace(b"refresh_", b"")


def test_T16_UNIT_doctor_reports_failures_with_fixes(
    cli: Cli, no_browser_probe: None, fake_api: FakeApi
) -> None:
    fake_api.offline = True
    data = cli("--json", "doctor").json["data"]
    checks = {c["name"]: c for c in data["checks"]}
    assert checks["api"]["ok"] is False
    assert checks["api"]["fix"]
    assert "auth" not in checks or checks["auth"]["fix"] == "pilih-jobs login"


def test_T16_UNIT_update_check(
    cli: Cli, monkeypatch: pytest.MonkeyPatch, fake_api: FakeApi
) -> None:
    async def latest(rt: Runtime, *, force: bool = False) -> str:
        return "9.9.9"

    monkeypatch.setattr(system, "latest_pypi_version", latest)
    data = cli("--json", "update", "--check").json["data"]
    assert data["latest"] == "9.9.9"
    assert data["action"] == "upgrade_available"
    assert data["command"] in {" ".join(c) for c in system.UPGRADE_COMMANDS.values()}
    fake_api.min_cli_version = "99.0.0"
    assert cli("--json", "update", "--check").json["data"]["action"] == "upgrade_required"


def test_T16_UNIT_update_runs_the_installer_command(
    cli: Cli, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def latest(rt: Runtime, *, force: bool = False) -> str:
        return "9.9.9"

    calls: list[list[str]] = []
    monkeypatch.setattr(system, "latest_pypi_version", latest)
    monkeypatch.setattr(system, "detect_installer", lambda: "uv")
    monkeypatch.setattr(system.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        system.subprocess,
        "run",
        lambda argv, **kw: (calls.append(argv), type("R", (), {"returncode": 0})())[1],
    )
    data = cli("--json", "update").json["data"]
    assert data["action"] == "upgraded"
    assert calls == [["/usr/bin/uv", "tool", "upgrade", "pilih-jobs"]]


def test_T16_UNIT_uninstall_logs_out_and_purges(
    cli_signed_in: Cli, fake_api: FakeApi, home: Path, keyring_backend: object
) -> None:
    result = cli_signed_in("--json", "--yes", "uninstall", "--purge-data")
    assert result.code == 0, result.stdout
    steps = {s["step"]: s for s in result.json["data"]["steps"]}
    assert steps["logout"]["ok"]
    assert steps["logout"]["revoked"]
    assert steps["delete local data"]["ok"]
    assert "uninstall pilih-jobs" in steps["remove the package"]["command"]
    assert not (home / "data").exists()
    assert keyring_backend.store == {}  # type: ignore[attr-defined]
    assert any(d.get("revoked_at") for d in fake_api.devices.values())  # forget_device on uninstall


def test_T16_UNIT_uninstall_without_purge_keeps_data(cli: Cli, home: Path) -> None:
    result = cli("--json", "uninstall")
    assert result.code == 0
    steps = [s["step"] for s in result.json["data"]["steps"]]
    assert "delete local data" not in steps
    assert steps[-1] == "remove the package"
