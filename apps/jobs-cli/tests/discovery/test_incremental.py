"""TDISC-INCREMENTAL (15 §9): ETag, watermark, content hash and cursor_state."""

from __future__ import annotations

import json
from typing import Any

import pytest
from werkzeug import Response

from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.contracts import ids
from pilih_jobs.runtime import Runtime
from tests.discovery.fake_discovery import FakeDiscovery
from tests.discovery.support import Site, VirtualClock, fixture_json
from tests.discovery.test_sync import board, discover, serve_board
from tests.support.fake_api import FakeApi


@pytest.fixture
def backend(fake_api: FakeApi, user_id: str) -> FakeDiscovery:
    return FakeDiscovery(fake_api, user_id)


def _sr(site: Site) -> dict[str, int]:
    calls = {"detail": 0}
    site.json(
        "/v1/companies/BoschGroup/postings",
        fixture_json("smartrecruiters/page1.json"),
        query_string="limit=100&offset=0",
    )
    site.json(
        "/v1/companies/BoschGroup/postings",
        fixture_json("smartrecruiters/page2.json"),
        query_string="limit=100&offset=2",
    )
    for pid in ("743999912345678", "743999912345679", "743999912345680"):
        body = json.dumps(fixture_json(f"smartrecruiters/detail_{pid}.json"))

        def detail(_r: Any, body: str = body) -> Response:
            calls["detail"] += 1
            return Response(body, content_type="application/json")

        site.handle(f"/v1/companies/BoschGroup/postings/{pid}", detail)
    return calls


async def test_TDISC_INCREMENTAL_etag_304_counts_every_posting_as_seen(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board(), etag='W/"v1"')
    source = backend.add_source("greenhouse", {"board_token": "acme"}, "Acme")
    first, _ = await discover(runtime, sources=[source["id"]])
    assert first.stats["sync"]["outcomes"] == {"new": 3}
    assert backend.sources[source["id"]]["cursor_state"]["listing"]["etag"] == 'W/"v1"'
    second, _ = await discover(runtime, sources=[source["id"]])
    sent = [h for h in ats.log if h[1].startswith("/v1/boards/acme/jobs")]
    assert sent[-1][2].get("If-None-Match") == 'W/"v1"'
    assert second.stats["unchanged"] == 3
    assert second.stats["sync"]["outcomes"] == {"unchanged": 3}
    assert all("title" not in item for item in backend.batches[-1])  # unchanged-only items
    assert backend.completes[-1]["complete_sources"][0]["source_id"] == source["id"]


async def test_TDISC_INCREMENTAL_304_without_local_history_refetches(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board(), etag='W/"v1"')
    source = backend.add_source("greenhouse", {"board_token": "acme"}, "Acme")
    source["cursor_state"] = {
        "v": 1,
        "listing": {"etag": 'W/"v1"', "last_modified": None},
    }  # from another device
    result, _ = await discover(runtime, sources=[source["id"]])
    requests = [h for h in ats.log if h[1].startswith("/v1/boards/acme/jobs")]
    assert len(requests) == 2
    assert "If-None-Match" not in requests[1][2]
    assert result.stats["new"] == 3


async def test_TDISC_INCREMENTAL_watermark_skips_detail_fetches(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    calls = _sr(ats)
    source = backend.add_source("smartrecruiters", {"company_identifier": "BoschGroup"}, "Bosch")
    await discover(runtime, sources=[source["id"]])
    assert calls["detail"] == 3
    watermark = backend.sources[source["id"]]["cursor_state"]["watermark_updated_at"]
    assert (
        watermark == ids.now_ms() - ids.now_ms() + 1791342000000
    )  # 2026-10-07T03:00Z, the newest release
    second, _ = await discover(runtime, sources=[source["id"]])
    assert calls["detail"] == 3  # no new detail fetch: every release ≤ watermark and seen
    assert second.stats["unchanged"] == 3


async def test_TDISC_INCREMENTAL_content_hash_window(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    data = board()
    serve_board(ats, data)
    await discover(runtime, sources=["greenhouse:acme"])
    data["jobs"][0]["content"] = (
        "&lt;p&gt;A rewritten description of the payments role, now with more detail.&lt;/p&gt;"
    )
    serve_board(ats, data)
    second, _ = await discover(runtime, sources=["greenhouse:acme"])
    assert second.stats["updated"] == 1
    assert second.stats["unchanged"] == 2
    assert second.stats["sync"]["outcomes"] == {"updated": 1, "unchanged": 2}
    later = ids.now_ms() + 25 * 3600 * 1000
    ids.set_time_source(lambda: later)
    try:
        third, _ = await discover(runtime, sources=["greenhouse:acme"])
    finally:
        ids.set_time_source(None)
    assert third.stats["unchanged"] == 0  # older than 24 h: full items again
    assert all("title" in item for item in backend.batches[-1])


async def test_TDISC_INCREMENTAL_incomplete_runs_keep_the_cursor(
    ats: Site,
    runtime: Runtime,
    signed_in: AccountMeta,
    backend: FakeDiscovery,
    virtual_time: VirtualClock,
) -> None:
    serve_board(ats, board(), etag='W/"v1"')
    source = backend.add_source("greenhouse", {"board_token": "acme"}, "Acme")
    result, _ = await discover(runtime, sources=[source["id"]], keywords="payments")
    assert result.stats["new"] == 1
    complete = backend.completes[-1]
    assert complete["complete_sources"] == []
    assert "cursor_states" not in complete
    assert backend.sources[source["id"]]["cursor_state"] == {}


def test_TDISC_INCREMENTAL_seen_refs_digest_is_order_independent() -> None:
    from pilih_jobs.discovery.cursor import CursorState

    assert CursorState.digest(["b", "a", "a"]) == CursorState.digest(["a", "b"])
