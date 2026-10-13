"""TWK-IPC: one worker per device (`worker.lock`) and local IPC (Unix socket with an HMAC
key) so an interactive `apply` hands its task to the running worker (16 §7)."""

from __future__ import annotations

import asyncio
import contextlib
import os
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.paths import resolve_paths
from pilih_jobs.runtime import Runtime
from pilih_jobs.tasks.errors import AlreadyRunningError
from pilih_jobs.tasks.ipc import IpcError, IpcServer, ipc_address, ipc_call, ipc_request
from pilih_jobs.tasks.locks import acquire_worker_lock, read_worker_info, worker_running
from pilih_jobs.tasks.worker import Worker, WorkerOptions
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import executors, submitting_agent


async def _echo(request: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    for n in range(int(request.get("events", 0))):
        yield {"type": "event", "event": "step", "fields": {"n": n}}
    yield {"type": "result", "ok": True, "data": {"echo": request.get("op")}}


async def test_TWK_IPC_request_response_over_the_authenticated_socket(runtime: Runtime) -> None:
    server = IpcServer(runtime.paths, _echo)
    server.start()
    try:
        family, address = ipc_address(runtime.paths)
        assert family == "AF_UNIX"
        assert len(address) <= 104
        assert oct(Path(address).stat().st_mode)[-3:] == "600"
        data = await asyncio.to_thread(ipc_call, runtime.paths, {"op": "ping"})
        assert data == {"echo": "ping"}
        frames = await asyncio.to_thread(
            lambda: list(ipc_request(runtime.paths, {"op": "x", "events": 3}))
        )
        assert [f["type"] for f in frames] == ["event", "event", "event", "result"]
    finally:
        server.close()
    assert not Path(address).exists()


async def test_TWK_IPC_a_client_without_the_key_is_refused(runtime: Runtime) -> None:
    server = IpcServer(runtime.paths, _echo)
    server.start()
    try:
        key_file = runtime.paths.data_dir / "worker.ipc.key"
        assert oct(key_file.stat().st_mode)[-3:] == "600"
        key_file.write_bytes(os.urandom(32))
        with pytest.raises(IpcError):
            await asyncio.to_thread(ipc_call, runtime.paths, {"op": "ping"}, timeout_s=3)
    finally:
        server.close()


async def test_TWK_IPC_close_never_waits_on_a_finished_accept_thread(runtime: Runtime) -> None:
    """Regression: after a refused client the accept loop may see `_closed` and end between
    `close()` setting the flag and waking it; the wake-up must not block on a handshake that
    nothing answers any more."""
    server = IpcServer(runtime.paths, _echo)
    server.start()
    accept_thread = server._thread
    assert accept_thread is not None
    server._closed.set()
    server._wake_accept()  # the accept thread leaves; the listener stays open
    accept_thread.join(timeout=5)
    assert not accept_thread.is_alive()
    server._closed.clear()
    stand_in = threading.Thread(target=time.sleep, args=(0.5,), daemon=True)
    stand_in.start()  # `close()` sees an accept thread that is still "alive"
    server._thread = stand_in
    closer = threading.Thread(target=server.close, daemon=True)  # a hang fails, not blocks
    closer.start()
    closer.join(timeout=10)
    assert not closer.is_alive(), "IpcServer.close() blocked on the wake-up"
    assert not Path(server.address).exists()


def test_TWK_IPC_no_worker_means_no_endpoint(runtime: Runtime) -> None:
    assert worker_running(runtime.paths) is None
    with pytest.raises(IpcError):
        ipc_call(runtime.paths, {"op": "ping"})


def test_TWK_IPC_one_worker_per_device(runtime: Runtime) -> None:
    lock = acquire_worker_lock(runtime.paths, {"pid": os.getpid(), "started_at": 1})
    try:
        info = worker_running(runtime.paths)
        assert info is not None
        assert info.pid == os.getpid()
        with pytest.raises(AlreadyRunningError) as caught:
            acquire_worker_lock(runtime.paths, {"pid": 2})
        assert str(os.getpid()) in caught.value.message
    finally:
        lock.release()
    assert worker_running(runtime.paths) is None
    assert read_worker_info(runtime.paths) is not None  # stale owner record, no holder


async def test_TWK_IPC_worker_status_and_stop(
    runtime: Runtime, account: AccountMeta, cloud: CloudFake
) -> None:
    worker = Worker(
        runtime,
        WorkerOptions(capabilities=["apply"], scheduler=False),
        executors=executors(submitting_agent()),
    )
    job = asyncio.create_task(worker.run())
    for _ in range(200):
        if worker.ipc is not None and worker_running(runtime.paths) is not None:
            break
        await asyncio.sleep(0.02)
    status = await asyncio.to_thread(ipc_call, runtime.paths, {"op": "status"})
    assert status["running"] is True
    assert status["pid"] == os.getpid()
    assert status["device_id"] == account.device_id
    assert status["capabilities"] == ["apply"]
    info = worker_running(runtime.paths)
    assert info is not None
    assert info.ipc["family"] == "AF_UNIX"
    stopped = await asyncio.to_thread(ipc_call, runtime.paths, {"op": "stop"})
    assert stopped == {"stopping": True}
    assert await asyncio.wait_for(job, 10) == 0
    assert worker_running(runtime.paths) is None


@pytest.fixture
def worker_thread(
    home: Path, fake_api: FakeApi, cloud: CloudFake, keyring_backend: Any, cli_cloud: Any
) -> Iterator[Callable[[Callable[..., Any]], None]]:
    """Run a real Worker on its own event loop in a thread (like a second process)."""
    state: dict[str, Any] = {}

    def start(run_attempt: Callable[..., Any]) -> None:
        def target() -> None:
            rt = Runtime.create(api_url=fake_api.issuer)
            rt.transport = fake_api.transport
            rt.keyring_backend = keyring_backend
            worker = Worker(
                rt,
                WorkerOptions(capabilities=["apply"], scheduler=False),
                executors=executors(run_attempt),
            )
            state["worker"] = worker
            try:
                asyncio.run(worker.run())
            finally:
                rt.close()

        thread = threading.Thread(target=target, daemon=True)
        state["thread"] = thread
        thread.start()
        deadline = time.monotonic() + 10
        while worker_running(resolve_paths()) is None or (
            "worker" in state and state["worker"].ipc is None
        ):
            assert time.monotonic() < deadline, "worker did not start"
            time.sleep(0.02)

    yield start
    if "thread" in state:
        with contextlib.suppress(IpcError):
            ipc_call(resolve_paths(), {"op": "stop"})
        state["thread"].join(timeout=10)


def test_TWK_IPC_interactive_apply_hands_the_task_to_the_running_worker(
    cli_cloud: Callable[..., CliResult],
    cloud: CloudFake,
    worker_thread: Callable[[Callable[..., Any]], None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driven_here: list[str] = []

    async def must_not_run(_ctx: Any) -> Any:
        driven_here.append("apply process drove the browser")
        raise AssertionError("the interactive apply must delegate to the worker")

    monkeypatch.setattr("pilih_jobs.agent.run_attempt", must_not_run)
    worker_thread(submitting_agent())
    app = cloud.add_application()
    result = cli_cloud("--json", "apply", app["id"])
    assert result.code == 0, result.stdout
    lines = result.ndjson
    assert any(line.get("message", "").startswith("Handing the task") for line in lines)
    assert any(line["type"] == "submit_intent" for line in lines)
    assert lines[-1]["data"]["outcome"] == "submitted"
    assert driven_here == []
    assert len(cloud.intents) == 1
