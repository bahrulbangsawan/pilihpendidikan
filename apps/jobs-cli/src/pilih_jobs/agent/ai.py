"""The four AI calls, always through `LeaseChannel.ai` → `apps/api` (D-12, 05 §9, 19 §4–§9).

The CLI never holds a provider key. Every request is validated against the generated
contract models before it leaves, carries `lease_ref`, and counts against the 25-call
budget; every response is validated before the agent reads it. Bodies are serialised with
`contracts.wire.to_wire`: an unset optional member is absent, never `null` (the api's Zod
schemas refuse `null` unless the member is nullable), required nullable members keep it.
Errors are classified by `agent.channel` (lease lost → stop; AI unavailable → pause
`ai_unavailable`).

- `page-classify` sends the observation and, whenever available, a masked viewport JPEG
  (≤ 1.5 MB); the server tries text first and uses the image only below 0.85 — one call.
- `next-action` sends ≤ 38 enumerated candidates (ids unique, never `pause`/`stop`).
- `field-plan` sends the observation, the fact keys wanted and the file slots — never fact
  values (05 §9); the server injects facts and validates the plan.
- `verify-submission` sends the redacted excerpt, the masked screenshot and the signals.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, Final, TypeVar

from pydantic import BaseModel, ValidationError

from pilih_jobs.agent.budget import Budget
from pilih_jobs.agent.channel import classify_channel_error
from pilih_jobs.agent.steplog import AttemptLog
from pilih_jobs.agent.types import LeaseChannel
from pilih_jobs.browser.errors import LeaseLostError
from pilih_jobs.contracts._generated.agent import (
    FieldPlan,
    FieldPlanRequest,
    NextActionRequest,
    NextActionResponse,
    PageClassifyRequest,
    PageClassifyResponse,
    VerifySubmissionRequest,
    VerifySubmissionResponse,
)
from pilih_jobs.contracts.wire import clip_utf16, to_wire

MAX_CANDIDATES: Final = 38
AI_PROMPT_VERSION: Final = "cli-agent/1"

ResponseT = TypeVar("ResponseT", bound=BaseModel)


class AiUnavailableError(Exception):
    """503 upstream_unavailable / 429 ai_budget_exhausted / AI consent missing / bad answer."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class AiOfflineError(Exception):
    """The AI call could not reach the server (transport failure)."""


class AiClient:
    def __init__(
        self,
        channel: LeaseChannel,
        *,
        task_id: str,
        lease_id: str,
        budget: Budget,
        log: AttemptLog,
    ) -> None:
        self.channel = channel
        self.task_id = task_id
        self.lease_id = lease_id
        self.budget = budget
        self.log = log

    @property
    def lease_ref(self) -> dict[str, str]:
        return {"task_id": self.task_id, "lease_id": self.lease_id}

    async def _call(
        self,
        endpoint: str,
        request: BaseModel,
        response_model: type[ResponseT],
        *,
        step: int,
        summary: Callable[[ResponseT], object],
    ) -> ResponseT:
        if self.channel.lost.is_set():
            raise LeaseLostError("The lease was lost.")
        self.budget.charge_ai()
        body = to_wire(request)
        started = time.monotonic()
        try:
            raw = await self.channel.ai(endpoint, body)
        except Exception as exc:
            kind = classify_channel_error(exc)
            self.log.event(
                "ai_call",
                step=step,
                endpoint=endpoint,
                ok=False,
                error=kind,
                latency_ms=int((time.monotonic() - started) * 1000),
                prompt_version=AI_PROMPT_VERSION,
            )
            if kind == "lease_lost":
                raise LeaseLostError("The lease was lost during an AI call.") from exc
            if kind == "offline":
                raise AiOfflineError(str(exc)) from exc
            raise AiUnavailableError(kind if kind != "other" else type(exc).__name__) from exc
        latency = int((time.monotonic() - started) * 1000)
        try:
            response = response_model.model_validate(raw)
        except ValidationError as exc:
            self.log.event(
                "ai_call", step=step, endpoint=endpoint, ok=False, error="invalid_response"
            )
            raise AiUnavailableError("invalid_response") from exc
        self.log.event(
            "ai_call",
            step=step,
            endpoint=endpoint,
            ok=True,
            latency_ms=latency,
            answer=summary(response),
            prompt_version=AI_PROMPT_VERSION,
        )
        return response

    async def classify(self, observation: dict[str, Any], *, step: int) -> PageClassifyResponse:
        request = PageClassifyRequest.model_validate(
            {"lease_ref": self.lease_ref, "observation": observation}
        )
        return await self._call(
            "page-classify",
            request,
            PageClassifyResponse,
            step=step,
            summary=lambda r: f"page_kind={r.page_kind}@{r.confidence:.2f}",
        )

    async def next_action(
        self,
        *,
        observation_id: str,
        step: int,
        page_kind: str,
        state: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> NextActionResponse:
        request = NextActionRequest.model_validate(
            {
                "lease_ref": self.lease_ref,
                "observation_id": observation_id,
                "step": step,
                "page_kind": page_kind,
                "state": state,
                "candidates": candidates[:MAX_CANDIDATES],
            }
        )
        return await self._call(
            "next-action",
            request,
            NextActionResponse,
            step=step,
            summary=lambda r: f"choice={r.choice}@{(r.confidence.root if r.confidence else 0):.2f}",
        )

    async def field_plan(
        self,
        observation: dict[str, Any],
        *,
        step: int,
        fact_keys: list[str] | None,
        file_slots: dict[str, bool],
        attempt: int = 1,
    ) -> FieldPlan:
        request = FieldPlanRequest.model_validate(
            {
                "lease_ref": self.lease_ref,
                "observation": observation,
                "fact_keys": fact_keys,
                "file_slots": file_slots,
                "attempt": attempt,
            }
        )
        return await self._call(
            "field-plan",
            request,
            FieldPlan,
            step=step,
            summary=lambda r: {"items": len(r.items), "missing": len(r.missing)},
        )

    async def verify(
        self,
        *,
        step: int,
        observation_id: str | None,
        final_url: str,
        page_title: str,
        text_excerpt: str,
        screenshot_jpeg_b64: str | None,
        signals: dict[str, Any],
    ) -> VerifySubmissionResponse:
        request = VerifySubmissionRequest.model_validate(
            {
                "lease_ref": self.lease_ref,
                "observation_id": observation_id,
                "final_url": final_url,
                "page_title": clip_utf16(page_title, 200),
                "text_excerpt": clip_utf16(text_excerpt, 2048),
                "screenshot_jpeg_b64": screenshot_jpeg_b64,
                "signals": signals,
            }
        )
        return await self._call(
            "verify-submission",
            request,
            VerifySubmissionResponse,
            step=step,
            summary=lambda r: f"verdict={r.verdict}",
        )
