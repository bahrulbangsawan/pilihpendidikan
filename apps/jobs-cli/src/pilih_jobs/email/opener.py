"""Open a file with the OS handler (09 §6.1 step 3): macOS `open`, Windows `os.startfile`,
Linux `xdg-open`. Everything is injectable so tests never launch a mail client."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

Runner = Callable[[Sequence[str]], int]


def _run(argv: Sequence[str]) -> int:
    completed = subprocess.run(list(argv), check=False, capture_output=True, timeout=30)
    return completed.returncode


def _startfile(path: str) -> None:
    starter = getattr(os, "startfile", None)
    if starter is None:  # pragma: no cover - only on Windows
        raise OSError("os.startfile is not available on this platform")
    starter(path)


def opener_command(path: Path, platform: str | None = None) -> list[str] | None:
    """The command used on macOS / Linux; None on Windows (os.startfile)."""
    name = platform or sys.platform
    if name.startswith("win"):
        return None
    if name == "darwin":
        return ["open", str(path)]
    return ["xdg-open", str(path)]


def open_with_os(
    path: Path,
    *,
    platform: str | None = None,
    runner: Runner = _run,
    startfile: Callable[[str], None] = _startfile,
    which: Callable[[str], str | None] = shutil.which,
) -> bool:
    """True when the handler was started; False when none is available (print instructions)."""
    command = opener_command(path, platform)
    if command is None:
        try:
            startfile(str(path))
        except OSError:
            return False
        return True
    if which(command[0]) is None:
        return False
    try:
        return runner(command) == 0
    except (OSError, subprocess.SubprocessError):
        return False
