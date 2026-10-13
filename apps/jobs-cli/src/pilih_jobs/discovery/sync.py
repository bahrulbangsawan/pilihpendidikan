"""Outbox flush hooks of discovery (20 §7 step 3).

When a `postings:batch` request succeeds, the server's per-item outcomes
(`new / updated / unchanged / invalid`) update `seen_postings`: accepted items record
their `content_hash`, `posting_id` and `last_uploaded_at`; an unchanged-only item the
server does not know (`unknown_fingerprint`) is forgotten locally so the next run sends
it in full. Any process that flushes the outbox (the `discover` command, `sync`, the
worker) should register these hooks with `register_flush_hooks()`.
"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any, Final, cast

from pilih_jobs.api.client import ApiResponse
from pilih_jobs.contracts import ids
from pilih_jobs.discovery.items import fingerprint_from_ref
from pilih_jobs.discovery.jsonutil import arr, obj, objs
from pilih_jobs.discovery.seen import LocalSeenCache
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.flusher import FlushHooks
from pilih_jobs.sync.outbox import Batch

BATCH_PATH: Final = r"^/api/v1/discovery/runs/[^/]+/postings:batch$"
OUTCOMES_KV_PREFIX: Final = "discovery:outcomes:"


def _request_items(batch: Batch) -> dict[str, dict[str, Any]]:
    by_ref: dict[str, dict[str, Any]] = {}
    for entry in batch.entries:
        body = entry.json()
        if not isinstance(body, dict):
            continue
        for item in cast(list[Any], cast(dict[str, Any], body).get("items") or []):
            if isinstance(item, dict):
                typed = cast(dict[str, Any], item)
                by_ref[str(typed.get("client_ref"))] = typed
    return by_ref


def apply_batch_outcomes(
    db: StateDB, issuer: str, batch: Batch, response: ApiResponse, *, now_ms: int | None = None
) -> Counter[str]:
    """Update `seen_postings` from a successful batch response; returns outcome counts."""
    sent = _request_items(batch)
    results = arr(obj(response.data).get("items"))
    accepted: list[tuple[str, str, str | None]] = []
    unknown: list[str] = []
    counts: Counter[str] = Counter()
    for result in results:
        if not isinstance(result, dict):
            continue
        typed = cast(dict[str, Any], result)
        ref = str(typed.get("client_ref"))
        outcome = str(typed.get("outcome"))
        counts[outcome] += 1
        item = sent.get(ref)
        if item is None:
            continue
        fp = str(item.get("fingerprint") or fingerprint_from_ref(ref))
        if outcome in ("new", "updated", "unchanged"):
            posting_id = typed.get("posting_id")
            accepted.append(
                (
                    fp,
                    str(item.get("content_hash")),
                    posting_id if isinstance(posting_id, str) else None,
                )
            )
        elif outcome == "invalid":
            codes = {str(e.get("code")) for e in objs(typed.get("errors"))}
            if "unknown_fingerprint" in codes:
                unknown.append(fp)
    cache = LocalSeenCache(db, issuer)
    cache.record(accepted, uploaded_at=now_ms or ids.now_ms())
    cache.forget(unknown)
    run_id = batch.path.split("/")[5] if batch.path.count("/") >= 5 else ""
    if run_id:
        key = f"{OUTCOMES_KV_PREFIX}{run_id}"
        previous = db.kv_get_json(key)
        merged: Counter[str] = Counter(
            cast(dict[str, int], previous) if isinstance(previous, dict) else {}
        )
        merged.update(counts)
        db.kv_set(key, json.dumps(dict(merged), separators=(",", ":")))
    return counts


def register_flush_hooks(hooks: FlushHooks, db: StateDB, issuer: str) -> FlushHooks:
    """Add the discovery success hook to a flusher's hooks (idempotent per hooks object)."""
    marker = "_pilih_discovery_hooks"
    if getattr(hooks, marker, False):
        return hooks

    def on_batch(batch: Batch, response: ApiResponse) -> None:
        apply_batch_outcomes(db, issuer, batch, response)

    hooks.on_success(BATCH_PATH, on_batch)
    setattr(hooks, marker, True)
    return hooks


def run_outcomes(db: StateDB, run_id: str) -> dict[str, int]:
    """Server item outcomes of a run's acknowledged batches (`new`, `unchanged`, …)."""
    value = db.kv_get_json(f"{OUTCOMES_KV_PREFIX}{run_id}")
    if not isinstance(value, dict):
        return {}
    return {str(k): int(v) for k, v in cast(dict[str, Any], value).items() if isinstance(v, int)}
