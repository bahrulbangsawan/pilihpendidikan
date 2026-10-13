"""TWK-SERVICE: `worker start --detach` service files — launchd agent, systemd --user unit,
Task Scheduler XML — and the commands that install, stop and remove them."""

from __future__ import annotations

import plistlib
import subprocess
import xml.etree.ElementTree as ET
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.runtime import Runtime
from pilih_jobs.tasks.service import (
    LAUNCHD_LABEL,
    SYSTEMD_UNIT,
    TASK_NAME,
    ServiceManager,
    launchd_plist,
    passthrough_env,
    service_kind,
    systemd_unit,
    task_scheduler_xml,
    worker_argv,
)
from tests.support.helpers import CliResult

ARGV = ["/opt/pilih jobs/bin/pilih-jobs", "worker", "start", "--kinds", "apply,discover"]
ENV = {"PILIH_JOBS_HOME": "/tmp/pj home", "PILIH_JOBS_API_URL": "http://127.0.0.1:8788"}
NS = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}


class Recorder:
    def __init__(self, code: int = 0) -> None:
        self.calls: list[list[str]] = []
        self.code = code

    def __call__(self, argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
        self.calls.append(list(argv))
        return subprocess.CompletedProcess(list(argv), self.code, "", "")


def test_TWK_SERVICE_launchd_plist(tmp_path: Path) -> None:
    document = plistlib.loads(launchd_plist(ARGV, ENV, tmp_path))
    assert document["Label"] == LAUNCHD_LABEL
    assert document["ProgramArguments"] == ARGV
    assert document["RunAtLoad"] is True
    assert document["KeepAlive"] == {"SuccessfulExit": False}
    assert document["EnvironmentVariables"]["PILIH_JOBS_HOME"] == "/tmp/pj home"
    assert document["EnvironmentVariables"]["PILIH_JOBS_SERVICE"] == "launchd"
    assert document["StandardErrorPath"] == str(tmp_path / "worker.err.log")


def test_TWK_SERVICE_systemd_user_unit() -> None:
    unit = systemd_unit(ARGV, ENV)
    lines = unit.splitlines()
    assert '"/opt/pilih jobs/bin/pilih-jobs" worker start --kinds apply,discover' in unit
    assert 'Environment="PILIH_JOBS_HOME=/tmp/pj home"' in lines
    assert "Restart=on-failure" in lines
    assert "RestartPreventExitStatus=3 10" in lines  # signed out / upgrade need the user
    assert "KillSignal=SIGTERM" in lines
    assert "WantedBy=default.target" in lines
    assert "[Service]" in lines
    assert "Type=simple" in lines


def test_TWK_SERVICE_task_scheduler_xml() -> None:
    xml = task_scheduler_xml(ARGV, {}, "DESKTOP\\rahma")
    assert xml.startswith('<?xml version="1.0" encoding="UTF-16"?>')
    root = ET.fromstring(xml.split("\n", 1)[1])  # noqa: S314 - XML we generated
    assert root.find("t:Triggers/t:LogonTrigger/t:UserId", NS).text == "DESKTOP\\rahma"  # type: ignore[union-attr]
    assert root.find("t:Principals/t:Principal/t:RunLevel", NS).text == "LeastPrivilege"  # type: ignore[union-attr]
    assert root.find("t:Actions/t:Exec/t:Command", NS).text == ARGV[0]  # type: ignore[union-attr]
    assert (
        root.find("t:Actions/t:Exec/t:Arguments", NS).text == "worker start --kinds apply,discover"
    )  # type: ignore[union-attr]
    wrapped = ET.fromstring(task_scheduler_xml(ARGV, ENV, "u").split("\n", 1)[1])  # noqa: S314 - XML we generated
    assert wrapped.find("t:Actions/t:Exec/t:Command", NS).text == "cmd.exe"  # type: ignore[union-attr]
    assert (
        "set PILIH_JOBS_HOME=/tmp/pj home" in wrapped.find("t:Actions/t:Exec/t:Arguments", NS).text
    )  # type: ignore[union-attr,operator]


def test_TWK_SERVICE_service_kind_per_platform() -> None:
    assert service_kind("darwin") == "launchd"
    assert service_kind("linux") == "systemd"
    assert service_kind("win32") == "task_scheduler"


def test_TWK_SERVICE_worker_argv_and_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("shutil.which", lambda name: None)
    argv = worker_argv(["apply"], headed=True)
    assert argv[1:] == ["-m", "pilih_jobs", "worker", "start", "--kinds", "apply", "--headed"]
    assert passthrough_env(
        {"PILIH_JOBS_HOME": "/x", "HOME": "/h", "PILIH_JOBS_TOKEN": "secret"}
    ) == {"PILIH_JOBS_HOME": "/x"}


def test_TWK_SERVICE_launchd_install_stop_uninstall(runtime: Runtime, tmp_path: Path) -> None:
    runner = Recorder()
    manager = ServiceManager(runtime.paths, kind="launchd", home=tmp_path, runner=runner, uid=501)
    data = manager.install(ARGV, ENV)
    plist = tmp_path / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
    assert data == {"service": "launchd", "path": str(plist), "started": True}
    assert plistlib.loads(plist.read_bytes())["ProgramArguments"] == ARGV
    assert runner.calls == [
        ["launchctl", "bootout", f"gui/501/{LAUNCHD_LABEL}"],
        ["launchctl", "bootstrap", "gui/501", str(plist)],
        ["launchctl", "kickstart", "-k", f"gui/501/{LAUNCHD_LABEL}"],
    ]
    assert manager.stop() is True
    assert manager.uninstall() is True
    assert not plist.exists()


def test_TWK_SERVICE_systemd_and_task_scheduler_commands(
    runtime: Runtime, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    runner = Recorder()
    systemd = ServiceManager(runtime.paths, kind="systemd", home=tmp_path, runner=runner)
    systemd.install(ARGV, ENV)
    assert (tmp_path / ".config" / "systemd" / "user" / SYSTEMD_UNIT).is_file()
    assert runner.calls == [
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", "--now", SYSTEMD_UNIT],
    ]
    runner.calls.clear()
    windows = ServiceManager(
        runtime.paths, kind="task_scheduler", home=tmp_path, runner=runner, user="u"
    )
    windows.install(ARGV, {})
    xml_path = Path(windows.file_path)
    assert (
        xml_path.read_bytes().decode("utf-16").startswith('<?xml version="1.0" encoding="UTF-16"?>')
    )
    assert runner.calls[0] == ["schtasks", "/Create", "/TN", TASK_NAME, "/XML", str(xml_path), "/F"]
    assert runner.calls[1] == ["schtasks", "/Run", "/TN", TASK_NAME]


def test_TWK_SERVICE_failed_service_command_is_an_error(runtime: Runtime, tmp_path: Path) -> None:
    from pilih_jobs.errors import PilihError

    manager = ServiceManager(runtime.paths, kind="systemd", home=tmp_path, runner=Recorder(code=1))
    with pytest.raises(PilihError) as caught:
        manager.install(ARGV, {})
    assert caught.value.code == "service_error"


def test_TWK_SERVICE_cli_worker_start_detach(
    cli_cloud: Callable[..., CliResult], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    runner = Recorder()
    original: Callable[..., Any] = ServiceManager.__init__

    def init(self: ServiceManager, paths: Any, **kwargs: Any) -> None:
        original(self, paths, kind="launchd", home=tmp_path, runner=runner, uid=501)

    monkeypatch.setattr(ServiceManager, "__init__", init)
    result = cli_cloud("--json", "worker", "start", "--detach", "--kinds", "apply,render_cv")
    assert result.code == 0, result.stdout
    data = result.json["data"]
    assert data["service"] == "launchd"
    assert data["started"] is True
    args = plistlib.loads(Path(data["path"]).read_bytes())["ProgramArguments"]
    assert args[-4:] == ["worker", "start", "--kinds", "apply,render_cv"]
    status = cli_cloud("--json", "worker", "status").json["data"]
    assert status["running"] is False
    assert status["service"]["installed"] is True
    stopped = cli_cloud("--json", "worker", "stop").json["data"]
    assert stopped["stopped"] is True
    assert stopped["via"] == "launchd"
    assert cli_cloud("--json", "worker", "start", "--kinds", "nope").code == 2
