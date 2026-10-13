"""User-level background service for `worker start --detach` (16 §3.3, 22 §11).

- macOS: a launchd agent,
  `~/Library/LaunchAgents/com.pilihpendidikan.pilih-jobs.worker.plist`;
- Linux: a systemd `--user` unit, `~/.config/systemd/user/pilih-jobs-worker.service`;
- Windows: a Task Scheduler task at logon, registered with `schtasks /Create /XML`.

The service runs `pilih-jobs worker start` in the foreground under the user's session (never
root / SYSTEM). It restarts after crashes but **not** after exit 3 (signed out) or exit 10
(upgrade required), which need the user. `PILIH_JOBS_HOME` / `PILIH_JOBS_API_URL` /
`PILIH_JOBS_CONFIG` are passed through so the service uses the same state as the shell that
installed it. Generators are pure functions; `ServiceManager` runs the OS commands through
an injectable runner (tests never touch the real service managers).
"""

from __future__ import annotations

import getpass
import os
import plistlib
import shlex
import shutil
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, Literal
from xml.sax.saxutils import escape

from pilih_jobs.errors import PilihError
from pilih_jobs.paths import Paths, ensure_private_dir

LAUNCHD_LABEL: Final = "com.pilihpendidikan.pilih-jobs.worker"
SYSTEMD_UNIT: Final = "pilih-jobs-worker.service"
TASK_NAME: Final = "pilih-jobs worker"
#: Exit codes that must not trigger an automatic restart (16 §3.2).
NO_RESTART_EXIT_CODES: Final = (3, 10)
PASSTHROUGH_ENV: Final = ("PILIH_JOBS_HOME", "PILIH_JOBS_API_URL", "PILIH_JOBS_CONFIG")

ServiceKind = Literal["launchd", "systemd", "task_scheduler"]
Runner = Callable[[Sequence[str]], subprocess.CompletedProcess[str]]


def default_runner(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(argv), capture_output=True, text=True, check=False, timeout=60)


def service_kind(platform: str | None = None) -> ServiceKind:
    name = platform or sys.platform
    if name == "darwin":
        return "launchd"
    if name.startswith("win"):
        return "task_scheduler"
    return "systemd"


def worker_argv(kinds: Sequence[str] | None = None, *, headed: bool = False) -> list[str]:
    """The service's command line: the installed `pilih-jobs`, else `python -m pilih_jobs`."""
    exe = shutil.which("pilih-jobs")
    argv = [exe] if exe else [sys.executable, "-m", "pilih_jobs"]
    argv += ["worker", "start"]
    if kinds:
        argv += ["--kinds", ",".join(kinds)]
    if headed:
        argv.append("--headed")
    return argv


def passthrough_env(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    source = os.environ if environ is None else environ
    return {k: source[k] for k in PASSTHROUGH_ENV if source.get(k)}


# ---------------------------------------------------------------------- generators
def launchd_plist(argv: Sequence[str], env: Mapping[str, str], log_dir: Path) -> bytes:
    document: dict[str, Any] = {
        "Label": LAUNCHD_LABEL,
        "ProgramArguments": list(argv),
        "RunAtLoad": True,
        # Restart after a crash (non-zero exit) but not after a clean stop.
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 60,
        "ProcessType": "Background",
        "StandardOutPath": str(log_dir / "worker.out.log"),
        "StandardErrorPath": str(log_dir / "worker.err.log"),
        "EnvironmentVariables": {"PILIH_JOBS_SERVICE": "launchd", **dict(env)},
    }
    return plistlib.dumps(document, fmt=plistlib.FMT_XML, sort_keys=True)


def _systemd_quote(arg: str) -> str:
    if arg and all(ch.isalnum() or ch in "-_./:=@%+," for ch in arg):
        return arg
    return '"' + arg.replace("\\", "\\\\").replace('"', '\\"') + '"'


def systemd_unit(argv: Sequence[str], env: Mapping[str, str]) -> str:
    environment = "".join(
        f"Environment={_systemd_quote(f'{key}={value}')}\n" for key, value in sorted(env.items())
    )
    return (
        "[Unit]\n"
        "Description=pilih-jobs task worker (pilihpendidikan Job Tracker)\n"
        "After=network-online.target\n"
        "Wants=network-online.target\n"
        "\n"
        "[Service]\n"
        "Type=simple\n"
        f"ExecStart={' '.join(_systemd_quote(a) for a in argv)}\n"
        "Environment=PILIH_JOBS_SERVICE=systemd\n"
        f"{environment}"
        "Restart=on-failure\n"
        "RestartSec=60\n"
        f"RestartPreventExitStatus={' '.join(str(c) for c in NO_RESTART_EXIT_CODES)}\n"
        # SIGTERM = graceful stop with the 30 s hard deadline of 16 §6.
        "KillSignal=SIGTERM\n"
        "TimeoutStopSec=45\n"
        "\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )


def _windows_command_line(args: Sequence[str]) -> str:
    return subprocess.list2cmdline(list(args))


def task_scheduler_xml(argv: Sequence[str], env: Mapping[str, str], user: str) -> str:
    """Task Scheduler 1.2 XML: at logon, interactive token, limited rights, restart on failure."""
    command, arguments = argv[0], _windows_command_line(argv[1:])
    if env:
        # Task Scheduler cannot set environment variables: wrap in `cmd /c set … && …`.
        sets = " && ".join(f"set {k}={v}" for k, v in sorted(env.items()))
        arguments = f'/c "{sets} && {_windows_command_line(argv)}"'
        command = "cmd.exe"
    return (
        '<?xml version="1.0" encoding="UTF-16"?>\n'
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n'
        "  <RegistrationInfo>\n"
        "    <Description>pilih-jobs task worker (pilihpendidikan Job Tracker)</Description>\n"
        "  </RegistrationInfo>\n"
        "  <Triggers>\n"
        "    <LogonTrigger>\n"
        "      <Enabled>true</Enabled>\n"
        f"      <UserId>{escape(user)}</UserId>\n"
        "    </LogonTrigger>\n"
        "  </Triggers>\n"
        "  <Principals>\n"
        '    <Principal id="Author">\n'
        f"      <UserId>{escape(user)}</UserId>\n"
        "      <LogonType>InteractiveToken</LogonType>\n"
        "      <RunLevel>LeastPrivilege</RunLevel>\n"
        "    </Principal>\n"
        "  </Principals>\n"
        "  <Settings>\n"
        "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\n"
        "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\n"
        "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\n"
        "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\n"
        "    <RestartOnFailure>\n"
        "      <Interval>PT1M</Interval>\n"
        "      <Count>10</Count>\n"
        "    </RestartOnFailure>\n"
        "    <Enabled>true</Enabled>\n"
        "  </Settings>\n"
        '  <Actions Context="Author">\n'
        "    <Exec>\n"
        f"      <Command>{escape(command)}</Command>\n"
        f"      <Arguments>{escape(arguments)}</Arguments>\n"
        "    </Exec>\n"
        "  </Actions>\n"
        "</Task>\n"
    )


# ---------------------------------------------------------------------- manager
@dataclass
class ServiceManager:
    paths: Paths
    kind: ServiceKind = field(default_factory=service_kind)
    home: Path = field(default_factory=Path.home)
    runner: Runner = default_runner
    user: str = field(default_factory=getpass.getuser)
    uid: int = field(default_factory=lambda: os.getuid() if hasattr(os, "getuid") else 0)
    commands: list[list[str]] = field(default_factory=lambda: [])

    @property
    def file_path(self) -> Path:
        if self.kind == "launchd":
            return self.home / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
        if self.kind == "systemd":
            config = os.environ.get("XDG_CONFIG_HOME") or str(self.home / ".config")
            return Path(config) / "systemd" / "user" / SYSTEMD_UNIT
        return self.paths.data_dir / "pilih-jobs-worker.task.xml"

    def render(self, argv: Sequence[str], env: Mapping[str, str]) -> bytes:
        if self.kind == "launchd":
            return launchd_plist(argv, env, self.paths.log_dir)
        if self.kind == "systemd":
            return systemd_unit(argv, env).encode("utf-8")
        return task_scheduler_xml(argv, env, self.user).encode("utf-16")

    def _run(self, argv: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
        self.commands.append(list(argv))
        result = self.runner(argv)
        if check and result.returncode != 0:
            raise PilihError(
                f"`{shlex.join(argv)}` failed: {(result.stderr or result.stdout).strip()}",
                code="service_error",
            )
        return result

    def install(self, argv: Sequence[str], env: Mapping[str, str]) -> dict[str, Any]:
        """Write the service file and start it; returns `{service, path, started}`."""
        target = self.file_path
        ensure_private_dir(self.paths.log_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(self.render(argv, env))
        if self.kind == "launchd":
            domain = f"gui/{self.uid}"
            self._run(["launchctl", "bootout", f"{domain}/{LAUNCHD_LABEL}"], check=False)
            self._run(["launchctl", "bootstrap", domain, str(target)])
            self._run(["launchctl", "kickstart", "-k", f"{domain}/{LAUNCHD_LABEL}"])
        elif self.kind == "systemd":
            self._run(["systemctl", "--user", "daemon-reload"])
            self._run(["systemctl", "--user", "enable", "--now", SYSTEMD_UNIT])
        else:
            self._run(["schtasks", "/Create", "/TN", TASK_NAME, "/XML", str(target), "/F"])
            self._run(["schtasks", "/Run", "/TN", TASK_NAME])
        return {"service": self.kind, "path": str(target), "started": True}

    def stop(self) -> bool:
        """Stop the service (SIGTERM → graceful); True when a service was stopped."""
        if not self.installed():
            return False
        if self.kind == "launchd":
            result = self._run(
                ["launchctl", "bootout", f"gui/{self.uid}/{LAUNCHD_LABEL}"], check=False
            )
        elif self.kind == "systemd":
            result = self._run(["systemctl", "--user", "stop", SYSTEMD_UNIT], check=False)
        else:
            result = self._run(["schtasks", "/End", "/TN", TASK_NAME], check=False)
        return result.returncode == 0

    def uninstall(self) -> bool:
        if not self.installed():
            return False
        self.stop()
        if self.kind == "systemd":
            self._run(["systemctl", "--user", "disable", SYSTEMD_UNIT], check=False)
        elif self.kind == "task_scheduler":
            self._run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"], check=False)
        self.file_path.unlink(missing_ok=True)
        if self.kind == "systemd":
            self._run(["systemctl", "--user", "daemon-reload"], check=False)
        return True

    def installed(self) -> bool:
        return self.file_path.exists()
