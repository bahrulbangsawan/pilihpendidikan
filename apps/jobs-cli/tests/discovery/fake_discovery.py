"""A miniature of the server's discovery area (05 §4, 03 §4.3) on top of `FakeApi`.

Implements runs, `postings:batch` (fingerprint recompute, unchanged-only items that need
an existing link, `status_hint`), `complete` (missed runs for complete sources, closure at
2) and sources (list / patch) — enough to check the CLI side end to end.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pilih_jobs.contracts import ids
from pilih_jobs.contracts.fingerprint import FingerprintInput, fingerprint, primary_location
from tests.support.fake_api import FakeApi, FakeHttpError, FakeRequest, FakeResponse


@dataclass
class Posting:
    id: str
    fingerprint: str
    content_hash: str
    source_kind: str
    source_org: str | None
    source_id: str | None
    title: str
    status: str = "open"
    missed_runs: int = 0
    closed_by: str | None = None
    evidence: dict[str, Any] = field(default_factory=dict)


class FakeDiscovery:
    def __init__(self, fake: FakeApi, user_id: str) -> None:
        self.fake = fake
        self.user_id = user_id
        self.runs: dict[str, dict[str, Any]] = {}
        self.postings: dict[str, Posting] = {}
        self.linked: set[str] = set()
        self.seen: dict[str, set[str]] = {}
        self.outcomes: list[dict[str, Any]] = []
        self.batches: list[list[dict[str, Any]]] = []
        self.completes: list[dict[str, Any]] = []
        self.sources: dict[str, dict[str, Any]] = {}
        self.patches: list[dict[str, Any]] = []
        self._install()

    # ------------------------------------------------------------------ setup
    def add_source(
        self, adapter: str, config: dict[str, Any], label: str, *, enabled: bool = True
    ) -> dict[str, Any]:
        now = self.fake.now()
        record = {
            "id": ids.new_id("src"),
            "user_id": self.user_id,
            "adapter": adapter,
            "label": label,
            "config": config,
            "enabled": enabled,
            "schedule": None,
            "last_run_id": None,
            "last_success_at": None,
            "cursor_state": {},
            "revision": 1,
            "created_at": now,
            "updated_at": now,
        }
        self.sources[record["id"]] = record
        return record

    def _run_record(self, run: dict[str, Any]) -> dict[str, Any]:
        return {
            k: run[k]
            for k in (
                "id",
                "user_id",
                "device_id",
                "task_id",
                "sources",
                "status",
                "started_at",
                "finished_at",
                "stats",
                "errors",
                "engine_version",
                "revision",
            )
        }

    # ------------------------------------------------------------------ routes
    def _install(self) -> None:
        fake = self.fake

        @fake.route("POST", "/api/v1/discovery/runs")
        def create(req: FakeRequest) -> FakeResponse:
            body = req.body
            run = self.runs.get(body["id"])
            if run is None:
                run = {
                    "id": body["id"],
                    "user_id": req.user_id,
                    "device_id": body["device_id"],
                    "task_id": body.get("task_id"),
                    "sources": body["sources"],
                    "status": "running",
                    "started_at": body.get("started_at") or fake.now(),
                    "finished_at": None,
                    "stats": {},
                    "errors": [],
                    "engine_version": body["engine_version"],
                    "revision": 1,
                }
                self.runs[body["id"]] = run
                self.seen[body["id"]] = set()
            return FakeResponse(201, {"run": self._run_record(run)})

        @fake.route("POST", "/api/v1/discovery/runs/{run_id}/postings:batch")
        def batch(req: FakeRequest) -> FakeResponse:
            run_id = req.params["run_id"]
            if run_id not in self.runs:
                raise FakeHttpError(404, "not_found", "no such run")
            self.batches.append(req.body["items"])
            return FakeResponse(
                200, {"items": [self._item(run_id, item) for item in req.body["items"]]}
            )

        @fake.route("POST", "/api/v1/discovery/runs/{run_id}/complete")
        def complete(req: FakeRequest) -> FakeResponse:
            run = self.runs[req.params["run_id"]]
            body = req.body
            self.completes.append(body)
            closed = 0
            for source in body["complete_sources"]:
                for posting in self.postings.values():
                    matches = (
                        posting.source_id == source.get("source_id")
                        if source.get("source_id")
                        else (posting.source_kind, posting.source_org)
                        == (source["source_kind"], source["source_org"])
                    )
                    if (
                        not matches
                        or posting.status != "open"
                        or posting.fingerprint in self.seen[run["id"]]
                    ):
                        continue
                    posting.missed_runs += 1
                    if posting.missed_runs >= 2:
                        posting.status, posting.closed_by = "closed", "missed_runs"
                        closed += 1
            for entry in body.get("cursor_states") or []:
                if entry["source_id"] in self.sources:
                    self.sources[entry["source_id"]]["cursor_state"] = entry["cursor_state"]
            run.update(
                status=body["status"],
                finished_at=body.get("finished_at"),
                stats=body["stats"],
                errors=body["errors"],
                revision=run["revision"] + 1,
            )
            return FakeResponse(200, {"run": self._run_record(run), "closed_postings": closed})

        @fake.route("GET", "/api/v1/sources")
        def sources(req: FakeRequest) -> FakeResponse:
            return FakeResponse(200, {"items": list(self.sources.values()), "next_cursor": None})

        @fake.route("PATCH", "/api/v1/sources/{src_id}")
        def patch(req: FakeRequest) -> FakeResponse:
            record = self.sources[req.params["src_id"]]
            if req.body["base_revision"] != record["revision"]:
                raise FakeHttpError(409, "revision_conflict", "stale", details={"current": record})
            self.patches.append(req.body)
            for key in ("enabled", "config", "cursor_state", "label"):
                if key in req.body:
                    record[key] = req.body[key]
            record["revision"] += 1
            return FakeResponse(200, {"source": record})

    def _item(self, run_id: str, item: dict[str, Any]) -> dict[str, Any]:
        ref = item["client_ref"]
        fp = item["fingerprint"]
        if "title" not in item:  # unchanged-only
            posting = self.postings.get(fp)
            if posting is None or fp not in self.linked:
                return self._out(
                    ref,
                    "invalid",
                    errors=[{"code": "unknown_fingerprint", "message": "send in full"}],
                )
            self.seen[run_id].add(fp)
            posting.missed_runs = 0
            outcome = "unchanged"
            if item.get("status_hint") == "closed" and posting.status == "open":
                posting.status, posting.closed_by = "closed", "status_hint"
                posting.evidence = item.get("status_evidence") or {}
                outcome = "updated"
            return self._out(ref, outcome, posting_id=posting.id)
        recomputed = fingerprint(
            FingerprintInput(
                source_kind=item["source_kind"],
                title=item["title"],
                source_org=item.get("source_org"),
                source_job_ref=item.get("source_job_ref"),
                company_domain=item.get("company_domain"),
                location_primary=primary_location(item.get("locations")),
                apply_url=item.get("apply_url"),
                canonical_url=item.get("canonical_url"),
            )
        )
        if recomputed != fp:
            return self._out(
                ref, "invalid", errors=[{"code": "fingerprint_mismatch", "message": recomputed}]
            )
        posting = self.postings.get(fp)
        self.seen[run_id].add(fp)
        if posting is None:
            posting = Posting(
                ids.new_id("pst"),
                fp,
                item["content_hash"],
                item["source_kind"],
                item.get("source_org"),
                item.get("source_id"),
                item["title"],
            )
            self.postings[fp] = posting
        posting.missed_runs = 0
        if fp not in self.linked:
            self.linked.add(fp)
            outcome = "new"
        elif posting.content_hash != item["content_hash"]:
            posting.content_hash = item["content_hash"]
            outcome = "updated"
        else:
            outcome = "unchanged"
        return self._out(ref, outcome, posting_id=posting.id, user_job_id=ids.new_id("ujb"))

    def _out(self, ref: str, outcome: str, **extra: Any) -> dict[str, Any]:
        result = {"client_ref": ref, "outcome": outcome, **extra}
        self.outcomes.append(result)
        return result

    def count(self, outcome: str) -> int:
        return sum(1 for o in self.outcomes if o["outcome"] == outcome)
