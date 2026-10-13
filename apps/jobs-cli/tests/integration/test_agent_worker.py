"""TCLI-AGENT-WORKER: the worker path with the REAL agent (`agent.run_attempt`, headless
Chromium) against the fixture ATS server, through `ApiLeaseChannel` and the contract-checked
fake API (`CloudFake` on `FakeApi`; the AI proxy routes answer with the fixture `FakeAi`).

It confirms the leaf-4.3 channel conventions are honoured by the leaf-4.4 runner:

- `AttemptOptions` plumbing: the worker's template reaches the agent, completed by the
  runner (`data_dir`, browser settings, `on_event`), and `headed` follows 18 §5;
- an approval-mode run reports `submitted` with evidence, and the ATS sees the submission
  only after `submit-intent` answered 200 (D-19, 21 §6.5);
- `AttemptResult.details.lease_lost` stops every report under that lease (21 §5.3), even
  when only the agent saw the fence.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.agent import AttemptContext, AttemptResult, run_attempt
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.contracts._generated.agent import (
    FieldPlan,
    NextActionResponse,
    PageClassifyResponse,
    VerifySubmissionResponse,
)
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.tasks.lease import ApiLeaseChannel
from pilih_jobs.tasks.local import LocalTaskStore
from pilih_jobs.tasks.poll import PollPolicy
from pilih_jobs.tasks.worker import Worker, WorkerOptions
from tests.browser.support import GREENHOUSE_LIKE
from tests.browser.support import test_options as fixture_attempt_options
from tests.fixtures.ats_server import HOST_RESOLVER_RULES, FixtureServer
from tests.fixtures.ats_server.fake_channel import FakeAi
from tests.support.fake_api import FakeApi, FakeHttpError, FakeRequest, FakeResponse
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import Recorder, executors

pytestmark = pytest.mark.browser

AI_ENDPOINTS = ("page-classify", "next-action", "field-plan", "verify-submission")
INTENT_ROUTE = "/api/v1/tasks/{tsk_id}/lease/{lease_id}/submit-intent"


class CloudAi:
    """The `/api/v1/ai/*` proxy of the fake API, answered by the fixture `FakeAi`."""

    def __init__(self, fake: FakeApi) -> None:
        self.ai = FakeAi()
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fail: dict[str, FakeHttpError] = {}
        self.failed_at: dict[str, int] = {}
        self.events_at_failure: int | None = None
        for endpoint in AI_ENDPOINTS:
            fake.route("POST", f"/api/v1/ai/{endpoint}")(self._handler(endpoint))

    def _handler(self, endpoint: str) -> Any:
        def handle(req: FakeRequest) -> FakeResponse:
            body: dict[str, Any] = req.body
            self.calls.append((endpoint, body))
            if endpoint in self.fail:
                self.failed_at[endpoint] = len(self.calls)
                raise self.fail.pop(endpoint)
            if endpoint == "page-classify":
                answer = PageClassifyResponse.model_validate(self.ai.classify(body))
            elif endpoint == "next-action":
                answer = NextActionResponse.model_validate(self.ai.next_action(body))
            elif endpoint == "field-plan":
                answer = FieldPlan.model_validate(self.ai.field_plan(body, body["file_slots"]))
            else:
                answer = VerifySubmissionResponse.model_validate(self.ai.verify(body))
            return FakeResponse(200, answer.model_dump(mode="json"))

        return handle


class TimedIntents:
    """Wraps CloudFake's submit-intent route: when (monotonic) and with which status."""

    def __init__(self, fake: FakeApi) -> None:
        probe = "/api/v1/tasks/tsk_x/lease/lse_x/submit-intent"
        original = next(
            handler
            for method, pattern, handler in fake.handlers
            if method == "POST" and pattern.match(probe)
        )
        self.answered: list[tuple[int, float]] = []

        def timed(req: FakeRequest) -> FakeResponse:
            response = original(req)
            self.answered.append((response.status, time.monotonic()))
            return response

        fake.route("POST", INTENT_ROUTE)(timed)


class RealAgent:
    """The real `run_attempt`, recording the `AttemptContext` the runner built."""

    def __init__(self) -> None:
        self.contexts: list[AttemptContext] = []
        self.results: list[AttemptResult] = []

    async def __call__(self, ctx: AttemptContext) -> AttemptResult:
        self.contexts.append(ctx)
        result = await run_attempt(ctx)
        self.results.append(result)
        return result


def queue_fixture_task(cloud: CloudFake, server: FixtureServer, path: str) -> dict[str, Any]:
    """An approval-mode apply task whose claim context points at the fixture ATS."""
    app = cloud.add_application()
    cloud.add_cv_variant(app["id"])  # the approved CV file, served with its SHA-256
    context = cloud.apply_context({"application_id": app["id"], "payload": {"mode": "approval"}})
    context["posting"].update(
        apply_url=server.url(path),
        canonical_url=server.url(path),
        apply_domain="acme-ats.test",
        company_name="Acme Fixture Co",
        title="Software Engineer",
    )
    context.update(
        allowed_domains=["acme-ats.test", "partner-ats.test"],
        adapter=dict(GREENHOUSE_LIKE),
        rule=None,
        approval_policy={
            "submit_requires_approval": True,
            "generated_text_allowed": False,
            "evidence_screenshots": "on_submit",
        },
    )
    return cloud.queue_task(app_id=app["id"], payload={"mode": "approval"}, context=context)


async def run_worker(
    runtime: Runtime, tmp_path: Path, agent: RealAgent, recorder: Recorder
) -> Worker:
    worker = Worker(
        runtime,
        WorkerOptions(
            capabilities=["apply"],
            ipc=False,
            scheduler=False,
            max_tasks=1,
            attempt=fixture_attempt_options(tmp_path),
        ),
        emit=recorder,
        executors=executors(run_attempt=agent),
        policy=PollPolicy(rng=lambda: 0.5),
        sleep_scale=0.001,
    )
    assert await asyncio.wait_for(worker.run(), 180) == 0
    assert worker.completed == 1
    return worker


def assert_plumbing(ctx: AttemptContext, tmp_path: Path, task: dict[str, Any]) -> None:
    assert isinstance(ctx.channel, ApiLeaseChannel)
    assert ctx.task["id"] == task["id"]
    assert ctx.mode == "approval"
    assert ctx.headed is True  # 18 §5: approval is headed unless apply.headless_approval
    assert ctx.interactive is False
    assert ctx.approve_in_cli is False
    assert ctx.dry_run is False
    assert ctx.run_dir.name == ctx.attempt_id
    options = ctx.options
    assert options is not None
    assert options.host_resolver_rules == HOST_RESOLVER_RULES  # the worker's template …
    assert options.force_headless is True
    assert options.data_dir == tmp_path / "data"
    assert options.approval_poll_s == 0.05
    assert options.browser_mode == "managed"  # … completed by the runner
    assert options.channel == "chromium"
    assert options.on_event is not None
    assert options.keep_artifacts is False
    assert options.prompt_pause is None  # unattended worker: no terminal hooks
    assert options.decide_in_cli is None


async def test_TCLI_AGENT_WORKER_approval_run_reports_submitted_after_a_200_intent(
    runtime: Runtime,
    account: AccountMeta,
    cloud: CloudFake,
    fake_api: FakeApi,
    fixture_ats: FixtureServer,
    recorder: Recorder,
    tmp_path: Path,
) -> None:
    ai = CloudAi(fake_api)
    intents = TimedIntents(fake_api)
    cloud.approve_on_poll = "approved"  # the user approves on the web
    task = queue_fixture_task(cloud, fixture_ats, "/s1/apply")
    agent = RealAgent()

    worker = await run_worker(runtime, tmp_path, agent, recorder)

    (ctx,) = agent.contexts
    assert_plumbing(ctx, tmp_path, task)
    (result,) = agent.results
    assert result.outcome == "submitted", result
    outcome = worker.outcomes[0]
    assert outcome["outcome"] == "submitted"
    assert outcome["submission_status"] == "submitted_verified"
    lease_id = ctx.lease_id
    # The approval gate, then one acknowledged intent bound to it …
    (approval,) = [a for a in cloud.approvals.values() if a["kind"] == "submit"]
    assert approval["state"] == "approved"
    assert approval["payload"]["type"] == "browser_submit"
    (intent,) = cloud.intents
    assert intent["approval_id"] == approval["id"]
    assert intent["form_hash"] == approval["payload"]["form_hash"]
    # … and the ATS saw the submission only after submit-intent answered 200.
    (submitted,) = fixture_ats.state.posts("/s1/submit")
    assert [status for status, _ in intents.answered] == [200]
    assert intents.answered[0][1] < submitted.at
    assert submitted.form["first_name"] == ["Rahma"]
    assert submitted.form["email"] == ["rahma@example.com"]
    assert submitted.form["resume"][0].endswith(".pdf")
    # The result went through the outbox under the lease, with the evidence.
    (reported,) = cloud.results
    assert reported["key"] == f"result:{lease_id}"
    assert reported["outcome"] == "submitted"
    assert reported["evidence"]["verdict"] == "verified"
    assert reported["application_update"]["submission_status"] == "submitted_verified"
    assert reported["application_update"]["stage"] == "applied"
    assert reported["log_file_id"].startswith("fil_")  # the redacted step log (run_log)
    assert cloud.tasks[task["id"]]["state"] == "submitted"
    # Every AI call went through the lease (19 §8.1) …
    endpoints = {endpoint for endpoint, _ in ai.calls}
    assert {"page-classify", "field-plan", "verify-submission"} <= endpoints
    for _, body in ai.calls:
        assert body["lease_ref"] == {"task_id": task["id"], "lease_id": lease_id}
    # … the step events were delivered, and the terminal stream saw the protocol.
    types = [e["type"] for e in cloud.lease_events if e["task_id"] == task["id"]]
    assert types[0] == "started"
    assert "progress" in types
    kinds = recorder.kinds()
    assert kinds.index("approval_requested") < kinds.index("submit_intent")
    assert "result" in kinds
    local = LocalTaskStore(runtime.db).get(task["id"])
    assert local is not None
    assert local.local_state == "done"
    assert Outbox(runtime.db, runtime.issuer).depth() == 0


async def test_TCLI_AGENT_WORKER_details_lease_lost_stops_every_report_under_the_lease(
    runtime: Runtime,
    account: AccountMeta,
    cloud: CloudFake,
    fake_api: FakeApi,
    fixture_ats: FixtureServer,
    recorder: Recorder,
    tmp_path: Path,
) -> None:
    ai = CloudAi(fake_api)
    # Only the agent sees the fence: a 409 on its AI call (any 409 other than duplicate /
    # too_late / invalid_transition is fencing for the agent, 21 §5.3); the channel itself
    # fences on `lease_lost` only, so the runner must honour `details.lease_lost`.
    ai.fail["field-plan"] = FakeHttpError(409, "task_expired", "The task expired.")
    task = queue_fixture_task(cloud, fixture_ats, "/s1/apply")
    agent = RealAgent()

    worker = await run_worker(runtime, tmp_path, agent, recorder)

    (ctx,) = agent.contexts
    assert_plumbing(ctx, tmp_path, task)
    assert "field-plan" in ai.failed_at
    (result,) = agent.results
    assert result.error_class == "lease_lost"
    assert result.details is not None
    assert result.details["lease_lost"] is True
    outcome = worker.outcomes[0]
    assert outcome["outcome"] == "lost"
    assert outcome["lost_reason"] == "lease_lost"
    # Nothing is reported under the lease: no result, release, intent or late evidence …
    assert cloud.results == []
    assert cloud.releases == []
    assert cloud.intents == []
    assert cloud.late == []
    assert fixture_ats.state.posts("/s1/submit") == []
    # … no result was queued, and the step events still queued were dropped, not sent later.
    outbox = Outbox(runtime.db, runtime.issuer)
    assert outbox.get(f"result:{ctx.lease_id}") is None
    under_lease = [e for e in outbox.entries() if e.ordering_key == f"lease:{ctx.lease_id}"]
    assert all(e.state in ("done", "dead") for e in under_lease)
    for entry in under_lease:
        if entry.state == "dead":
            assert entry.last_error == "lease lost before delivery"
    local = LocalTaskStore(runtime.db).get(task["id"])
    assert local is not None
    assert local.local_state == "orphaned"
