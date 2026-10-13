"""`CloudFake`: the leaf-4.4 routes of `apps/api` on top of `FakeApi` (contract-validated).

`FakeApi` validates every request and response against the generated contract models, so
these handlers build their bodies from the contract examples and only override ids and
state. Covered: the automation protocol (tasks, claim, lease heartbeat/events/approvals/
submit-intent/result/release, late evidence, device heartbeat), files (with binary content
served by `BinaryTransport`), CV variants and render tickets, email applications, the board
and application routes, inbox, scores, analytics, approvals, rules, settings and facts.
"""

from __future__ import annotations

import copy
import hashlib
from collections.abc import Callable
from typing import Any, cast

import httpx

from pilih_jobs.contracts import ids
from pilih_jobs.email.handoff import email_payload_hash
from tests.support.fake_api import (
    FakeApi,
    FakeHttpError,
    FakeRequest,
    FakeResponse,
    example,
    record_example,
)

PDF = b"%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n"
LIVE = ("claimed", "running", "paused", "awaiting_approval")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class BinaryTransport(httpx.AsyncBaseTransport):
    """Serves `GET /api/v1/files/{id}/content` bytes (the JSON fake cannot)."""

    def __init__(self, cloud: CloudFake, inner: httpx.AsyncBaseTransport) -> None:
        self.cloud = cloud
        self.inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if (
            request.method == "GET"
            and path.startswith("/api/v1/files/")
            and path.endswith("/content")
        ):
            if self.cloud.fake.offline:
                raise httpx.ConnectError("fake network down", request=request)
            self.cloud.fake.requests.append(("GET", path))
            file_id = path.split("/")[4]
            stored = self.cloud.files.get(file_id)
            if stored is None:
                return httpx.Response(
                    404,
                    json={"error": "not_found", "message": "no file", "request_id": ids.new_ulid()},
                    request=request,
                )
            content, view = stored
            served = self.cloud.content_override.get(file_id, content)
            etag = self.cloud.etag_override.get(file_id, f'"{view["sha256"]}"')
            headers = {"content-type": str(view["content_type"])}
            if etag:
                headers["etag"] = etag
            return httpx.Response(200, content=served, headers=headers, request=request)
        return await self.inner.handle_async_request(request)


class CloudFake:
    def __init__(self, fake: FakeApi, user_id: str) -> None:
        self.fake = fake
        self.user_id = user_id
        self.tasks: dict[str, dict[str, Any]] = {}
        self.contexts: dict[str, dict[str, Any]] = {}
        self.attempts: dict[str, list[dict[str, Any]]] = {}
        self.approvals: dict[str, dict[str, Any]] = {}
        self.files: dict[str, tuple[bytes, dict[str, Any]]] = {}
        self.content_override: dict[str, bytes] = {}
        self.etag_override: dict[str, str] = {}
        self.lease_events: list[dict[str, Any]] = []
        self.heartbeats: list[dict[str, Any]] = []
        self.intents: list[dict[str, Any]] = []
        self.results: list[dict[str, Any]] = []
        self.releases: list[dict[str, Any]] = []
        self.late: list[dict[str, Any]] = []
        self.claims: list[dict[str, Any]] = []
        self.created: list[dict[str, Any]] = []
        self.ai_calls: list[dict[str, Any]] = []
        self.device_beats: list[dict[str, Any]] = []
        self.decisions: list[dict[str, Any]] = []
        self.render_tickets: list[str] = []
        self.cv_variants: dict[str, dict[str, Any]] = {}
        self.emails: dict[str, dict[str, Any]] = {}
        self.handed_off: list[dict[str, Any]] = []
        self.rules: dict[str, dict[str, Any]] = {}
        self.inbox: list[dict[str, Any]] = []
        self.user_jobs: dict[str, dict[str, Any]] = {}
        self.postings: dict[str, dict[str, Any]] = {}
        self.score_requests: list[dict[str, Any]] = []
        self.facts: dict[str, Any] = {
            "contact.full_name": "Rahma Putri",
            "contact.email": "rahma@example.com",
            "contact.phone": "+62 812 3456 7890",
        }
        self.settings: dict[str, Any] = cast(
            dict[str, Any], example("GET /api/v1/settings")["settings"]
        )
        self.settings.update(user_id=user_id, automation_paused=False, revision=3)
        self.poll_interval_ms = 30_000
        self.claim_retry_after: str | None = None
        self.approve_on_poll: str | None = None  # "approved" | "rejected" | None
        self.lease_ms = 120_000
        self.posting_support = "browser_supported"
        self.finish_generation = False
        self.review_hash: str | None = None
        self.email_reads = 0
        self.install()

    # ------------------------------------------------------------------ helpers
    def now(self) -> int:
        return self.fake.now()

    def _owned_task(self, req: FakeRequest) -> dict[str, Any]:
        task = self.tasks.get(req.params["tsk_id"])
        if task is None or task["user_id"] != req.user_id:
            raise FakeHttpError(404, "not_found", "no task")
        return task

    def _leased(self, req: FakeRequest) -> dict[str, Any]:
        task = self._owned_task(req)
        device = req.token.device_id(self.fake) if req.token else None
        if (
            task["lease_id"] != req.params["lease_id"]
            or task["lease_device_id"] != device
            or task["state"] not in LIVE
            or (task["lease_expires_at"] or 0) <= self.now()
        ):
            raise FakeHttpError(409, "lease_lost", "the lease is not held")
        return task

    def lose(self, task_id: str) -> None:
        """Simulate the reaper / another device taking the task: the lease is gone."""
        task = self.tasks[task_id]
        task.update(lease_id=None, lease_device_id=None, lease_expires_at=None, state="queued")

    def cancel(self, task_id: str) -> None:
        self.tasks[task_id]["cancel_requested"] = True

    def resume(self, task_id: str) -> None:
        self.tasks[task_id]["resume_requested"] = True

    # ------------------------------------------------------------------ domain builders
    def add_posting(self, **overrides: Any) -> dict[str, Any]:
        posting = record_example("job_postings")
        posting.update(id=ids.new_id("pst"), application_support=self.posting_support)
        posting.update(overrides)
        self.postings[posting["id"]] = posting
        return posting

    def add_application(self, *, stage: str = "ready", **overrides: Any) -> dict[str, Any]:
        app = self.fake.new_application(self.user_id, stage=stage)
        posting = self.add_posting()
        user_job = record_example("user_jobs")
        user_job.update(
            id=app["user_job_id"],
            user_id=self.user_id,
            posting_id=posting["id"],
            inbox_state="tracked",
        )
        self.user_jobs[user_job["id"]] = user_job
        stored = self.fake.entities[("application", app["id"])]
        stored.update(cv_variant_id=None, automation_rule_id=None, mode="approval")
        stored.update(overrides)
        return copy.deepcopy(stored)

    def posting_for(self, app: dict[str, Any]) -> dict[str, Any]:
        user_job = self.user_jobs.get(app["user_job_id"])
        if user_job is not None and user_job["posting_id"] in self.postings:
            return self.postings[user_job["posting_id"]]
        return self.add_posting()

    def add_file(
        self, data: bytes = PDF, *, kind: str = "cv_pdf", name: str = "cv.pdf"
    ) -> dict[str, Any]:
        view = example("GET /api/v1/files/{fil_id}")["file"]
        view.update(
            id=ids.new_id("fil"),
            user_id=self.user_id,
            kind=kind,
            content_type="application/pdf" if name.endswith(".pdf") else "application/octet-stream",
            size_bytes=len(data),
            sha256=sha(data),
            original_name=name,
            created_at=self.now(),
        )
        self.files[view["id"]] = (data, view)
        return copy.deepcopy(view)

    def add_cv_variant(
        self, app_id: str | None, *, status: str = "approved", with_file: bool = True
    ) -> dict[str, Any]:
        detail = example("GET /api/v1/cv-variants/{cvv_id}")
        variant = cast(dict[str, Any], detail["cv_variant"])
        file_view = self.add_file(name="rahma-cv-t.pdf") if with_file else None
        variant.update(
            id=ids.new_id("cvv"),
            user_id=self.user_id,
            application_id=app_id,
            status=status,
            file_id=file_view["id"] if file_view else None,
            approved_at=self.now() if status == "approved" else None,
            created_at=self.now(),
        )
        self.cv_variants[variant["id"]] = variant
        if app_id is not None and status == "approved":
            self.fake.entities[("application", app_id)]["cv_variant_id"] = variant["id"]
        return copy.deepcopy(variant)

    def queue_task(
        self,
        kind: str = "apply",
        *,
        app_id: str | None = None,
        target: str | None = None,
        payload: dict[str, Any] | None = None,
        priority: int = 0,
        context: dict[str, Any] | None = None,
        cv_variant_id: str | None = None,
    ) -> dict[str, Any]:
        task = record_example("automation_tasks")
        task.update(
            id=ids.new_id("tsk"),
            user_id=self.user_id,
            kind=kind,
            application_id=app_id,
            cv_variant_id=cv_variant_id,
            payload=payload
            if payload is not None
            else ({"mode": "approval"} if kind == "apply" else {}),
            state="queued",
            target_device_id=target,
            required_capabilities=[kind],
            priority=priority,
            not_before=self.now() - 1,
            expires_at=self.now() + 72 * 3_600_000,
            lease_id=None,
            lease_device_id=None,
            lease_expires_at=None,
            attempt_count=0,
            submit_intent_at=None,
            pause_reason=None,
            resume_requested=False,
            cancel_requested=False,
            progress={},
            local_state=None,
            error_class=None,
            error_message=None,
            created_by="cli",
            idempotency_key=ids.new_ulid(),
            revision=1,
            created_at=self.now(),
            updated_at=self.now(),
            finished_at=None,
        )
        self.tasks[task["id"]] = task
        if context is not None:
            self.contexts[task["id"]] = context
        self.attempts[task["id"]] = []
        return task

    def apply_context(self, task: dict[str, Any]) -> dict[str, Any]:
        base = example("POST /api/v1/devices/{dev_id}/tasks:claim")["context"]
        app = copy.deepcopy(self.fake.entities[("application", task["application_id"])])
        base["application"] = app
        base["posting"] = copy.deepcopy(self.posting_for(app))
        base["mode"] = task["payload"].get("mode", "approval")
        variant = self.cv_variants.get(str(app.get("cv_variant_id")))
        if variant is not None and variant.get("file_id"):
            data, view = self.files[variant["file_id"]]
            base["cv"] = {
                "cv_variant_id": variant["id"],
                "status": variant["status"],
                "file": {"file_id": view["id"], "sha256": sha(data)},
            }
        else:
            base["cv"] = None
        base["rule"] = None
        base["resume_from_approval"] = None
        return base

    def render_context(self, cvv_id: str, *, expires_in: int = 120) -> dict[str, Any]:
        ticket = ids.new_ulid() + ids.new_ulid()
        return {
            "kind": "render_cv",
            "cv_variant_id": cvv_id,
            "render": {
                "ticket": ticket,
                "url": f"https://jobs.test/render/cv/{cvv_id}?ticket={ticket}",
                "expires_in": expires_in,
            },
        }

    def discover_context(self, n: int = 1) -> dict[str, Any]:
        sources = []
        for _ in range(n):
            source = record_example("job_sources")
            source.update(id=ids.new_id("src"), user_id=self.user_id)
            sources.append(source)
        return {"kind": "discover", "sources": sources}

    def task_view(self, task: dict[str, Any]) -> dict[str, Any]:
        return copy.deepcopy(task)

    # ------------------------------------------------------------------ routes
    def install(self) -> None:
        fake = self.fake

        @fake.route("POST", "/api/v1/tasks")
        def create_task(req: FakeRequest) -> FakeResponse:
            body = req.body
            if body["kind"] == "apply":
                for task in self.tasks.values():
                    if (
                        task["application_id"] == body.get("application_id")
                        and task["kind"] == "apply"
                        and task["state"] in ("queued", *LIVE)
                    ):
                        raise FakeHttpError(
                            409,
                            "duplicate",
                            "a live apply task exists",
                            details={"task_id": task["id"]},
                        )
            task = self.queue_task(
                body["kind"],
                app_id=body.get("application_id"),
                target=body.get("target_device_id"),
                payload=body.get("payload") or {},
                priority=body.get("priority") or 0,
                cv_variant_id=body.get("cv_variant_id"),
            )
            task["idempotency_key"] = body["idempotency_key"]
            self.created.append(copy.deepcopy(task))
            return FakeResponse(201, {"task": self.task_view(task)})

        @fake.route("GET", "/api/v1/tasks/{tsk_id}")
        def get_task(req: FakeRequest) -> FakeResponse:
            task = self._owned_task(req)
            context = self.contexts.get(task["id"])
            if context is None and task["kind"] == "apply" and task["application_id"]:
                context = self.apply_context(task)
            body = {
                "task": self.task_view(task),
                "attempts": copy.deepcopy(self.attempts.get(task["id"], [])),
                "approvals": [
                    copy.deepcopy(a) for a in self.approvals.values() if a["task_id"] == task["id"]
                ],
                "evidence": [],
                "device_name": "Test device (macOS)",
                "context": context,
            }
            return FakeResponse(200, body)

        @fake.route("POST", "/api/v1/devices/{dev_id}/tasks:claim")
        def claim(req: FakeRequest) -> FakeResponse:
            device = req.params["dev_id"]
            caps = set(req.body["capabilities"])
            self.claims.append({"key": req.idempotency_key, "capabilities": sorted(caps)})
            if self.claim_retry_after is not None:
                return FakeResponse(204, None, {"retry-after": self.claim_retry_after})
            candidates = sorted(
                (
                    t
                    for t in self.tasks.values()
                    if t["state"] == "queued"
                    and set(t["required_capabilities"]) <= caps
                    and t["target_device_id"] in (None, device)
                    and t["not_before"] <= self.now()
                ),
                key=lambda t: (-t["priority"], t["created_at"]),
            )
            if not candidates:
                return FakeResponse(204, None)
            task = candidates[0]
            lease = ids.new_id("lse")
            attempt_id = ids.new_id("att")
            task.update(
                state="claimed",
                lease_id=lease,
                lease_device_id=device,
                lease_expires_at=self.now() + self.lease_ms,
                attempt_count=task["attempt_count"] + 1,
            )
            attempt = record_example("automation_attempts")
            attempt.update(
                id=attempt_id,
                task_id=task["id"],
                user_id=self.user_id,
                device_id=device,
                lease_id=lease,
                attempt_no=task["attempt_count"],
                started_at=self.now(),
                last_heartbeat_at=self.now(),
                ended_at=None,
                outcome=None,
                log_file_id=None,
            )
            self.attempts.setdefault(task["id"], []).append(attempt)
            if task["kind"] == "apply":
                context = self.contexts.get(task["id"]) or self.apply_context(task)
            else:
                context = self.contexts[task["id"]]
            body = {
                "task": self.task_view(task),
                "lease": {
                    "lease_id": lease,
                    "attempt_id": attempt_id,
                    "expires_at": task["lease_expires_at"],
                    "heartbeat_interval_ms": 30_000,
                },
                "context": copy.deepcopy(context),
                "poll_interval_ms": 5_000,
            }
            return FakeResponse(200, body)

        @fake.route("POST", "/api/v1/tasks/{tsk_id}/lease/{lease_id}/heartbeat")
        def heartbeat(req: FakeRequest) -> FakeResponse:
            task = self._leased(req)
            self.heartbeats.append({"lease_id": task["lease_id"], **req.body})
            task["lease_expires_at"] = self.now() + self.lease_ms
            if task["state"] == "claimed":
                task["state"] = "running"
            task["local_state"] = req.body.get("local_state")
            return FakeResponse(
                200,
                {
                    "lease_expires_at": task["lease_expires_at"],
                    "cancel_requested": bool(task["cancel_requested"]),
                    "resume_requested": bool(task["resume_requested"]),
                    "poll_interval_ms": self.poll_interval_ms,
                    "server_time": self.now(),
                },
            )

        @fake.route("POST", "/api/v1/tasks/{tsk_id}/lease/{lease_id}/events")
        def events(req: FakeRequest) -> FakeResponse:
            task = self._leased(req)
            results = []
            for event in req.body["events"]:
                self.lease_events.append({"task_id": task["id"], **event})
                if event["type"] == "paused":
                    task["state"] = "paused"
                    task["pause_reason"] = event["pause_reason"]
                elif event["type"] in ("resumed", "started"):
                    task["state"] = "running"
                results.append(
                    {
                        "idempotency_key": event["idempotency_key"],
                        "status": "recorded",
                        "event_id": ids.new_id("evt"),
                    }
                )
            return FakeResponse(200, {"results": results, "task_state": task["state"]})

        @fake.route("POST", "/api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals")
        def create_approval(req: FakeRequest) -> FakeResponse:
            task = self._leased(req)
            approval = example("POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals")["approval"]
            approval.update(
                id=ids.new_id("apr"),
                user_id=self.user_id,
                kind=req.body["kind"],
                task_id=task["id"],
                application_id=task["application_id"],
                payload=req.body["payload"],
                payload_hash=req.body["payload_hash"],
                state="pending",
                created_at=self.now(),
                expires_at=self.now() + 86_400_000,
            )
            self.approvals[approval["id"]] = approval
            task["state"] = "awaiting_approval"
            return FakeResponse(201, {"approval": copy.deepcopy(approval)})

        @fake.route("GET", "/api/v1/tasks/{tsk_id}/lease/{lease_id}/approvals/{apr_id}")
        def get_lease_approval(req: FakeRequest) -> FakeResponse:
            self._leased(req)
            approval = self.approvals.get(req.params["apr_id"])
            if approval is None:
                raise FakeHttpError(404, "not_found", "no approval")
            if self.approve_on_poll and approval["state"] == "pending":
                self._decide(approval, self.approve_on_poll, "web")
            return FakeResponse(200, {"approval": copy.deepcopy(approval)})

        @fake.route("POST", "/api/v1/tasks/{tsk_id}/lease/{lease_id}/submit-intent")
        def submit_intent(req: FakeRequest) -> FakeResponse:
            task = self._leased(req)
            if task["cancel_requested"]:
                raise FakeHttpError(409, "too_late", "cancelled")
            task["submit_intent_at"] = self.now()
            self.intents.append({"task_id": task["id"], **req.body})
            return FakeResponse(200, {"submit_intent_at": task["submit_intent_at"]})

        @fake.route("POST", "/api/v1/tasks/{tsk_id}/lease/{lease_id}/result")
        def result(req: FakeRequest) -> FakeResponse:
            task = self._leased(req)
            self.results.append({"task_id": task["id"], "key": req.idempotency_key, **req.body})
            outcome = req.body["outcome"]
            task.update(
                state=outcome if outcome != "failed" or not req.body.get("retryable") else "queued",
                lease_id=None,
                lease_device_id=None,
                lease_expires_at=None,
                finished_at=self.now(),
            )
            app = None
            if task["application_id"]:
                stored = self.fake.entities[("application", task["application_id"])]
                update = req.body.get("application_update") or {}
                if update.get("submission_status"):
                    stored["submission_status"] = update["submission_status"]
                if update.get("stage"):
                    stored["stage"] = update["stage"]
                stored["revision"] += 1
                app = copy.deepcopy(stored)
            return FakeResponse(
                200,
                {
                    "task": self.task_view(task),
                    "application": app,
                    "evidence": None,
                    "conflict_recorded": False,
                },
            )

        @fake.route("POST", "/api/v1/tasks/{tsk_id}/lease/{lease_id}/release")
        def release(req: FakeRequest) -> FakeResponse:
            task = self._leased(req)
            if task["submit_intent_at"] is not None:
                raise FakeHttpError(409, "too_late", "past submit_intent")
            self.releases.append({"task_id": task["id"], **req.body})
            state = "awaiting_approval" if req.body["reason"] == "awaiting_approval" else "queued"
            # 21 §12: a released task returns to the queue with a backoff (not_before).
            task.update(
                state=state,
                lease_id=None,
                lease_device_id=None,
                lease_expires_at=None,
                not_before=self.now() + 60_000,
            )
            return FakeResponse(200, {"task": self.task_view(task)})

        @fake.route("POST", "/api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence")
        def late_evidence(req: FakeRequest) -> FakeResponse:
            task = self._owned_task(req)
            self.late.append(
                {"task_id": task["id"], "attempt_id": req.params["att_id"], **req.body}
            )
            response = example("POST /api/v1/tasks/{tsk_id}/attempts/{att_id}/late-evidence")
            response["task"] = self.task_view(task)
            if task["application_id"]:
                response["application"] = copy.deepcopy(
                    self.fake.entities[("application", task["application_id"])]
                )
            return FakeResponse(200, response)

        @fake.route("POST", "/api/v1/devices/{dev_id}/heartbeat")
        def device_heartbeat(req: FakeRequest) -> FakeResponse:
            self.device_beats.append(req.body)
            return FakeResponse(
                200,
                {
                    "server_time": self.now(),
                    "poll_interval_ms": self.poll_interval_ms,
                    "cancel_lease_ids": [
                        t["lease_id"]
                        for t in self.tasks.values()
                        if t["cancel_requested"] and t["lease_id"]
                    ],
                    "min_cli_version": fake.min_cli_version,
                },
            )

        # ---------------------------------------------------------------- AI proxy
        for endpoint in ("page-classify", "next-action", "field-plan", "verify-submission"):
            key = f"POST /api/v1/ai/{endpoint}"

            def handler(req: FakeRequest, key: str = key) -> FakeResponse:
                self.ai_calls.append(req.body)
                return FakeResponse(200, example(key))

            fake.route("POST", f"/api/v1/ai/{endpoint}")(handler)

        # ---------------------------------------------------------------- files
        @fake.route("GET", "/api/v1/files/{fil_id}")
        def get_file(req: FakeRequest) -> FakeResponse:
            stored = self.files.get(req.params["fil_id"])
            if stored is None:
                raise FakeHttpError(404, "not_found", "no file")
            return FakeResponse(200, {"file": copy.deepcopy(stored[1])})

        # ---------------------------------------------------------------- CV
        @fake.route("GET", "/api/v1/cvs")
        def cvs(_req: FakeRequest) -> FakeResponse:
            return FakeResponse(200, example("GET /api/v1/cvs"))

        @fake.route("GET", "/api/v1/cv-variants/{cvv_id}")
        def get_variant(req: FakeRequest) -> FakeResponse:
            variant = self.cv_variants.get(req.params["cvv_id"])
            if variant is None:
                raise FakeHttpError(404, "not_found", "no variant")
            if self.finish_generation and variant["status"] == "generating":
                variant["status"] = "draft"
            file_view = self.files[variant["file_id"]][1] if variant.get("file_id") else None
            body: dict[str, Any] = {
                "cv_variant": copy.deepcopy(variant),
                "file": copy.deepcopy(file_view),
                "edited_after_approval": False,
            }
            if req.query.get("include") == "cv_data":
                body["tailored_cv"] = {"personalInfo": {"fullName": "Rahma Putri"}}
            return FakeResponse(200, body)

        @fake.route("POST", "/api/v1/applications/{app_id}/cv-variants")
        def create_variant(req: FakeRequest) -> FakeResponse:
            variant = self.add_cv_variant(
                req.params["app_id"], status="generating", with_file=False
            )
            variant.update(base_cv_id=req.body["base_cv_id"], template=req.body["template"])
            self.cv_variants[variant["id"]].update(
                base_cv_id=req.body["base_cv_id"], template=req.body["template"]
            )
            return FakeResponse(202, {"cv_variant": variant})

        @fake.route("POST", "/api/v1/cv-variants/{cvv_id}/render-ticket")
        def render_ticket(req: FakeRequest) -> FakeResponse:
            cvv = req.params["cvv_id"]
            context = self.render_context(cvv)
            self.render_tickets.append(context["render"]["ticket"])
            return FakeResponse(200, context["render"])

        def decide_variant(req: FakeRequest, status: str) -> dict[str, Any]:
            variant = self.cv_variants.get(req.params["cvv_id"])
            if variant is None:
                raise FakeHttpError(404, "not_found", "no variant")
            if req.body["base_revision"] != variant["revision"]:
                raise FakeHttpError(409, "revision_conflict", "stale")
            variant.update(status=status, revision=variant["revision"] + 1)
            return variant

        @fake.route("POST", "/api/v1/cv-variants/{cvv_id}/approve")
        def approve_variant(req: FakeRequest) -> FakeResponse:
            variant = decide_variant(req, "approved")
            return FakeResponse(200, {"cv_variant": copy.deepcopy(variant), "application": None})

        @fake.route("POST", "/api/v1/cv-variants/{cvv_id}/reject")
        def reject_variant(req: FakeRequest) -> FakeResponse:
            variant = decide_variant(req, "rejected")
            return FakeResponse(200, {"cv_variant": copy.deepcopy(variant)})

        # ---------------------------------------------------------------- profile / settings
        @fake.route("GET", "/api/v1/profile/facts")
        def facts(_req: FakeRequest) -> FakeResponse:
            items = []
            for key, value in self.facts.items():
                fact = record_example("applicant_facts")
                fact.update(id=ids.new_id("fct"), user_id=self.user_id, key=key, value=value)
                items.append(fact)
            return FakeResponse(200, {"facts": items, "profile_version": 3})

        @fake.route("GET", "/api/v1/settings")
        def get_settings(_req: FakeRequest) -> FakeResponse:
            return FakeResponse(200, {"settings": copy.deepcopy(self.settings)})

        @fake.route("PATCH", "/api/v1/settings")
        def patch_settings(req: FakeRequest) -> FakeResponse:
            if req.body["base_revision"] != self.settings["revision"]:
                raise FakeHttpError(
                    409,
                    "revision_conflict",
                    "stale",
                    details={"current": copy.deepcopy(self.settings)},
                )
            for key, value in req.body.items():
                if key != "base_revision":
                    self.settings[key] = value
            self.settings["revision"] += 1
            return FakeResponse(200, {"settings": copy.deepcopy(self.settings)})

        # ---------------------------------------------------------------- approvals
        @fake.route("GET", "/api/v1/approvals")
        def list_approvals(req: FakeRequest) -> FakeResponse:
            wanted = req.query.get("state")
            kind = req.query.get("kind")
            items = [
                copy.deepcopy(a)
                for a in self.approvals.values()
                if (wanted is None or a["state"] == wanted) and (kind is None or a["kind"] == kind)
            ]
            return FakeResponse(200, {"items": items, "next_cursor": None})

        @fake.route("POST", "/api/v1/approvals/{apr_id}/decide")
        def decide(req: FakeRequest) -> FakeResponse:
            approval = self.approvals.get(req.params["apr_id"])
            if approval is None:
                raise FakeHttpError(404, "not_found", "no approval")
            if approval["state"] != "pending":
                raise FakeHttpError(409, "invalid_transition", "already decided")
            if req.body["payload_hash"] != approval["payload_hash"]:
                raise FakeHttpError(409, "revision_conflict", "payload changed")
            self.decisions.append(req.body)
            state = "approved" if req.body["decision"] == "approve" else "rejected"
            self._decide(approval, state, "cli", response=req.body.get("response"))
            task = self.tasks.get(str(approval.get("task_id")))
            return FakeResponse(
                200,
                {
                    "approval": copy.deepcopy(approval),
                    "task": self.task_view(task) if task else None,
                },
            )

        # ---------------------------------------------------------------- rules
        @fake.route("GET", "/api/v1/rules")
        def list_rules(_req: FakeRequest) -> FakeResponse:
            return FakeResponse(
                200, {"items": [copy.deepcopy(r) for r in self.rules.values()], "next_cursor": None}
            )

        @fake.route("GET", "/api/v1/rules/{rul_id}")
        def get_rule(req: FakeRequest) -> FakeResponse:
            rule = self.rules.get(req.params["rul_id"])
            if rule is None:
                raise FakeHttpError(404, "not_found", "no rule")
            return FakeResponse(200, {"rule": copy.deepcopy(rule)})

        @fake.route("PATCH", "/api/v1/rules/{rul_id}")
        def patch_rule(req: FakeRequest) -> FakeResponse:
            rule = self.rules.get(req.params["rul_id"])
            if rule is None:
                raise FakeHttpError(404, "not_found", "no rule")
            if req.body["base_revision"] != rule["revision"]:
                raise FakeHttpError(
                    409, "revision_conflict", "stale", details={"current": copy.deepcopy(rule)}
                )
            for key in ("enabled", "name"):
                if key in req.body:
                    rule[key] = req.body[key]
            rule["revision"] += 1
            return FakeResponse(200, {"rule": copy.deepcopy(rule)})

        # ---------------------------------------------------------------- emails
        @fake.route("POST", "/api/v1/applications/{app_id}/emails")
        def create_email(req: FakeRequest) -> FakeResponse:
            record = example("POST /api/v1/applications/{app_id}/emails")["email"]
            record.update(
                id=ids.new_id("eml"),
                user_id=self.user_id,
                application_id=req.params["app_id"],
                to_address=req.body["to"],
                subject=req.body["subject"],
                body_text=req.body["body_text"],
                attachment_file_ids=req.body["attachment_file_ids"],
                delivery=req.body["delivery"],
                status="draft",
                revision=1,
            )
            self.emails[record["id"]] = record
            domain = req.body["to"].rpartition("@")[2]
            free = domain in ("gmail.com", "yahoo.com", "outlook.com")
            review = (
                {
                    "payload_hash": self.review_hash,
                    "locale": req.body.get("locale") or "en",
                    "templated": {"subject": False, "body": False},
                    "recipient": {
                        "address": req.body["to"],
                        "domain": domain,
                        "employerDomains": ["acme.com"],
                        "freeMail": free,
                        "matchesEmployer": domain.endswith("acme.com"),
                        "ownDomain": False,
                        "confirmationRequired": free,
                        "confirmed": bool(req.body.get("recipient_confirmed")),
                    },
                    "warnings": ["free-mail recipient"] if free else [],
                    "ai_paragraph": None,
                }
                if self.review_hash
                else None
            )
            body: dict[str, Any] = {"email": copy.deepcopy(record)}
            if review:
                body["review"] = review  # leaf 2.9 adds the review to the draft response
            return FakeResponse(201, body)

        @fake.route("GET", "/api/v1/emails/{eml_id}")
        def get_email(req: FakeRequest) -> FakeResponse:
            record = self.emails.get(req.params["eml_id"])
            if record is None or record["user_id"] != req.user_id:
                raise FakeHttpError(404, "not_found", "no email")
            self.email_reads += 1
            digest = self.review_hash or email_payload_hash(
                to=record["to_address"],
                subject=record["subject"],
                body_text=record["body_text"],
                attachment_sha256=[
                    self.files[f][1]["sha256"]
                    for f in record["attachment_file_ids"]
                    if f in self.files
                ],
            )
            return FakeResponse(
                200, {"email": copy.deepcopy(record), "approval": None, "payload_hash": digest}
            )

        @fake.route("POST", "/api/v1/emails/{eml_id}/approve")
        def approve_email(req: FakeRequest) -> FakeResponse:
            record = self.emails[req.params["eml_id"]]
            record.update(
                status="approved", approved_at=self.now(), revision=record["revision"] + 1
            )
            response = example("POST /api/v1/emails/{eml_id}/approve")
            response["email"] = copy.deepcopy(record)
            response["approval"]["payload_hash"] = req.body["payload_hash"]
            response["application"] = copy.deepcopy(
                self.fake.entities[("application", record["application_id"])]
            )
            response["evidence"] = None
            self.decisions.append({"email": record["id"], **req.body})
            return FakeResponse(200, response)

        @fake.route("POST", "/api/v1/emails/{eml_id}/handed-off")
        def handed_off(req: FakeRequest) -> FakeResponse:
            record = self.emails[req.params["eml_id"]]
            self.handed_off.append({"email": record["id"], **req.body})
            app = self.fake.entities[("application", record["application_id"])]
            if req.body["sent_confirmed"]:
                record.update(status="handed_off", sent_at=req.body.get("sent_at") or self.now())
                app.update(submission_status="submitted_unverified", stage="applied")
            else:
                app["submission_status"] = "failed"
            record["revision"] += 1
            return FakeResponse(
                200,
                {
                    "email": copy.deepcopy(record),
                    "application": copy.deepcopy(app),
                    "evidence": None,
                },
            )

        # ---------------------------------------------------------------- applications
        @fake.route("GET", "/api/v1/applications/{app_id}")
        def application_detail(req: FakeRequest) -> FakeResponse:
            app = self.fake.entities.get(("application", req.params["app_id"]))
            if app is None or self.fake.entity_owner.get(("application", app["id"])) != req.user_id:
                raise FakeHttpError(404, "not_found", "no application")
            body = example("GET /api/v1/applications/{app_id}")
            body["application"] = copy.deepcopy(app)
            posting = self.posting_for(app)
            body["posting"] = copy.deepcopy(posting)
            user_job = self.user_jobs.get(app["user_job_id"]) or body["user_job"]
            user_job.update(id=app["user_job_id"], posting_id=posting["id"])
            body["user_job"] = copy.deepcopy(user_job)
            body["score"] = None
            body["cv_variants"] = [
                copy.deepcopy(v)
                for v in self.cv_variants.values()
                if v["application_id"] == app["id"]
            ]
            body["interviews"] = []
            body["offers"] = []
            body["approvals"] = [
                copy.deepcopy(a)
                for a in self.approvals.values()
                if a["application_id"] == app["id"]
            ]
            body["tasks"] = [
                self.task_view(t) for t in self.tasks.values() if t["application_id"] == app["id"]
            ]
            body["evidence"] = []
            body["emails"] = [
                copy.deepcopy(e) for e in self.emails.values() if e["application_id"] == app["id"]
            ]
            return FakeResponse(200, body)

        def card(app: dict[str, Any]) -> dict[str, Any]:
            base = example("GET /api/v1/board")["columns"][1]["cards"][0]
            posting = self.posting_for(app)
            base.update(
                {
                    k: app[k]
                    for k in (
                        "id",
                        "revision",
                        "user_job_id",
                        "legacy_job_id",
                        "stage",
                        "stage_changed_at",
                        "board_rank",
                        "submission_status",
                        "mode",
                        "priority",
                        "archived",
                        "follow_up_at",
                        "cv_variant_id",
                        "updated_at",
                    )
                }
            )
            base["follow_up_due"] = False
            base["posting"].update(
                id=posting["id"], title=posting["title"], company_name=posting["company_name"]
            )
            base["live_task"] = None
            base["next_interview_at"] = None
            score = self.scores.get(posting["id"])
            if score is None:
                base["score"] = None
            else:
                base["score"].update(posting_id=posting["id"], score=score)
            return base

        self.scores: dict[str, int] = {}
        self.card = card

        def my_apps(req: FakeRequest) -> list[dict[str, Any]]:
            return [
                a
                for (entity, _), a in self.fake.entities.items()
                if entity == "application"
                and self.fake.entity_owner.get(("application", a["id"])) == req.user_id
            ]

        @fake.route("GET", "/api/v1/board")
        def board(req: FakeRequest) -> FakeResponse:
            apps = [
                a
                for a in my_apps(req)
                if req.query.get("include_archived") == "1" or not a["archived"]
            ]
            columns = []
            for stage in (
                "saved",
                "preparing",
                "ready",
                "applied",
                "interviewing",
                "offer",
                "accepted",
                "rejected",
                "withdrawn",
            ):
                cards = [card(a) for a in apps if a["stage"] == stage]
                columns.append(
                    {"stage": stage, "cards": cards, "total": len(cards), "has_more": False}
                )
            counts = {
                "approvals_pending": 0,
                "inbox_new": 0,
                "follow_ups_due": 0,
                "unconfirmed": 0,
                "tasks_live": 0,
            }
            return FakeResponse(
                200,
                {
                    "columns": columns,
                    "counts": counts,
                    "cursor": len(self.fake.change_log),
                    "generated_at": self.now(),
                },
            )

        @fake.route("GET", "/api/v1/applications")
        def list_applications(req: FakeRequest) -> FakeResponse:
            apps = my_apps(req)
            if req.query.get("stage"):
                apps = [a for a in apps if a["stage"] == req.query["stage"]]
            if req.query.get("include_archived") != "1":
                apps = [a for a in apps if not a["archived"]]
            limit = int(req.query.get("limit", "50"))
            return FakeResponse(
                200, {"items": [card(a) for a in apps][:limit], "next_cursor": None}
            )

        @fake.route("PATCH", "/api/v1/applications/{app_id}")
        def patch_application(req: FakeRequest) -> FakeResponse:
            app = self.fake.entities.get(("application", req.params["app_id"]))
            if app is None:
                raise FakeHttpError(404, "not_found", "no application")
            if req.body["base_revision"] != app["revision"]:
                raise FakeHttpError(
                    409, "revision_conflict", "stale", details={"current": copy.deepcopy(app)}
                )
            for key in (
                "priority",
                "archived",
                "follow_up_at",
                "mode",
                "board_rank",
                "sections",
                "stage",
            ):
                if key in req.body:
                    app[key] = req.body[key]
            app["revision"] += 1
            self.fake.put_entity("application", app, req.user_id)
            return FakeResponse(200, {"application": copy.deepcopy(app)})

        @fake.route("POST", "/api/v1/applications/{app_id}/submission")
        def submission(req: FakeRequest) -> FakeResponse:
            app = self.fake.entities[("application", req.params["app_id"])]
            if req.body["base_revision"] != app["revision"]:
                raise FakeHttpError(
                    409, "revision_conflict", "stale", details={"current": copy.deepcopy(app)}
                )
            action = req.body["action"]
            app["submission_status"] = {
                "confirm": "submitted_verified",
                "deny": "failed",
                "mark_applied": "submitted_verified",
            }[action]
            if action in ("confirm", "mark_applied"):
                app["stage"] = "applied"
                app["submission_method"] = req.body.get("method", "manual")
            app["revision"] += 1
            self.fake.put_entity("application", app, req.user_id)
            return FakeResponse(200, {"application": copy.deepcopy(app), "evidence": None})

        @fake.route("POST", "/api/v1/applications/{app_id}/interviews")
        def add_interview(req: FakeRequest) -> FakeResponse:
            interview = example("POST /api/v1/applications/{app_id}/interviews")["interview"]
            interview.update(
                id=ids.new_id("ivw"), application_id=req.params["app_id"], kind=req.body["kind"]
            )
            self.interviews.append(req.body)
            return FakeResponse(201, {"interview": interview})

        @fake.route("POST", "/api/v1/applications/{app_id}/offers")
        def add_offer(req: FakeRequest) -> FakeResponse:
            offer = example("POST /api/v1/applications/{app_id}/offers")["offer"]
            offer.update(id=ids.new_id("ofr"), application_id=req.params["app_id"])
            self.offers.append(req.body)
            return FakeResponse(201, {"offer": offer})

        self.interviews: list[dict[str, Any]] = []
        self.offers: list[dict[str, Any]] = []

        @fake.route("DELETE", "/api/v1/applications/{app_id}")
        def delete_application(req: FakeRequest) -> FakeResponse:
            app = self.fake.entities.get(("application", req.params["app_id"]))
            if app is None:
                raise FakeHttpError(404, "not_found", "no application")
            if req.query.get("purge") == "1":
                self.fake.delete_entity("application", app["id"], req.user_id)
                return FakeResponse(
                    200, {"id": app["id"], "archived": False, "purged": True, "application": None}
                )
            app["archived"] = True
            app["revision"] += 1
            return FakeResponse(
                200,
                {
                    "id": app["id"],
                    "archived": True,
                    "purged": False,
                    "application": copy.deepcopy(app),
                },
            )

        @fake.route("GET", "/api/v1/applications/{app_id}/events")
        def list_events(req: FakeRequest) -> FakeResponse:
            items = [
                copy.deepcopy(e)
                for e in self.fake.events
                if e["application_id"] == req.params["app_id"]
            ]
            return FakeResponse(200, {"items": items, "next_cursor": None})

        # ------------------------------------------------------------ inbox / user jobs / scores
        @fake.route("GET", "/api/v1/inbox")
        def inbox(req: FakeRequest) -> FakeResponse:
            state_filter = req.query.get("state", "new")
            items = [
                copy.deepcopy(i) for i in self.inbox if i["user_job"]["inbox_state"] == state_filter
            ]
            return FakeResponse(200, {"items": items, "next_cursor": None})

        @fake.route("GET", "/api/v1/user-jobs/{ujb_id}")
        def user_job_detail(req: FakeRequest) -> FakeResponse:
            for item in self.inbox:
                if item["user_job"]["id"] == req.params["ujb_id"]:
                    return FakeResponse(
                        200,
                        {
                            "user_job": copy.deepcopy(item["user_job"]),
                            "posting": copy.deepcopy(item["posting"]),
                            "score": copy.deepcopy(item["score"]),
                            "application": None,
                        },
                    )
            raise FakeHttpError(404, "not_found", "no user job")

        @fake.route("POST", "/api/v1/user-jobs")
        def add_user_job(req: FakeRequest) -> FakeResponse:
            posting = self.add_posting(source_kind="custom_url", apply_url=req.body.get("url"))
            user_job = record_example("user_jobs")
            user_job.update(
                id=ids.new_id("ujb"),
                user_id=self.user_id,
                posting_id=posting["id"],
                origin="manual",
            )
            self.user_jobs[user_job["id"]] = user_job
            return FakeResponse(
                201, {"user_job": copy.deepcopy(user_job), "posting": copy.deepcopy(posting)}
            )

        @fake.route("POST", "/api/v1/applications")
        def create_application(req: FakeRequest) -> FakeResponse:
            app = self.fake.new_application(req.user_id, stage=req.body.get("stage", "saved"))
            stored = self.fake.entities[("application", app["id"])]
            stored["user_job_id"] = req.body["user_job_id"]
            if req.body.get("mode"):
                stored["mode"] = req.body["mode"]
            return FakeResponse(201, {"application": copy.deepcopy(stored)})

        @fake.route("POST", "/api/v1/scores:request")
        def scores_request(req: FakeRequest) -> FakeResponse:
            self.score_requests.append(req.body)
            values = req.body.get("posting_ids") or [
                self.user_jobs.get(u, {}).get("posting_id") or ids.new_id("pst")
                for u in req.body.get("user_job_ids") or []
            ]
            return FakeResponse(200, {"queued": values, "cached": []})

        @fake.route("GET", "/api/v1/scores/{posting_id}")
        def get_score(req: FakeRequest) -> FakeResponse:
            score = record_example("match_scores")
            score.update(posting_id=req.params["posting_id"], user_id=self.user_id, status="ready")
            return FakeResponse(200, {"score": score, "profile_version": 3})

        @fake.route("GET", "/api/v1/analytics/summary")
        def analytics_summary(_req: FakeRequest) -> FakeResponse:
            return FakeResponse(200, example("GET /api/v1/analytics/summary"))

        @fake.route("GET", "/api/v1/analytics/breakdown")
        def analytics_breakdown(_req: FakeRequest) -> FakeResponse:
            return FakeResponse(200, example("GET /api/v1/analytics/breakdown"))

    def _decide(self, approval: dict[str, Any], state: str, via: str, response: Any = None) -> None:
        approval.update(
            state=state,
            decided_via=via,
            decided_by_user_id=self.user_id,
            decided_at=self.now(),
            response=response,
            revision=approval["revision"] + 1,
        )
        task = self.tasks.get(str(approval.get("task_id")))
        if task is not None and task["state"] == "awaiting_approval":
            # leaf 2.7: a leased task keeps its lease (approve → running, reject → the cancel is
            # delivered by heartbeat and the device reports `cancelled`); a released one ends.
            if task["lease_id"] is None:
                task["state"] = "queued" if state == "approved" else "cancelled"
            elif state == "approved":
                task["state"] = "running"
            else:
                task["cancel_requested"] = True

    def add_inbox_item(self, *, state: str = "new", score: int | None = 80) -> dict[str, Any]:
        item = example("GET /api/v1/inbox")["items"][0]
        posting = self.add_posting()
        item["posting"] = copy.deepcopy(posting)
        item["user_job"].update(
            id=ids.new_id("ujb"), user_id=self.user_id, posting_id=posting["id"], inbox_state=state
        )
        if score is None:
            item["score"] = None
        elif item.get("score"):
            item["score"].update(posting_id=posting["id"], score=score)
        self.inbox.append(item)
        self.user_jobs[item["user_job"]["id"]] = item["user_job"]
        return item

    def add_rule(self, *, mode: str = "approval", enabled: bool = False) -> dict[str, Any]:
        rule = record_example("automation_rules")
        rule.update(
            id=ids.new_id("rul"), user_id=self.user_id, mode=mode, enabled=enabled, revision=1
        )
        self.rules[rule["id"]] = rule
        return copy.deepcopy(rule)

    def add_pending_approval(
        self,
        *,
        kind: str = "submit",
        payload: dict[str, Any] | None = None,
        payload_hash: str | None = None,
    ) -> dict[str, Any]:
        approval = example("GET /api/v1/approvals")["items"][0]
        approval.update(
            id=ids.new_id("apr"),
            user_id=self.user_id,
            kind=kind,
            state="pending",
            task_id=None,
            application_id=None,
        )
        if payload is not None:
            approval["payload"] = payload
        if payload_hash is not None:
            approval["payload_hash"] = payload_hash
        self.approvals[approval["id"]] = approval
        return copy.deepcopy(approval)


def install_binary(fake: FakeApi, cloud: CloudFake) -> None:
    """Route file content through `BinaryTransport` (every later Runtime uses it)."""
    fake.transport = BinaryTransport(cloud, fake.transport)  # type: ignore[assignment]


Hook = Callable[..., Any]
