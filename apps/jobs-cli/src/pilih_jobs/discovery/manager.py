"""`DiscoveryManager` (15 §3, §15; 20 §7): one discovery run end to end.

1. `--reset-adaptive` (local only), then source resolution — excluded sources (D-17) and
   forbidden features are refused before any request;
2. the run is created locally (`run_<ULID>`) and `POST /discovery/runs` is queued in the
   outbox (key `run:<id>:create`), with the `checkpoints` row in the same transaction;
3. sources run concurrently through `ScraplingJobEngine` (politeness is per domain);
   each finished (or interrupted) source queues its items as `postings:batch` entries of
   ≤ 100 items / < 1 MB that depend on the run create;
4. `--check-tracked` re-checks tracked postings (15 §12);
5. `complete` is queued last, listing only fully enumerated sources and their new
   `cursor_state`; then the outbox is flushed when online. `--dry-run` writes nothing.

A first Ctrl+C (`cancel`) stops scheduling, lets in-flight requests finish for up to
10 s, and still queues the items found and a `complete` (status `cancelled`/`partial`).
"""

from __future__ import annotations

import asyncio
import json
import shutil
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final

from pilih_jobs.adapters import ADAPTERS
from pilih_jobs.api.errors import ApiError, NetworkError
from pilih_jobs.contracts import ids
from pilih_jobs.contracts.index import model
from pilih_jobs.discovery.engine.adaptive import AdaptiveStore, identifier_prefix
from pilih_jobs.discovery.errors import ERROR_CLASSES, DiscoveryError, PolicyViolation
from pilih_jobs.discovery.expiry import ExpiryResult, check_tracked, tracked_postings
from pilih_jobs.discovery.items import PreparedItem, engine_versions
from pilih_jobs.discovery.jsonutil import objs
from pilih_jobs.discovery.runner import (
    DRIFT_KV,
    RunnerSettings,
    SourceOutcome,
    SourceRunner,
)
from pilih_jobs.discovery.seen import LocalSeenCache, RunDeduper
from pilih_jobs.discovery.sources import (
    CURSOR_KV,
    DISABLED_KV,
    ResolvedSource,
    adhoc_source,
    check_url_allowed,
    from_record,
    load_configured_sources,
    parse_source_arg,
)
from pilih_jobs.discovery.sync import run_outcomes
from pilih_jobs.errors import NotAuthenticatedError, NotFoundError, UsageError
from pilih_jobs.logging import StepLog, get_logger, log_event
from pilih_jobs.paths import Paths, resolve_paths
from pilih_jobs.sync.flusher import OutboxFlusher
from pilih_jobs.sync.outbox import PRIORITY_DEFAULT, PRIORITY_DISCOVERY

if TYPE_CHECKING:
    from pilih_jobs.discovery import DiscoveryOptions, DiscoveryRunResult, DiscoveryRuntime
    from pilih_jobs.discovery.types import DiscoveryEngine

_log = get_logger("discovery.manager")

BATCH_MAX_ITEMS: Final = 100
BATCH_MAX_BYTES: Final = 900_000
MAX_RUN_ERRORS: Final = 50
SOURCE_CONCURRENCY: Final = 4
CANCEL_GRACE_S: Final = 10.0
LOCAL_RUNS_KEPT: Final = 50
CLOCK_STEP_MS: Final = 5_000
#: A single URL is not an enumeration: never reported as complete (no false closures).
NEVER_COMPLETE_KINDS: Final = frozenset({"custom_url"})
WORKDAY_DISABLE: Final[dict[str, str]] = {
    "challenge_detected": "challenge",
    "access_denied": "access_denied",
    "rate_limited": "rate_limited",
}


@dataclass
class _Totals:
    pages: int = 0
    found: int = 0
    new: int = 0
    updated: int = 0
    unchanged: int = 0
    duplicates: int = 0
    invalid: int = 0
    errors_by_class: Counter[str] = field(default_factory=lambda: Counter[str]())
    selector_drift: Counter[str] = field(default_factory=lambda: Counter[str]())


class DiscoveryManager:
    def __init__(
        self,
        options: DiscoveryOptions,
        ctx: DiscoveryRuntime,
        *,
        engine_factory: Callable[[Paths, bool, bool], DiscoveryEngine] | None = None,
    ) -> None:
        self.options = options
        self.ctx = ctx
        self.runtime = ctx.runtime
        self.paths: Paths = ctx.runtime.paths if ctx.runtime is not None else resolve_paths()
        self.db = ctx.outbox.db
        self.issuer = ctx.outbox.issuer
        self.outbox = ctx.outbox
        self.dry_run = options.dry_run
        self.run_id = ids.new_id("run")
        self.create_key = f"run:{self.run_id}:create"
        self.seen = LocalSeenCache(self.db, self.issuer)
        self.deduper = RunDeduper()
        self._batch_no = 0
        self._enqueued: dict[int, int] = {}
        self._engine_factory = engine_factory
        self._step_log: StepLog | None = None
        self._started_at = ids.now_ms()
        self._extra_errors: list[dict[str, Any]] = []

    # ------------------------------------------------------------------ events
    def emit(self, event: dict[str, Any]) -> None:
        payload = {"ts": ids.now_ms(), **event}
        if self._step_log is not None:
            try:
                self._step_log.write(str(payload.get("type")), **payload)
            except OSError:
                self._step_log = None
        self.ctx.emit(payload)

    # ------------------------------------------------------------------ settings
    @property
    def config(self) -> Any:
        return self.runtime.config if self.runtime is not None else None

    def _allow_browser(self) -> bool:
        cfg = self.config
        return bool(cfg is not None and cfg.discovery.allow_browser)

    def _max_pages(self) -> int:
        cfg = self.config
        configured = int(cfg.discovery.max_pages) if cfg is not None else 50
        wanted = self.options.max_pages or configured
        if wanted < 1:
            raise UsageError("--max-pages must be at least 1")
        return max(1, min(wanted, configured, 50))

    def _device_id(self) -> str | None:
        if self.runtime is not None:
            account = self.runtime.account()
            if account is not None and account.device_id:
                return account.device_id
        row = self.db.account(self.issuer)
        value = row["device_id"] if row is not None else None
        return str(value) if value else None

    # ------------------------------------------------------------------ sources
    async def _configured(self) -> list[dict[str, Any]]:
        return await load_configured_sources(self.ctx.api, self.db, self.issuer)

    async def resolve_sources(self) -> list[ResolvedSource]:
        options = self.options
        allow_browser = self._allow_browser()
        explicit: list[str | tuple[str, str]] = [parse_source_arg(s) for s in options.sources]
        if options.url:
            check_url_allowed(options.url)
        records: list[dict[str, Any]] | None = None
        task_records = objs(options.source_records)
        if task_records:
            records = task_records
        resolved: list[ResolvedSource] = []
        for entry in explicit:
            if isinstance(entry, str):
                if records is None:
                    records = await self._configured()
                record = next((r for r in records if r.get("id") == entry), None)
                if record is None:
                    raise NotFoundError(f"No job source {entry} (run `pilih-jobs sync` first?).")
                resolved.append(from_record(record, self.db, allow_browser=allow_browser))
            else:
                adapter_id, org = entry
                resolved.append(
                    adhoc_source(
                        adapter_id,
                        org,
                        self.db,
                        self.issuer,
                        private=options.private,
                        allow_browser=allow_browser,
                    )
                )
        if options.url:
            resolved.append(
                adhoc_source(
                    "custom_url",
                    options.url,
                    self.db,
                    self.issuer,
                    private=options.private,
                    allow_browser=False,
                )
            )
        if options.all_sources or (task_records and not explicit):
            if records is None:
                records = await self._configured()
            for record in records:
                if not record.get("enabled", True) and not task_records:
                    continue
                if any(r.source_id == record.get("id") for r in resolved):
                    continue
                try:
                    resolved.append(from_record(record, self.db, allow_browser=allow_browser))
                except PolicyViolation as exc:
                    self.emit(
                        {
                            "type": "warning",
                            "source": str(record.get("label")),
                            "message": exc.message,
                        }
                    )
        keys: set[str] = set()
        unique: list[ResolvedSource] = []
        for source in resolved:
            if source.key in keys:
                continue
            keys.add(source.key)
            unique.append(source)
        return unique

    # ------------------------------------------------------------------ adaptive reset
    async def reset_adaptive(self, target: str) -> dict[str, Any]:
        parsed = parse_source_arg(target)
        if isinstance(parsed, str):
            records = await self._configured()
            record = next((r for r in records if r.get("id") == parsed), None)
            if record is None:
                raise NotFoundError(f"No job source {parsed}.")
            source = from_record(record, self.db, allow_browser=False)
        else:
            source = adhoc_source(
                parsed[0], parsed[1], self.db, self.issuer, private=False, allow_browser=False
            )
        prefix = identifier_prefix(source.adapter.id, source.ref.org)
        store = AdaptiveStore(self.paths.scrapling_dir / "adaptive.db")
        deleted = store.reset(prefix)
        self.db.kv_delete(f"{DRIFT_KV}{source.adapter.id}:{source.ref.org.lower()}:fields")
        return {"source": source.key, "prefix": prefix, "deleted": deleted}

    # ------------------------------------------------------------------ outbox writes
    def _record_run_start(
        self, sources: list[ResolvedSource], device_id: str, extra: list[dict[str, Any]]
    ) -> None:
        entries: list[dict[str, Any]] = [
            {"source_id": s.source_id, "adapter": s.adapter.id, "label": s.label[:200]}
            if s.source_id
            else {"adapter": s.adapter.id, "label": s.label[:200]}
            for s in sources
        ]
        body: dict[str, Any] = {
            "id": self.run_id,
            "sources": [*entries, *extra][:100],
            "device_id": device_id,
            "engine_version": self._engine_version(),
            "started_at": self._started_at,
        }
        if self.options.task_id:
            body["task_id"] = self.options.task_id
        model("CreateRunRequest").model_validate(body)
        run_dir = self.paths.run_dir(self.run_id)
        log_path = run_dir / "events.jsonl"
        with self.db.transaction() as conn:
            self.outbox.enqueue(
                "POST",
                "/api/v1/discovery/runs",
                body,
                ordering_key=f"run:{self.run_id}",
                priority=PRIORITY_DISCOVERY,
                idempotency_key=self.create_key,
            )
            conn.execute(
                "INSERT OR REPLACE INTO checkpoints(key, kind, data, updated_at) VALUES(?,?,?,?)",
                (
                    f"run:{self.run_id}",
                    "discovery_run",
                    json.dumps({"status": "running", "batches": 0, "sources": len(sources)}),
                    ids.now_ms(),
                ),
            )
            conn.execute(
                "INSERT OR REPLACE INTO runs(id, kind, started_at, status, log_path) "
                "VALUES(?,?,?,?,?)",
                (self.run_id, "discover", self._started_at, "running", str(log_path)),
            )
        self._step_log = StepLog(log_path)

    @staticmethod
    def _engine_version() -> str:
        versions = engine_versions()
        parts = [f"pilih-jobs {versions['pilih_jobs']}"]
        if "scrapling" in versions:
            parts.append(f"scrapling {versions['scrapling']}")
        return "; ".join(parts)

    def _bodies(self, outcome: SourceOutcome) -> list[dict[str, Any]]:
        start = self._enqueued.get(id(outcome), 0)
        pending = outcome.items[start:]
        self._enqueued[id(outcome)] = len(outcome.items)
        return [item.body if isinstance(item, PreparedItem) else item for item in pending]

    def _enqueue_items(self, bodies: list[dict[str, Any]]) -> int:
        if self.dry_run or not bodies:
            return 0
        chunks: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        size = 0
        for body in bodies:
            encoded = len(
                json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            )
            if current and (len(current) >= BATCH_MAX_ITEMS or size + encoded > BATCH_MAX_BYTES):
                chunks.append(current)
                current, size = [], 0
            current.append(body)
            size += encoded + 1
        if current:
            chunks.append(current)
        path = f"/api/v1/discovery/runs/{self.run_id}/postings:batch"
        with self.db.transaction() as conn:
            for chunk in chunks:
                self._batch_no += 1
                self.outbox.enqueue(
                    "POST",
                    path,
                    {"items": chunk},
                    ordering_key=f"run:{self.run_id}",
                    priority=PRIORITY_DISCOVERY,
                    depends_on=self.create_key,
                    idempotency_key=f"run:{self.run_id}:batch:{self._batch_no}",
                )
            conn.execute(
                "UPDATE checkpoints SET data = ?, updated_at = ? WHERE key = ?",
                (
                    json.dumps({"status": "running", "batches": self._batch_no}),
                    ids.now_ms(),
                    f"run:{self.run_id}",
                ),
            )
        return len(chunks)

    def _after_source(self, outcome: SourceOutcome) -> None:
        """Queue a finished/interrupted source's items and bookkeeping (sync sqlite)."""
        self._enqueue_items(self._bodies(outcome))
        if self.dry_run:
            return
        source = outcome.source
        if outcome.complete and outcome.stop is None:
            self.seen.set_last_run(source.key, outcome.fingerprints)
            state = {"saved_at": ids.now_ms(), "state": source.cursor.to_dict()}
            key = (
                f"{CURSOR_KV}{source.source_id}"
                if source.source_id
                else f"{CURSOR_KV}{self.issuer}:{source.key}"
            )
            self.db.kv_set_json(key, state)
        stop = outcome.stop
        if (
            stop is not None
            and source.adapter.id == "workday"
            and stop.error_class in WORKDAY_DISABLE
            and source.source_id
        ):
            reason = WORKDAY_DISABLE[stop.error_class]
            self.db.kv_set(f"{DISABLED_KV}{source.source_id}", reason)
            if source.revision is not None:
                self.outbox.enqueue(
                    "PATCH",
                    f"/api/v1/sources/{source.source_id}",
                    {
                        "base_revision": source.revision,
                        "enabled": False,
                        "config": {**source.config, "disabled_reason": reason},
                    },
                    ordering_key=f"source:{source.source_id}",
                    kind="conditional",
                    priority=PRIORITY_DEFAULT,
                    idempotency_key=f"run:{self.run_id}:disable:{source.source_id}",
                )
            self.emit(
                {
                    "type": "warning",
                    "source": source.key,
                    "message": f"Workday tenant disabled after {stop.error_class} (15 §14.3)",
                }
            )

    # ------------------------------------------------------------------ the run
    def _create_engine(self) -> DiscoveryEngine:
        headless = True
        cfg = self.config
        if cfg is not None:
            headless = "discover" in cfg.browser.headless_for
        if self._engine_factory is not None:
            return self._engine_factory(self.paths, self._allow_browser(), headless)
        from pilih_jobs.discovery import clock as clock_module
        from pilih_jobs.discovery.engine import ScraplingJobEngine

        return ScraplingJobEngine(
            data_dir=self.paths.data_dir,
            cache_dir=self.paths.cache_dir,
            clock=clock_module.default_engine_clock(),
            allow_browser=self._allow_browser(),
            headless=headless,
        )

    def _crawl_dir(self, source: ResolvedSource) -> Path | None:
        if self.dry_run or source.source_id is None or source.adapter.id != "generic_listing":
            return None
        return self.paths.crawl_dir(source.source_id)

    async def _run_source(
        self, runner: SourceRunner, outcome: SourceOutcome, gate: asyncio.Semaphore
    ) -> None:
        try:
            async with gate:
                if self.ctx.cancel.is_set():
                    outcome.cancelled = True
                    return
                await runner.run()
        except asyncio.CancelledError:
            outcome.cancelled = True
            raise
        except Exception as exc:  # noqa: BLE001 - a bug in one source must not lose the run
            log_event(_log, "discovery_source_crash", f"{type(exc).__name__}: {exc}", level=40)
            outcome.stop = DiscoveryError(
                "unsupported_content", f"internal error: {type(exc).__name__}"
            )
        finally:
            self._after_source(outcome)

    async def _run_all(self, runners: list[tuple[SourceRunner, SourceOutcome]]) -> None:
        gate = asyncio.Semaphore(SOURCE_CONCURRENCY)
        tasks = [asyncio.create_task(self._run_source(r, o, gate)) for r, o in runners]
        if not tasks:
            return
        waiter = asyncio.create_task(self.ctx.cancel.wait())
        pending: set[asyncio.Task[Any]] = set(tasks)
        try:
            while pending:
                done, _ = await asyncio.wait(
                    pending | {waiter}, return_when=asyncio.FIRST_COMPLETED
                )
                pending -= done
                if waiter in done:
                    if pending:
                        _, late = await asyncio.wait(pending, timeout=CANCEL_GRACE_S)
                        for task in late:
                            task.cancel()
                        await asyncio.gather(*late, return_exceptions=True)
                    pending = set()
        finally:
            waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def run(self) -> DiscoveryRunResult:
        from pilih_jobs.discovery import DiscoveryRunResult

        reset: dict[str, Any] | None = None
        if self.options.reset_adaptive:
            reset = await self.reset_adaptive(self.options.reset_adaptive)
        sources = await self.resolve_sources()
        wants_work = bool(sources) or self.options.check_tracked
        if not wants_work:
            if reset is not None:
                return DiscoveryRunResult(
                    run_id="", status="completed", stats={"adaptive_reset": reset}
                )
            if self.options.all_sources:
                raise UsageError("No enabled job sources; add one in the web app (Sources).")
            raise UsageError("Nothing to discover: pass --source, --all, --url or --check-tracked.")
        device_id = self._device_id()
        if self.options.check_tracked and (device_id is not None or self.dry_run):
            await self._refresh_tracked()
        if not self.dry_run:
            if device_id is None:
                raise NotAuthenticatedError(
                    "Discovery uploads need a signed-in device. Run `pilih-jobs login`, or "
                    "use --dry-run to only look."
                )
            extra = self._check_entries() if self.options.check_tracked else []
            self._record_run_start(sources, device_id, extra)
        engine = self._create_engine()
        max_pages = self._max_pages()
        outcomes: list[SourceOutcome] = []
        runners: list[tuple[SourceRunner, SourceOutcome]] = []
        for source in sources:
            outcome = SourceOutcome(source=source)
            outcomes.append(outcome)
            runner = SourceRunner(
                source,
                engine=engine,
                settings=RunnerSettings(
                    run_id=self.run_id,
                    device_id=device_id,
                    max_pages=max_pages,
                    keywords=self.options.keywords,
                    location=self.options.location,
                    crawl_dir=self._crawl_dir(source),
                    dry_run=self.dry_run,
                ),
                seen=self.seen,
                deduper=self.deduper,
                db=self.db,
                cancel=self.ctx.cancel,
                emit=self.emit,
                now_ms=ids.now_ms,
                outcome=outcome,
            )
            runners.append((runner, outcome))
        expiry: ExpiryResult | None = None
        cancelled_hard = False
        try:
            await self._run_all(runners)
            if self.options.check_tracked and not self.ctx.cancel.is_set():
                expiry = await self._check_tracked(engine)
        except asyncio.CancelledError:
            cancelled_hard = True
            raise
        finally:
            await engine.aclose()
            if cancelled_hard:
                self._finish(outcomes, expiry, flush=False)
        result = self._finish(outcomes, expiry, flush=True)
        status, stats, errors = result
        sync_report = await self._flush() if not self.dry_run else None
        if sync_report is not None:
            stats["sync"] = sync_report
        if reset is not None:
            stats["adaptive_reset"] = reset
        self.emit({"type": "run_finished", "run_id": self.run_id, "status": status, "stats": stats})
        return DiscoveryRunResult(run_id=self.run_id, status=status, stats=stats, errors=errors)

    async def _refresh_tracked(self) -> None:
        """Pull the change feed so the tracked postings are current (offline: the cache)."""
        if self.ctx.api is None:
            return
        try:
            if self.runtime is not None:
                from pilih_jobs.sync.engine import SyncEngine

                await SyncEngine(self.db, self.issuer, self.ctx.api).pull()
            else:
                from pilih_jobs.sync.puller import ChangeFeedPuller

                await ChangeFeedPuller(self.db, self.issuer, self.ctx.api).pull()
        except (NetworkError, ApiError) as exc:
            self.emit(
                {
                    "type": "warning",
                    "source": "check-tracked",
                    "message": f"offline cache used ({exc.message})",
                }
            )

    def _check_entries(self) -> list[dict[str, Any]]:
        """Run `sources[]` entries for the adapters `--check-tracked` will use."""
        kinds = sorted({p.source_kind for p in tracked_postings(self.db, self.issuer)})
        adapters = [k if k in ADAPTERS else "custom_url" for k in kinds] or ["custom_url"]
        return [{"adapter": a, "label": "check-tracked"} for a in dict.fromkeys(adapters)]

    async def _check_tracked(self, engine: DiscoveryEngine) -> ExpiryResult:
        self.emit({"type": "source_started", "source": "check-tracked", "run_id": self.run_id})
        result = await check_tracked(
            engine=engine,
            db=self.db,
            issuer=self.issuer,
            run_id=self.run_id,
            now_ms=ids.now_ms,
            emit=self.emit,
            cancel=self.ctx.cancel,
            record=not self.dry_run,
        )
        fresh = [item for item in result.items if self.deduper.add(str(item["fingerprint"]))]
        self._enqueue_items(fresh)
        self.emit({"type": "source_finished", "source": "check-tracked", "stats": result.stats()})
        return result

    # ------------------------------------------------------------------ completion
    def _status(self, outcomes: list[SourceOutcome], expiry: ExpiryResult | None) -> str:
        cancelled = self.ctx.cancel.is_set() or any(o.cancelled for o in outcomes)
        produced = any(o.produced for o in outcomes) or bool(expiry and expiry.items)
        stopped = [o for o in outcomes if o.stop is not None]
        finished_ok = [o for o in outcomes if o.stop is None and not o.cancelled]
        if cancelled:
            return "partial" if produced or finished_ok else "cancelled"
        if outcomes and not finished_ok and not produced:
            return "failed"
        if stopped:
            return "partial"
        return "completed"

    def _totals(self, outcomes: list[SourceOutcome]) -> _Totals:
        totals = _Totals()
        for outcome in outcomes:
            stats = outcome.stats
            totals.pages += stats.pages
            totals.found += stats.found
            totals.new += stats.new
            totals.updated += stats.updated
            totals.unchanged += stats.unchanged
            totals.duplicates += stats.duplicates
            totals.invalid += stats.invalid
            totals.errors_by_class.update(stats.errors_by_class)
            totals.selector_drift.update(stats.selector_drift)
        return totals

    def _run_errors(self, outcomes: list[SourceOutcome]) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        for outcome in outcomes:
            items = [*outcome.errors, *([outcome.stop] if outcome.stop else [])]
            for error in items:
                entry: dict[str, Any] = {
                    "source": outcome.source.key[:200],
                    "error_class": error.error_class,
                    "message": error.detail[:500],
                    "at": ids.now_ms(),
                }
                if outcome.source.source_id:
                    entry["source_id"] = outcome.source.source_id
                if error.http_status is not None:
                    entry["http_status"] = error.http_status
                if error.url:
                    entry["url"] = error.url[:2048]
                errors.append(entry)
        errors.extend(self._extra_errors)
        return errors[:MAX_RUN_ERRORS]

    def _finish(
        self, outcomes: list[SourceOutcome], expiry: ExpiryResult | None, *, flush: bool
    ) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
        for outcome in outcomes:
            if self._enqueued.get(id(outcome), 0) < len(outcome.items):
                self._after_source(outcome)
        status = self._status(outcomes, expiry)
        totals = self._totals(outcomes)
        if expiry is not None:
            totals.found += expiry.checked
        run_stats: dict[str, Any] = {
            "pages": totals.pages,
            "postings_found": totals.found,
            "new": totals.new,
            "updated": totals.updated,
            "unchanged": totals.unchanged,
            "duplicates": totals.duplicates,
            "invalid": totals.invalid,
        }
        error_counts = {
            k: v for k, v in totals.errors_by_class.items() if v > 0 and k in ERROR_CLASSES
        }
        if error_counts:
            run_stats["errors_by_class"] = error_counts
        if totals.selector_drift:
            run_stats["selector_drift"] = dict(totals.selector_drift)
        errors = self._run_errors(outcomes)
        complete_sources: list[dict[str, Any]] = []
        cursor_states: list[dict[str, Any]] = []
        for outcome in outcomes:
            if not outcome.complete or outcome.stop is not None or outcome.cancelled:
                continue
            if outcome.kind in NEVER_COMPLETE_KINDS:
                continue
            entry: dict[str, Any] = {"source_kind": outcome.kind, "source_org": outcome.org}
            if outcome.source.source_id:
                entry["source_id"] = outcome.source.source_id
                cursor_states.append(
                    {
                        "source_id": outcome.source.source_id,
                        "cursor_state": outcome.source.cursor.to_dict(),
                    }
                )
            complete_sources.append(entry)
        body: dict[str, Any] = {
            "status": status,
            "finished_at": ids.now_ms(),
            "stats": run_stats,
            "errors": errors,
            "complete_sources": complete_sources[:100],
        }
        if cursor_states:
            body["cursor_states"] = cursor_states[:100]
        if not self.dry_run:
            model("CompleteRunRequest").model_validate(body)
            with self.db.transaction() as conn:
                self.outbox.enqueue(
                    "POST",
                    f"/api/v1/discovery/runs/{self.run_id}/complete",
                    body,
                    ordering_key=f"run:{self.run_id}",
                    priority=PRIORITY_DISCOVERY,
                    depends_on=self.create_key,
                    idempotency_key=f"run:{self.run_id}:complete",
                )
                conn.execute(
                    "UPDATE checkpoints SET data = ?, updated_at = ? WHERE key = ?",
                    (
                        json.dumps({"status": status, "batches": self._batch_no, "complete": True}),
                        ids.now_ms(),
                        f"run:{self.run_id}",
                    ),
                )
                conn.execute(
                    "UPDATE runs SET finished_at = ?, status = ? WHERE id = ?",
                    (ids.now_ms(), status, self.run_id),
                )
            self._prune_runs()
        stats: dict[str, Any] = {
            **run_stats,
            "sources": [
                {
                    "source": o.source.key,
                    "source_id": o.source.source_id,
                    "adapter": o.kind or o.source.adapter.id,
                    "complete": o.complete and o.stop is None and not o.cancelled,
                    "stopped": o.stop.error_class if o.stop else None,
                    **o.stats.public(),
                }
                for o in outcomes
            ],
            "batches": self._batch_no,
            "dry_run": self.dry_run,
        }
        if expiry is not None:
            stats["check_tracked"] = expiry.stats()
        if not flush:
            log_event(_log, "discovery_aborted", f"run {self.run_id} aborted", level=30)
        return status, stats, errors

    def _prune_runs(self) -> None:
        rows = self.db.query(
            "SELECT id, log_path FROM runs WHERE kind = 'discover' "
            "ORDER BY started_at DESC LIMIT -1 OFFSET ?",
            (LOCAL_RUNS_KEPT,),
        )
        for row in rows:
            self.db.execute("DELETE FROM runs WHERE id = ?", (row["id"],))
            try:
                shutil.rmtree(self.paths.run_dir(str(row["id"])), ignore_errors=True)
            except ValueError:
                continue

    async def _flush(self) -> dict[str, Any]:
        mine = [
            e
            for e in self.outbox.entries(["pending", "inflight"])
            if e.ordering_key == f"run:{self.run_id}"
        ]
        report: dict[str, Any] = {"pending": len(mine), "sent": 0}
        api = self.ctx.api
        if api is None:
            report["offline"] = True
            self.emit({"type": "sync", **report})
            return report
        # The same hooks as `sync` and the worker: this flush may also carry task results
        # (late evidence on 409 lease_lost); the discovery hooks are registered by it too.
        from pilih_jobs.tasks.hooks import task_hooks

        hooks = task_hooks(self.db, self.issuer)
        # Entries of this run that were never attempted are due now. The corrected clock
        # follows the 1-second `Date` header, so it can step back below the time they were
        # queued at and the flusher would otherwise leave them for the next sync.
        self.db.execute(
            "UPDATE outbox SET next_attempt_at = MIN(next_attempt_at, ?) WHERE issuer = ? "
            "AND ordering_key = ? AND state = 'pending' AND attempts = 0",
            (ids.now_ms() - CLOCK_STEP_MS, self.issuer, f"run:{self.run_id}"),
        )
        try:
            if self.runtime is not None:
                from pilih_jobs.sync.engine import SyncEngine

                engine = SyncEngine(
                    self.db,
                    self.issuer,
                    api,
                    state_lock=self.runtime.state_lock,
                    hooks=hooks,
                    upload_root=self.paths.data_dir,
                )
                flush = await engine.push()
            else:
                flush = await OutboxFlusher(self.outbox, api, hooks=hooks).flush()
            if flush.paused:
                report["paused"] = flush.paused
        except (NetworkError, ApiError) as exc:
            report["error"] = exc.message
        left = [
            e
            for e in self.outbox.entries(["pending", "inflight", "conflict"])
            if e.ordering_key == f"run:{self.run_id}"
        ]
        report["sent"] = max(0, len(mine) - len(left))
        report["pending"] = len(left)
        dead = [e for e in self.outbox.entries(["dead"]) if e.ordering_key == f"run:{self.run_id}"]
        if dead:
            report["dead"] = len(dead)
        outcomes = run_outcomes(self.db, self.run_id)
        if outcomes:
            report["outcomes"] = outcomes
        self.emit({"type": "sync", **report})
        return report
