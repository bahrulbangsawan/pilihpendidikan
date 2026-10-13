"""One source of a discovery run: adapter → detail → normalize → validate → fingerprint →
dedupe → seen cache (15 §3), with the incremental rules of §9 and drift rules of §6.

The runner writes into a `SourceOutcome` as it goes, so a source cancelled mid-way
still contributes the postings it found (16 §6 graceful stop).
"""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, cast

from pilih_jobs.adapters import get_adapter
from pilih_jobs.adapters.base import AdapterContext, SourceAdapter
from pilih_jobs.discovery.errors import SOURCE_FATAL, DiscoveryError, ErrorClass, PolicyViolation
from pilih_jobs.discovery.items import (
    CONFIDENCE,
    ItemContext,
    ItemRejected,
    PreparedItem,
    build_item,
    stable_fingerprint,
    unchanged_item,
    validate,
)
from pilih_jobs.discovery.jsonutil import number, obj
from pilih_jobs.discovery.normalize import NormalizedFields, normalize
from pilih_jobs.discovery.seen import LocalSeenCache, RunDeduper
from pilih_jobs.discovery.sources import ResolvedSource
from pilih_jobs.discovery.types import DiscoveryEngine, ProgressEvent, RawPosting, SourceRef
from pilih_jobs.storage.db import StateDB

#: 15 §6: more than 30 % of a source's items relocated, or one field in 3 consecutive runs.
DRIFT_RATIO: Final = 0.3
DRIFT_CONSECUTIVE_RUNS: Final = 3
DRIFT_KV: Final = "discovery:drift:"
MAX_DETAIL_FETCHES: Final = 2000

Emit = Callable[[dict[str, Any]], None]


@dataclass
class SourceStats:
    pages: int = 0
    found: int = 0
    new: int = 0
    updated: int = 0
    unchanged: int = 0
    duplicates: int = 0
    invalid: int = 0
    filtered: int = 0
    detail_fetches: int = 0
    relocated_items: int = 0
    selector_items: int = 0
    errors_by_class: Counter[str] = field(default_factory=lambda: Counter[str]())
    relocated_fields: Counter[str] = field(default_factory=lambda: Counter[str]())
    selector_drift: dict[str, int] = field(default_factory=lambda: {})

    def public(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "pages": self.pages,
            "found": self.found,
            "new": self.new,
            "updated": self.updated,
            "unchanged": self.unchanged,
            "duplicates": self.duplicates,
            "invalid": self.invalid,
        }
        if self.filtered:
            out["filtered"] = self.filtered
        if self.selector_drift:
            out["selector_drift"] = dict(self.selector_drift)
        return out


@dataclass
class SourceOutcome:
    source: ResolvedSource
    items: list[PreparedItem | dict[str, Any]] = field(default_factory=lambda: [])
    stats: SourceStats = field(default_factory=SourceStats)
    errors: list[DiscoveryError] = field(default_factory=lambda: [])
    stop: DiscoveryError | None = None
    complete: bool = False
    cancelled: bool = False
    finished: bool = False
    kind: str = ""
    org: str | None = None
    fingerprints: list[tuple[str, str]] = field(default_factory=lambda: [])
    refs: list[str] = field(default_factory=lambda: [])
    watermark: int | None = None
    filters_active: bool = False

    @property
    def produced(self) -> bool:
        return bool(self.items)


@dataclass
class RunnerSettings:
    run_id: str
    device_id: str | None
    max_pages: int
    keywords: str | None = None
    location: str | None = None
    crawl_dir: Path | None = None
    dry_run: bool = False


def _matches_filters(fields: NormalizedFields, keywords: str | None, location: str | None) -> bool:
    if keywords:
        haystack = " ".join([fields.title, fields.description_text, *fields.requirements]).lower()
        if not all(term in haystack for term in keywords.lower().split()):
            return False
    if location:
        wanted = location.lower().strip()
        places = [
            " ".join(str(v) for v in loc.values() if isinstance(v, str)).lower()
            for loc in fields.locations
        ]
        remote_ok = wanted in ("remote", "anywhere") and fields.workplace_type == "remote"
        if not remote_ok and not any(wanted in place for place in places):
            return False
    return True


class SourceRunner:
    def __init__(
        self,
        source: ResolvedSource,
        *,
        engine: DiscoveryEngine,
        settings: RunnerSettings,
        seen: LocalSeenCache,
        deduper: RunDeduper,
        db: StateDB | None,
        cancel: asyncio.Event,
        emit: Emit,
        now_ms: Callable[[], int],
        outcome: SourceOutcome,
    ) -> None:
        self.source = source
        self.engine = engine
        self.settings = settings
        self.seen = seen
        self.deduper = deduper
        self.db = db
        self.cancel = cancel
        self.emit = emit
        self.now_ms = now_ms
        self.outcome = outcome
        self.outcome.kind = source.adapter.id
        self.outcome.org = source.ref.org
        self._adapters: dict[str, SourceAdapter] = {source.adapter.id: source.adapter}
        self._detail_ref: SourceRef = source.ref
        self._detail_config: dict[str, Any] = source.config

    # ------------------------------------------------------------------ helpers
    def adapter_for(self, adapter_id: str) -> SourceAdapter:
        adapter = self._adapters.get(adapter_id)
        if adapter is None:
            adapter = get_adapter(adapter_id)
            self._adapters[adapter_id] = adapter
        return adapter

    def _context(self) -> AdapterContext:
        return AdapterContext(
            engine=self.engine,
            run_id=self.settings.run_id,
            source=self.source.ref,
            cursor=self.source.cursor,
            cancel=self.cancel,
            emit=lambda _event: None,
            max_pages=self.settings.max_pages,
            keywords=self.settings.keywords,
            location=self.settings.location,
            crawl_dir=self.settings.crawl_dir,
            label=self.source.label,
            adapter_for=self.adapter_for,
        )

    def _event(self, kind: str, **fields: Any) -> None:
        self.emit({"type": kind, "source": self.source.key, **fields})

    def _count_error(self, error_class: ErrorClass) -> None:
        self.outcome.stats.errors_by_class[error_class] += 1

    # ------------------------------------------------------------------ run
    async def run(self) -> SourceOutcome:
        outcome = self.outcome
        self._event("source_started", run_id=self.settings.run_id, label=self.source.label)
        ctx = self._context()
        restarted = False
        try:
            while True:
                restart = await self._discover(ctx)
                if not restart or restarted:
                    break
                restarted = True
        except DiscoveryError as exc:
            outcome.stop = exc
        except PolicyViolation as exc:
            outcome.stop = DiscoveryError("policy_blocked", exc.message)
        except asyncio.CancelledError:
            outcome.cancelled = True
            raise
        finally:
            self._finish()
        return outcome

    async def _discover(self, ctx: AdapterContext) -> bool:
        """One pass over the adapter; True when a 304 must be retried unconditionally."""
        outcome = self.outcome
        cfg = self.source.config
        async for item in self.source.adapter.discover(ctx, cfg):
            if self.cancel.is_set():
                outcome.cancelled = True
                break
            if isinstance(item, ProgressEvent):
                if self._progress(item):
                    return True
                continue
            await self._process(ctx, item)
        return False

    def _progress(self, event: ProgressEvent) -> bool:
        outcome = self.outcome
        data = event.data
        if event.kind == "page":
            outcome.stats.pages += 1
            self._event(
                "page_fetched",
                page=data.get("page"),
                items=data.get("items"),
                mode=data.get("mode"),
                elapsed_ms=data.get("elapsed_ms"),
            )
        elif event.kind == "cursor":
            etag = data.get("etag")
            modified = data.get("last_modified")
            if "etag" in data or "last_modified" in data:
                self.source.cursor.set_listing(
                    etag if isinstance(etag, str) else None,
                    modified if isinstance(modified, str) else None,
                )
        elif event.kind == "complete":
            outcome.complete = bool(data.get("complete"))
        elif event.kind == "redirect":
            outcome.kind = str(data.get("adapter"))
            org = data.get("source_org")
            outcome.org = str(org) if org else None
            ref = data.get("source_ref")
            config = data.get("config")
            if isinstance(ref, SourceRef):
                self._detail_ref = ref
            if isinstance(config, dict):
                self._detail_config = cast(dict[str, Any], config)
            self._event(
                "warning", message=f"redirected to the {outcome.kind} adapter", url=data.get("url")
            )
        elif event.kind == "warning":
            error_class = data.get("error_class")
            if isinstance(error_class, str):
                self._count_error(error_class)  # pyright: ignore[reportArgumentType]
            self._event("warning", **data)
        elif event.kind == "not_modified":
            return self._not_modified()
        return False

    def _not_modified(self) -> bool:
        """304: every posting of the last complete run counts as seen (15 §9)."""
        last = self.seen.last_run(self.source.key)
        if not last:
            self.source.cursor.set_listing(None, None)
            return True
        observed = self.now_ms()
        for fp, hash_ in last:
            if not self.deduper.add(fp):
                continue
            self.outcome.items.append(unchanged_item(fp, hash_, observed))
            self.outcome.fingerprints.append((fp, hash_))
            self.outcome.stats.found += 1
            self.outcome.stats.unchanged += 1
        self._event("warning", message="listing not modified (304); postings counted as seen")
        return False

    async def _process(self, ctx: AdapterContext, raw: RawPosting) -> None:
        outcome = self.outcome
        stats = outcome.stats
        stats.found += 1
        if raw.source_job_ref:
            outcome.refs.append(raw.source_job_ref)
        adapter = self.adapter_for(raw.adapter_id)
        missing = raw.data.get("missing_required")
        if isinstance(missing, list) and missing:
            self._reject(
                raw, ItemRejected("parse_error", [f"required field(s) not found: {missing}"])
            )
            return
        if raw.updated_at_ms is not None:
            outcome.watermark = max(outcome.watermark or 0, raw.updated_at_ms)
        stable = stable_fingerprint(raw.adapter_id, raw.source_org, raw.source_job_ref)
        if raw.needs_detail and await self._detail(ctx, adapter, raw, stable) is False:
            return
        observed = self.now_ms()
        try:
            draft = adapter.to_normalized(raw)
            fields = normalize(
                draft,
                observed_at=observed,
                company_fallback=self.source.company_hint,
                page_url=raw.data.get("page_url")
                if isinstance(raw.data.get("page_url"), str)
                else None,
            )
            flags = validate(fields, source_kind=raw.adapter_id, method=raw.method, now_ms=observed)
            if self.settings.keywords or self.settings.location:
                outcome.filters_active = True
                if not _matches_filters(fields, self.settings.keywords, self.settings.location):
                    stats.filtered += 1
                    return
            item = build_item(
                raw,
                fields,
                ItemContext(
                    run_id=self.settings.run_id,
                    device_id=self.settings.device_id,
                    adapter_version=adapter.version,
                    application_support=adapter.application_support,
                    source_id=self.source.source_id,
                    visibility=self.source.visibility,
                    observed_at=observed,
                ),
                flags=flags,
            )
        except ItemRejected as rejected:
            self._reject(raw, rejected)
            return
        if raw.method in ("css", "xpath", "adaptive"):
            stats.selector_items += 1
        if not self.deduper.add(item.fingerprint):
            stats.duplicates += 1
            self._event("item", outcome="duplicate", fingerprint=item.fingerprint, title=item.title)
            return
        if item.relocated_fields:
            stats.relocated_items += 1
            stats.relocated_fields.update(item.relocated_fields)
        self.engine.confirm_adaptive(item.extraction)
        self._accept(item, observed)

    async def _detail(
        self, ctx: AdapterContext, adapter: SourceAdapter, raw: RawPosting, stable: str | None
    ) -> bool | None:
        """Fetch the detail (or skip it); False when the item is finished or dropped."""
        stats = self.outcome.stats
        cursor = self.source.cursor
        seen = self.seen.get(stable) if stable else None
        watermark = cursor.watermark
        if (
            stable is not None
            and seen is not None
            and watermark is not None
            and raw.updated_at_ms is not None
            and raw.updated_at_ms <= watermark
        ):
            self._unchanged_from_cache(stable, seen.content_hash, raw)
            return False
        if seen is None and raw.source_job_ref:
            cursor.detail_etags.pop(raw.source_job_ref, None)
        if stats.detail_fetches >= MAX_DETAIL_FETCHES:
            self.outcome.complete = False
            self._event("warning", message="detail fetch cap (2,000) reached")
            return False
        stats.detail_fetches += 1
        try:
            detailed = await adapter.fetch_detail(
                ctx.for_source(self._detail_ref), self._detail_config, raw
            )
        except DiscoveryError as exc:
            if exc.error_class in SOURCE_FATAL or exc.error_class in self._detail_ref.stop_on:
                raise
            self._count_error(exc.error_class)
            self.outcome.errors.append(exc)
            self._event("item", outcome="error", error_class=exc.error_class, url=raw.detail_url)
            return False
        if "detail_not_modified" in detailed.flags and stable is not None and seen is not None:
            self._unchanged_from_cache(stable, seen.content_hash, raw)
            return False
        return None

    def _unchanged_from_cache(self, fp: str, hash_: str, raw: RawPosting) -> None:
        stats = self.outcome.stats
        if not self.deduper.add(fp):
            stats.duplicates += 1
            return
        self.outcome.items.append(unchanged_item(fp, hash_, self.now_ms()))
        self.outcome.fingerprints.append((fp, hash_))
        stats.unchanged += 1
        self._event("item", outcome="unchanged", fingerprint=fp, ref=raw.source_job_ref)

    def _reject(self, raw: RawPosting, rejected: ItemRejected) -> None:
        stats = self.outcome.stats
        stats.invalid += 1
        self._count_error(rejected.error_class)
        self._event(
            "item",
            outcome="invalid",
            error_class=rejected.error_class,
            reasons=rejected.reasons[:5],
            ref=raw.source_job_ref,
            url=raw.detail_url,
        )

    def _accept(self, item: PreparedItem, observed: int) -> None:
        stats = self.outcome.stats
        self.outcome.fingerprints.append((item.fingerprint, item.content_hash))
        if self.seen.is_unchanged(item.fingerprint, item.content_hash, observed):
            self.outcome.items.append(item.unchanged_body(observed))
            stats.unchanged += 1
            label = "unchanged"
        else:
            self.outcome.items.append(item)
            previous = self.seen.get(item.fingerprint)
            if previous is None:
                stats.new += 1
                label = "new"
            else:
                stats.updated += 1
                label = "updated"
        self._event("item", outcome=label, fingerprint=item.fingerprint, title=item.title)

    # ------------------------------------------------------------------ finish
    def _drift(self) -> None:
        """15 §6 drift: >30 % relocated items, or a field relocated in 3 consecutive runs."""
        stats = self.outcome.stats
        if stats.selector_items == 0:
            return
        prefix = f"{DRIFT_KV}{self.source.adapter.id}:{self.source.ref.org.lower()}:"
        consecutive: dict[str, int] = {}
        if self.db is not None and not self.settings.dry_run:
            known = list(stats.relocated_fields)
            previous = obj(self.db.kv_get_json(f"{prefix}fields"))
            for name in set(previous) | set(known):
                prior = number(previous.get(name)) or 0
                count = int(prior) + 1 if name in stats.relocated_fields else 0
                if count:
                    consecutive[name] = count
            self.db.kv_set_json(f"{prefix}fields", consecutive)
        ratio = stats.relocated_items / stats.selector_items
        drifting = {
            name: count
            for name, count in stats.relocated_fields.items()
            if ratio > DRIFT_RATIO or consecutive.get(name, 0) >= DRIFT_CONSECUTIVE_RUNS
        }
        if not drifting:
            return
        stats.selector_drift = dict(drifting)
        self._count_error("selector_drift")
        self.outcome.errors.append(
            DiscoveryError(
                "selector_drift",
                "Source layout changed — extraction may be degraded "
                f"({', '.join(sorted(drifting))})",
            )
        )
        for item in self.outcome.items:
            if isinstance(item, PreparedItem):
                item.cap_confidence(CONFIDENCE["drift"])
        self._event("warning", error_class="selector_drift", fields=dict(drifting))

    def _finish(self) -> None:
        outcome = self.outcome
        stats = outcome.stats
        self._drift()
        if outcome.stop is not None:
            outcome.complete = False
            self._count_error(outcome.stop.error_class)
            self._event(
                "source_stopped",
                error_class=outcome.stop.error_class,
                http_status=outcome.stop.http_status,
                message=outcome.stop.detail[:300],
            )
        if outcome.cancelled or outcome.filters_active:
            outcome.complete = False
        if outcome.complete:
            self.source.cursor.advance_watermark(outcome.watermark)
            if outcome.refs:
                self.source.cursor.seen_refs_digest = self.source.cursor.digest(outcome.refs)
        outcome.finished = True
        if outcome.stop is None:
            self._event("source_finished", stats=stats.public(), complete=outcome.complete)
