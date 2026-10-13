"""Fake keyring backends for tests (never used outside tests).

`MemoryKeyring` keeps secrets in a dict; `FileKeyring` shares them between processes
through a JSON file (used by the cross-process refresh test, T17-12).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import IO

from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError


def _lock_exclusive(handle: IO[str]) -> None:
    """Block until this process holds the file (released when the handle closes)."""
    if sys.platform == "win32":
        import msvcrt

        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
    else:
        import fcntl

        fcntl.flock(handle, fcntl.LOCK_EX)


class MemoryKeyring(KeyringBackend):
    priority = 1  # type: ignore[assignment]

    def __init__(self) -> None:
        super().__init__()
        self.store: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.store.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.store[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        if (service, username) not in self.store:
            raise PasswordDeleteError(username)
        del self.store[(service, username)]


class FileKeyring(KeyringBackend):
    priority = 1  # type: ignore[assignment]

    def __init__(self, path: Path | str) -> None:
        super().__init__()
        self.path = Path(path)

    def _locked(self, write: bool, mutate=None):
        self.path.touch(exist_ok=True)
        with self.path.open("r+") as handle:
            _lock_exclusive(handle)
            raw = handle.read()
            data = json.loads(raw) if raw else {}
            result = mutate(data) if mutate else None
            if write:
                handle.seek(0)
                handle.truncate()
                handle.write(json.dumps(data))
            return data, result

    def get_password(self, service: str, username: str) -> str | None:
        data, _ = self._locked(False)
        return data.get(f"{service}\0{username}")

    def set_password(self, service: str, username: str, password: str) -> None:
        def mutate(data: dict[str, str]) -> None:
            data[f"{service}\0{username}"] = password

        self._locked(True, mutate)

    def delete_password(self, service: str, username: str) -> None:
        def mutate(data: dict[str, str]) -> bool:
            return data.pop(f"{service}\0{username}", None) is not None

        _, removed = self._locked(True, mutate)
        if not removed:
            raise PasswordDeleteError(username)
