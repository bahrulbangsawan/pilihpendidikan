"""TCLI-HEADLESS-CONFIG: `[apply] headless_approval` (16 §9, 18 §5) folded into
`AttemptContext.headed` by `apply` and by the worker.

Approval mode is headed unless `apply.headless_approval = true`; `--headed/--headless` win;
`assisted` is always headed; `auto` follows the adapter's `headless_ok`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.agent.types import AttemptContext, AttemptResult
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.config import Config, load_config
from pilih_jobs.paths import resolve_paths
from pilih_jobs.runtime import Runtime
from pilih_jobs.tasks.poll import PollPolicy
from pilih_jobs.tasks.runner import decide_headed
from pilih_jobs.tasks.worker import Worker, WorkerOptions
from tests.support.helpers import CliResult
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import executors, submitting_agent

Cli = Callable[..., CliResult]
HEADLESS_OK = {"adapter": {"id": "greenhouse", "headless_ok": True}}
NOT_HEADLESS_OK = {"adapter": {"id": "workday", "headless_ok": False}}


class CapturingAgent:
    """Records each `AttemptContext`, then behaves like a well-mannered agent."""

    def __init__(self) -> None:
        self.contexts: list[AttemptContext] = []

    async def __call__(self, ctx: AttemptContext) -> AttemptResult:
        self.contexts.append(ctx)
        return await submitting_agent()(ctx)

    def headed(self) -> list[bool]:
        return [ctx.headed for ctx in self.contexts]


# ---------------------------------------------------------------------- config key
def test_TCLI_HEADLESS_CONFIG_key_is_validated_and_listed(
    cli: Cli, home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    default = cli("--json", "config", "get", "apply.headless_approval")
    assert default.code == 0
    assert default.json["data"] == {
        "key": "apply.headless_approval",
        "value": False,
        "source": "default",
    }
    stored = cli("--json", "config", "set", "apply.headless_approval", "yes")
    assert stored.code == 0
    assert stored.json["data"]["value"] is True
    assert "[apply]\nheadless_approval = true" in resolve_paths().config_file.read_text()
    assert cli("--json", "config", "get", "apply.headless_approval").json["data"]["source"] == (
        "file"
    )
    refused = cli("--json", "config", "set", "apply.headless_approval", "maybe")
    assert refused.code != 0
    assert refused.json["ok"] is False
    assert "expects true or false" in refused.json["error"]["message"]
    listed = cli("--json", "config", "list").json["data"]["items"]
    assert {"key": "apply.headless_approval", "value": True, "source": "file"} in listed
    monkeypatch.setenv("PILIH_JOBS_APPLY_HEADLESS_APPROVAL", "0")
    env = cli("--json", "config", "get", "apply.headless_approval").json["data"]
    assert env == {"key": "apply.headless_approval", "value": False, "source": "env"}
    assert cli("--json", "config", "unset", "apply.headless_approval").code == 0
    monkeypatch.delenv("PILIH_JOBS_APPLY_HEADLESS_APPROVAL")
    assert load_config(resolve_paths()).config.apply.headless_approval is False


# ---------------------------------------------------------------------- the 18 §5 table
def test_TCLI_HEADLESS_CONFIG_decide_headed_follows_18_5() -> None:
    config = Config()
    assert decide_headed("approval", {}, config, None) is True  # headed by default
    assert decide_headed("assisted", {}, config, None) is True
    assert decide_headed("auto", HEADLESS_OK, config, None) is False
    assert decide_headed("auto", NOT_HEADLESS_OK, config, None) is True
    config.apply.headless_approval = True
    assert decide_headed("approval", {}, config, None) is False
    assert decide_headed("approval", {}, config, True) is True  # --headed wins
    assert decide_headed("assisted", {}, config, False) is True  # assisted: always headed
    assert decide_headed("auto", NOT_HEADLESS_OK, config, None) is True  # not an approval run
    config.apply.headless_approval = False
    assert decide_headed("approval", {}, config, False) is False  # --headless wins
    config.browser.headless_for = ["discover", "render_cv", "apply"]  # 16 §9 spelling
    assert decide_headed("approval", {}, config, None) is False
    assert decide_headed("assisted", {}, config, None) is True
    assert decide_headed("approval", {}, config, True) is True


# ---------------------------------------------------------------------- apply
def test_TCLI_HEADLESS_CONFIG_apply_folds_the_config_and_flags(
    cli_cloud: Cli, cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    agent = CapturingAgent()
    monkeypatch.setattr("pilih_jobs.agent.run_attempt", agent)
    assert cli_cloud("--json", "config", "set", "apply.headless_approval", "true").code == 0
    runs = [
        (),  # approval: headless by the config
        ("--headed",),  # the flag wins over the config
        ("--mode", "assisted"),  # assisted is always headed
    ]
    for flags in runs:
        app = cloud.add_application()
        result = cli_cloud("--json", "apply", app["id"], *flags)
        assert result.code == 0, result.stdout + result.stderr
    assert cli_cloud("--json", "config", "set", "apply.headless_approval", "false").code == 0
    app = cloud.add_application()
    assert cli_cloud("--json", "apply", app["id"]).code == 0  # approval: headed by default
    assert agent.headed() == [False, True, True, True]
    assert [ctx.mode for ctx in agent.contexts] == ["approval", "approval", "assisted", "approval"]
    for ctx in agent.contexts:  # AttemptOptions completed by the runner (PLAN C6)
        options = ctx.options
        assert options is not None
        assert options.data_dir == resolve_paths().data_dir
        assert options.browser_mode == "managed"
        assert options.on_event is not None
        assert options.prompt_pause is None  # --json: no terminal prompts


# ---------------------------------------------------------------------- worker
async def _run_worker(runtime: Runtime, agent: CapturingAgent, *, tasks: int, **opts: Any) -> None:
    worker = Worker(
        runtime,
        WorkerOptions(capabilities=["apply"], ipc=False, scheduler=False, max_tasks=tasks, **opts),
        executors=executors(run_attempt=agent),
        policy=PollPolicy(rng=lambda: 0.5),
        sleep_scale=0.001,
    )
    assert await asyncio.wait_for(worker.run(), 30) == 0
    assert worker.completed == tasks


async def test_TCLI_HEADLESS_CONFIG_worker_folds_the_config_for_approval_tasks(
    runtime: Runtime, account: AccountMeta, cloud: CloudFake
) -> None:
    runtime.config.apply.headless_approval = True
    for mode in ("approval", "assisted"):
        app = cloud.add_application()
        cloud.queue_task(
            app_id=app["id"], payload={"mode": mode}, priority=1 if mode == "approval" else 0
        )
    agent = CapturingAgent()
    await _run_worker(runtime, agent, tasks=2)
    assert [(ctx.mode, ctx.headed) for ctx in agent.contexts] == [
        ("approval", False),
        ("assisted", True),
    ]
    assert all(not ctx.interactive for ctx in agent.contexts)
    # `worker start --headed` wins over the config.
    app = cloud.add_application()
    cloud.queue_task(app_id=app["id"], payload={"mode": "approval"})
    headed = CapturingAgent()
    await _run_worker(runtime, headed, tasks=1, headed=True)
    assert headed.headed() == [True]
    # Without the config key, approval tasks are headed (18 §5 default).
    runtime.config.apply.headless_approval = False
    app = cloud.add_application()
    cloud.queue_task(app_id=app["id"], payload={"mode": "approval"})
    default = CapturingAgent()
    await _run_worker(runtime, default, tasks=1)
    assert default.headed() == [True]
