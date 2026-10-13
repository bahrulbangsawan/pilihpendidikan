"""`discover --check-tracked` (15 §12): re-check tracked, still-open postings.

Tracked postings come from the local entity cache (applications → user jobs → postings,
refreshed from the change feed when online). Each posting is checked at most once per
24 h through its adapter's `check_open()`: 404/410, a board that no longer lists it
(Greenhouse/Ashby), JSON-LD `validThrough` in the past or a "no longer accepting
applications" text closes it. Results travel as unchanged-only batch items with
`status_hint` and `status_evidence {http_status, marker}` (05 §4); `unknown` (network,
5xx) is not reported.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Final, cast

from pilih_jobs.adapters import ADAPTERS, get_adapter
from pilih_jobs.adapters.base import AdapterContext, SourceAdapter
from pilih_jobs.contracts.adapters import excluded_source_for_host
from pilih_jobs.discovery.cursor import CursorState
from pilih_jobs.discovery.errors import DiscoveryError, PolicyViolation
from pilih_jobs.discovery.items import unchanged_item
from pilih_jobs.discovery.types import DiscoveryEngine, SourceRef, StatusCheck, TrackedPostingRef
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import EntityCache

CHECK_INTERVAL_MS: Final = 24 * 3600 * 1000
CHECKED_KV: Final = "discovery:checked:"
PAGE_CHECK_ADAPTER: Final = "custom_url"


@dataclass
class ExpiryResult:
    items: list[dict[str, Any]] = field(default_factory=lambda: [])
    checked: int = 0
    closed: int = 0
    open: int = 0
    unknown: int = 0
    skipped: int = 0
    adapters: set[str] = field(default_factory=lambda: set())

    def stats(self) -> dict[str, int]:
        return {
            "checked": self.checked,
            "closed": self.closed,
            "open": self.open,
            "unknown": self.unknown,
            "skipped": self.skipped,
        }


def tracked_postings(db: StateDB, issuer: str) -> list[TrackedPostingRef]:
    """Open postings behind non-archived applications (entity cache)."""
    cache = EntityCache(db, issuer)
    user_job_ids = {
        str(app.get("user_job_id"))
        for app in cache.list("application")
        if not app.get("archived") and app.get("user_job_id")
    }
    posting_ids = {
        str(uj.get("posting_id"))
        for uj in cache.list("user_job")
        if str(uj.get("id")) in user_job_ids and uj.get("posting_id")
    }
    sources = cache.list("source")
    out: list[TrackedPostingRef] = []
    for posting in cache.list("posting"):
        if str(posting.get("id")) not in posting_ids or posting.get("status") == "closed":
            continue
        fp, hash_ = posting.get("fingerprint"), posting.get("content_hash")
        if not isinstance(fp, str) or not isinstance(hash_, str):
            continue
        kind = str(posting.get("source_kind") or "")
        org = cast(str | None, posting.get("source_org"))
        config: dict[str, Any] | None = None
        if kind == "workday" and org:
            config = _workday_config(sources, org)
        out.append(
            TrackedPostingRef(
                posting_id=str(posting["id"]),
                fingerprint=fp,
                content_hash=hash_,
                source_kind=kind,
                source_org=org,
                source_job_ref=cast(str | None, posting.get("source_job_ref")),
                apply_url=cast(str | None, posting.get("apply_url")),
                canonical_url=cast(str | None, posting.get("canonical_url")),
                title=str(posting.get("title") or ""),
                source_config=config,
            )
        )
    return out


def _workday_config(sources: list[dict[str, Any]], org: str) -> dict[str, Any] | None:
    for source in sources:
        config = source.get("config")
        if source.get("adapter") != "workday" or not isinstance(config, dict):
            continue
        typed = cast(dict[str, Any], config)
        if (
            f"{typed.get('tenant')}/{typed.get('site')}" == org
            and source.get("enabled")
            and not typed.get("disabled_reason")
        ):
            return typed
    return None


def _source_ref(adapter: SourceAdapter, posting: TrackedPostingRef) -> SourceRef:
    limits = adapter.manifest.rate_limits
    return SourceRef(
        key=f"check:{posting.source_kind}:{posting.source_org or ''}",
        adapter_id=adapter.id,
        org=posting.source_org or "",
        stop_on=frozenset(str(s) for s in adapter.manifest.restrictions.stop_on),
        per_domain_concurrency=int(limits.per_domain_concurrency),
        min_delay_ms=int(limits.min_delay_ms),
    )


def _adapter_for(posting: TrackedPostingRef) -> SourceAdapter | None:
    kind = posting.source_kind
    if kind in ("greenhouse", "lever", "ashby", "smartrecruiters", "workable", "workday"):
        if kind == "workday" and posting.source_config is None:
            return None
        return get_adapter(kind)
    if posting.canonical_url or posting.apply_url:
        return get_adapter(kind if kind in ADAPTERS else PAGE_CHECK_ADAPTER)
    return None


async def check_tracked(
    *,
    engine: DiscoveryEngine,
    db: StateDB,
    issuer: str,
    run_id: str,
    now_ms: Callable[[], int],
    emit: Callable[[dict[str, Any]], None],
    cancel: Any,
    record: bool = True,
) -> ExpiryResult:
    result = ExpiryResult()
    shared: dict[str, Any] = {}
    for posting in tracked_postings(db, issuer):
        if cancel.is_set():
            break
        url = posting.canonical_url or posting.apply_url or ""
        if url and excluded_source_for_host(url) is not None:
            result.skipped += 1
            continue
        last = db.kv_get(f"{CHECKED_KV}{posting.posting_id}")
        if last is not None and last.isdigit() and now_ms() - int(last) < CHECK_INTERVAL_MS:
            result.skipped += 1
            continue
        try:
            adapter = _adapter_for(posting)
        except PolicyViolation:
            adapter = None
        if adapter is None:
            result.skipped += 1
            continue
        ctx = AdapterContext(
            engine=engine,
            run_id=run_id,
            source=_source_ref(adapter, posting),
            cursor=CursorState(),
            cancel=cancel,
            emit=lambda _event: None,
            cache=shared,
        )
        try:
            check = await adapter.check_open(ctx, posting)
        except DiscoveryError as exc:
            check = StatusCheck("unknown", http_status=exc.http_status)
        result.checked += 1
        result.adapters.add(adapter.id)
        if record:
            db.kv_set(f"{CHECKED_KV}{posting.posting_id}", str(now_ms()))
        emit(
            {
                "type": "item",
                "source": "check-tracked",
                "outcome": "checked",
                "status": check.status,
                "posting_id": posting.posting_id,
                "title": posting.title,
                "marker": check.marker,
            }
        )
        if check.status == "unknown":
            result.unknown += 1
            continue
        evidence: dict[str, Any] = {}
        if check.http_status is not None:
            evidence["http_status"] = check.http_status
        if check.marker:
            evidence["marker"] = check.marker[:200]
        if check.status == "closed":
            result.closed += 1
            if not evidence:
                evidence["marker"] = "closed"
        else:
            result.open += 1
        result.items.append(
            unchanged_item(
                posting.fingerprint,
                posting.content_hash,
                now_ms(),
                status_hint=check.status,
                evidence=evidence or None,
            )
        )
    return result
