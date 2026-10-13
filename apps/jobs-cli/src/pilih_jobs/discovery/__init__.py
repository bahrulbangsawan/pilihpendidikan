"""Discovery (15). Interface fixed by PLAN C6; implemented by leaf 4.2.

`run_discovery(options, ctx=runtime)` enumerates the selected sources with the
`ScraplingJobEngine` (the only module importing scrapling, `discovery.engine`), normalizes
and fingerprints postings, and writes the run, its batches and `complete` to the outbox
(20 §7). Progress goes through `ctx.emit(event)` (16 §5 event objects); `ctx.cancel` is
set on the first Ctrl+C (16 §6).

The worker (21) calls it for `discover` tasks with `task_id` and the claim context's
`source_records` (`DiscoverTaskContext.sources`); processes that flush the outbox
themselves should register `pilih_jobs.discovery.sync.register_flush_hooks` so batch
outcomes update `seen_postings`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pilih_jobs.api.client import ApiClient
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import Outbox


@dataclass
class DiscoveryOptions:
    """Mirrors the `discover` flags (16 §3.3)."""

    sources: list[str] = field(
        default_factory=lambda: []
    )  # --source src_…|adapter:org (repeatable)
    all_sources: bool = False  # --all
    url: str | None = None  # --url (custom_url)
    keywords: str | None = None  # --keywords
    location: str | None = None  # --location
    private: bool = False  # --private
    check_tracked: bool = False  # --check-tracked
    max_pages: int | None = None  # --max-pages
    dry_run: bool = False  # --dry-run (no sync)
    reset_adaptive: str | None = None  # --reset-adaptive <src>
    task_id: str | None = None  # worker `discover` task (21), recorded on the run
    #: Source rows from a task claim (`DiscoverTaskContext.sources`); used instead of
    #: fetching `/api/v1/sources` when given.
    source_records: list[dict[str, Any]] = field(default_factory=lambda: [])


@dataclass
class DiscoveryRuntime:
    outbox: Outbox
    api: ApiClient | None  # None for offline / --dry-run
    emit: Callable[[dict[str, Any]], None]
    cancel: asyncio.Event
    runtime: Runtime | None = None  # paths (adaptive store, crawls), config, clock, db


@dataclass
class DiscoveryRunResult:
    run_id: str
    status: str  # DiscoveryRunStatus
    stats: dict[str, Any] = field(default_factory=lambda: {})
    errors: list[dict[str, Any]] = field(default_factory=lambda: [])


async def run_discovery(options: DiscoveryOptions, *, ctx: DiscoveryRuntime) -> DiscoveryRunResult:
    """Run discovery (15): resolve sources, crawl, queue the run in the outbox, flush."""
    from pilih_jobs.discovery.manager import DiscoveryManager

    return await DiscoveryManager(options, ctx).run()


__all__ = ["DiscoveryOptions", "DiscoveryRunResult", "DiscoveryRuntime", "run_discovery"]
