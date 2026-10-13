"""Local IPC between the worker and other `pilih-jobs` processes (16 §7).

The worker listens on a Unix domain socket (`<runtime>/worker.sock`, mode 0600 in a 0700
directory) on POSIX, or a named pipe (`\\\\.\\pipe\\pilih-jobs-<hash>`) on Windows, through
`multiprocessing.connection` with an HMAC challenge (`authkey`, 32 random bytes in
`<data>/worker.ipc.key`, mode 0600), so only processes of this user that can read the key
connect. Messages are JSON documents (`send_bytes`/`recv_bytes`; never pickle).

Protocol: the client sends one request `{"op": …}`; the server answers with zero or more
`{"type": "event", …}` frames and one final `{"type": "result", "ok": …, "data"|"error"}`.
Ops: `ping`, `status`, `stop`, `apply` (an interactive `apply` hands its task to the running
worker so one browser profile never has two drivers).
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import secrets
import socket
import sys
import tempfile
import threading
from collections.abc import AsyncIterator, Callable, Iterator
from multiprocessing.connection import Client, Connection, Listener
from pathlib import Path
from typing import Any, Final, cast

from pilih_jobs.errors import PilihError, UnavailableError
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.paths import Paths, ensure_private_dir

_log = get_logger("tasks.ipc")

#: macOS limits AF_UNIX paths to 104 bytes (Linux 108); longer paths fall back to a hashed
#: socket name in a private per-user temp directory.
MAX_SOCKET_PATH: Final = 100
KEY_FILE: Final = "worker.ipc.key"

IpcHandler = Callable[[dict[str, Any]], AsyncIterator[dict[str, Any]]]


class IpcError(UnavailableError):
    default_code = "worker_unreachable"


def _data_hash(paths: Paths) -> str:
    return hashlib.sha256(str(paths.data_dir.resolve()).encode()).hexdigest()[:12]


def ipc_address(paths: Paths) -> tuple[str, str]:
    """`(family, address)` of the worker endpoint for this data directory."""
    if sys.platform == "win32":  # pragma: no cover - exercised on the Windows CI runner
        return "AF_PIPE", rf"\\.\pipe\pilih-jobs-{_data_hash(paths)}"
    socket_path = paths.worker_socket
    if len(str(socket_path)) > MAX_SOCKET_PATH:
        uid = os.getuid() if hasattr(os, "getuid") else 0
        socket_path = Path(tempfile.gettempdir()) / f"pj-{uid}" / f"{_data_hash(paths)}.sock"
    return "AF_UNIX", str(socket_path)


def key_path(paths: Paths) -> Path:
    return paths.data_dir / KEY_FILE


def write_key(paths: Paths) -> bytes:
    key = secrets.token_bytes(32)
    target = key_path(paths)
    ensure_private_dir(target.parent)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(key)
    return key


def read_key(paths: Paths) -> bytes | None:
    try:
        key = key_path(paths).read_bytes()
    except OSError:
        return None
    return key if len(key) == 32 else None


def _encode(message: dict[str, Any]) -> bytes:
    return json.dumps(message, separators=(",", ":"), default=str).encode("utf-8")


def _decode(raw: bytes) -> dict[str, Any]:
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict):
        raise TypeError("IPC frames are JSON objects")
    return cast(dict[str, Any], value)


class IpcServer:
    """Accepts connections on a thread and runs each request on the worker's event loop."""

    def __init__(self, paths: Paths, handler: IpcHandler) -> None:
        self.paths = paths
        self.handler = handler
        self.family, self.address = ipc_address(paths)
        self._listener: Listener | None = None
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._key: bytes | None = None
        self._closed = threading.Event()

    def describe(self) -> dict[str, Any]:
        return {"family": self.family, "address": self.address}

    def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        key = write_key(self.paths)
        self._key = key
        if self.family == "AF_UNIX":
            sock = Path(self.address)
            ensure_private_dir(sock.parent)
            with contextlib.suppress(FileNotFoundError):
                sock.unlink()  # a stale socket of a dead worker (we hold worker.lock)
        self._listener = Listener(self.address, family=self.family, authkey=key)
        if self.family == "AF_UNIX":
            with contextlib.suppress(OSError):
                Path(self.address).chmod(0o600)
        self._thread = threading.Thread(target=self._accept_loop, name="pj-ipc", daemon=True)
        self._thread.start()

    def _accept_loop(self) -> None:
        listener = self._listener
        while listener is not None and not self._closed.is_set():
            try:
                conn = listener.accept()
            except (OSError, EOFError):
                if self._closed.is_set():
                    return
                continue
            except Exception as exc:  # noqa: BLE001 - e.g. AuthenticationError: keep serving
                log_event(_log, "ipc_rejected", "IPC connection refused", level=30, error=str(exc))
                continue
            if self._closed.is_set():
                conn.close()
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn: Connection) -> None:
        loop = self._loop
        with conn:
            try:
                request = _decode(conn.recv_bytes(1_048_576))
            except (OSError, EOFError, ValueError, TypeError):
                return
            if loop is None:
                return
            iterator = self.handler(request).__aiter__()
            while True:
                future = asyncio.run_coroutine_threadsafe(_next(iterator), loop)
                try:
                    frame = future.result()
                except Exception as exc:  # noqa: BLE001 - report any handler failure
                    error = exc if isinstance(exc, PilihError) else PilihError(str(exc))
                    frame = {"type": "result", "ok": False, "error": error.envelope_error()}
                if frame is None:
                    return
                try:
                    conn.send_bytes(_encode(frame))
                except (OSError, EOFError):
                    closing = getattr(iterator, "aclose", None)
                    if closing is not None:
                        asyncio.run_coroutine_threadsafe(closing(), loop)
                    return
                if frame.get("type") == "result":
                    return

    def close(self) -> None:
        self._closed.set()
        thread = self._thread
        if thread is not None and thread.is_alive():
            # A blocking accept() is not interrupted by close() on every OS: wake it.
            self._wake_accept()
            thread.join(timeout=2)
        listener, self._listener = self._listener, None
        if listener is not None:
            with contextlib.suppress(OSError):
                listener.close()
        if self.family == "AF_UNIX":
            with contextlib.suppress(OSError):
                Path(self.address).unlink()
        with contextlib.suppress(OSError):
            key_path(self.paths).unlink()

    def _wake_accept(self) -> None:
        """Unblock a pending `accept()` without ever waiting for an answer.

        The accept thread may exit on its own between `_closed.set()` and this call (it
        checks the flag after every refused connection), so nothing may answer a client
        handshake any more: the wake-up must never block on one.
        """
        if self.family == "AF_UNIX":
            # A bare connection: accept() returns, the challenge fails, the loop sees
            # `_closed` and ends. No handshake, so no wait.
            with (
                contextlib.suppress(OSError),
                socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock,
            ):
                sock.settimeout(1.0)
                sock.connect(self.address)
            return
        key = self._key
        if key is None:  # pragma: no cover - start() always sets it
            return

        def wake() -> None:  # pragma: no cover - named pipes (Windows CI)
            with contextlib.suppress(Exception):
                Client(self.address, family=self.family, authkey=key).close()

        threading.Thread(target=wake, name="pj-ipc-wake", daemon=True).start()


async def _next(iterator: AsyncIterator[dict[str, Any]]) -> dict[str, Any] | None:
    try:
        return await iterator.__anext__()
    except StopAsyncIteration:
        return None


def ipc_request(
    paths: Paths, request: dict[str, Any], *, timeout_s: float | None = None
) -> Iterator[dict[str, Any]]:
    """Send one request to the worker; yield its frames until the final `result`."""
    key = read_key(paths)
    if key is None:
        raise IpcError("The worker's IPC key is missing; is the worker running?")
    family, address = ipc_address(paths)
    try:
        conn = Client(address, family=family, authkey=key)
    except (OSError, EOFError) as exc:
        raise IpcError(f"Cannot reach the worker ({type(exc).__name__}).") from exc
    except Exception as exc:  # AuthenticationError and friends
        raise IpcError(f"The worker refused the connection: {exc}") from exc
    with conn:
        conn.send_bytes(_encode(request))
        while True:
            if timeout_s is not None and not conn.poll(timeout_s):
                raise IpcError("The worker did not answer in time.")
            try:
                frame = _decode(conn.recv_bytes())
            except (OSError, EOFError) as exc:
                raise IpcError("The worker closed the connection.") from exc
            yield frame
            if frame.get("type") == "result":
                return


def ipc_call(paths: Paths, request: dict[str, Any], *, timeout_s: float = 10.0) -> dict[str, Any]:
    """A request that answers with one result frame (`ping`, `status`, `stop`)."""
    for frame in ipc_request(paths, request, timeout_s=timeout_s):
        if frame.get("type") == "result":
            if frame.get("ok"):
                return cast(dict[str, Any], frame.get("data") or {})
            error = cast(dict[str, Any], frame.get("error") or {})
            raise PilihError(
                str(error.get("message") or "worker error"),
                code=str(error.get("code") or "worker_error"),
                details=cast(dict[str, Any], error.get("details") or {}),
            )
    raise IpcError("The worker sent no result.")
