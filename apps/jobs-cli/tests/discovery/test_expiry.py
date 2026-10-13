"""TDISC-EXPIRY (15 §12): `discover --check-tracked`."""

from __future__ import annotations

from collections.abc import Callable

import pytest

from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.contracts import ids
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.cache import EntityCache
from tests.discovery.fake_discovery import FakeDiscovery, Posting
from tests.discovery.support import Site, VirtualClock, fixture_json, fixture_text
from tests.discovery.test_sync import discover
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult


@pytest.fixture
def backend(fake_api: FakeApi, user_id: str) -> FakeDiscovery:
    return FakeDiscovery(fake_api, user_id)


def track(
    rt: Runtime,
    backend: FakeDiscovery,
    *,
    kind: str,
    org: str | None,
    ref: str | None,
    url: str,
    title: str,
    archived: bool = False,
) -> Posting:
    fp = "fp1:" + ids.new_ulid().lower().rjust(64, "0")[:64]
    fp = "fp1:" + __import__("hashlib").sha256(f"{kind}{org}{ref}{url}".encode()).hexdigest()
    posting = Posting(ids.new_id("pst"), fp, "a" * 64, kind, org, None, title)
    backend.postings[fp] = posting
    backend.linked.add(fp)
    cache = EntityCache(rt.db, rt.issuer)
    cache.put(
        "posting",
        {
            "id": posting.id,
            "fingerprint": fp,
            "content_hash": posting.content_hash,
            "source_kind": kind,
            "source_org": org,
            "source_job_ref": ref,
            "apply_url": url,
            "canonical_url": url,
            "title": title,
            "status": "open",
            "revision": 1,
        },
    )
    ujb = ids.new_id("ujb")
    cache.put("user_job", {"id": ujb, "posting_id": posting.id, "revision": 1})
    cache.put(
        "application",
        {"id": ids.new_id("app"), "user_job_id": ujb, "archived": archived, "revision": 1},
    )
    return posting


@pytest.fixture
def tracked(
    ats: Site, runtime: Runtime, signed_in: AccountMeta, backend: FakeDiscovery
) -> dict[str, Posting]:
    ats.status("/v1/boards/acme/jobs/111", 404)
    ats.json("/v1/boards/acme/jobs/222", {"id": 222})
    ats.json("/posting-api/job-board/ramp-id", fixture_json("ashby/board.json"))
    ats.html("/c/closed", fixture_text("career_page/closed_job.html"))
    ats.html("/c/expired", fixture_text("career_page/expired_job.html"))
    ats.status("/c/flaky", 500)
    return {
        "gh_gone": track(
            runtime,
            backend,
            kind="greenhouse",
            org="acme",
            ref="111",
            title="Gone",
            url="https://boards.greenhouse.io/acme/jobs/111",
        ),
        "gh_open": track(
            runtime,
            backend,
            kind="greenhouse",
            org="acme",
            ref="222",
            title="Open",
            url="https://boards.greenhouse.io/acme/jobs/222",
        ),
        "ashby_unlisted": track(
            runtime,
            backend,
            kind="ashby",
            org="ramp-id",
            ref="a1b2c3d4-0000-4000-8000-000000000003",
            title="Unlisted",
            url="https://jobs.ashbyhq.com/ramp-id/a1b2c3d4-0000-4000-8000-000000000003",
        ),
        "page_closed": track(
            runtime,
            backend,
            kind="career_page",
            org=None,
            ref=None,
            title="Closed text",
            url=ats.url("/c/closed"),
        ),
        "page_expired": track(
            runtime,
            backend,
            kind="custom_url",
            org=None,
            ref=None,
            title="Expired",
            url=ats.url("/c/expired"),
        ),
        "page_flaky": track(
            runtime,
            backend,
            kind="career_page",
            org=None,
            ref=None,
            title="Flaky",
            url=ats.url("/c/flaky"),
        ),
        "linkedin": track(
            runtime,
            backend,
            kind="manual",
            org=None,
            ref=None,
            title="Manual",
            url="https://www.linkedin.com/jobs/view/1",
        ),
        "archived": track(
            runtime,
            backend,
            kind="greenhouse",
            org="acme",
            ref="333",
            title="Archived",
            url="https://boards.greenhouse.io/acme/jobs/333",
            archived=True,
        ),
    }


async def test_TDISC_EXPIRY_check_tracked_reports_closures_with_evidence(
    tracked: dict[str, Posting],
    runtime: Runtime,
    backend: FakeDiscovery,
    ats: Site,
    virtual_time: VirtualClock,
) -> None:
    result, events = await discover(runtime, check_tracked=True)
    assert result.status == "completed"
    stats = result.stats["check_tracked"]
    assert stats == {"checked": 6, "closed": 4, "open": 1, "unknown": 1, "skipped": 1}
    closed = {p.title: p for p in backend.postings.values() if p.status == "closed"}
    assert set(closed) == {"Gone", "Unlisted", "Closed text", "Expired"}
    assert closed["Gone"].evidence == {"http_status": 404, "marker": "greenhouse_job_gone"}
    assert closed["Unlisted"].evidence["marker"] == "ashby_unlisted"
    assert closed["Expired"].evidence["marker"] == "valid_through_past"
    assert "no longer accepting applications" in closed["Closed text"].evidence["marker"]
    assert backend.completes[-1]["complete_sources"] == []
    assert not [h for h in ats.log if "linkedin" in h[1]]
    assert sum(1 for e in events if e.get("outcome") == "checked") == 6


async def test_TDISC_EXPIRY_at_most_one_check_per_posting_per_day(
    tracked: dict[str, Posting],
    runtime: Runtime,
    backend: FakeDiscovery,
    ats: Site,
    virtual_time: VirtualClock,
) -> None:
    await discover(runtime, check_tracked=True)
    hits = len(ats.log)
    again, _ = await discover(runtime, check_tracked=True)
    assert again.stats["check_tracked"]["checked"] == 0
    assert len(ats.log) == hits
    later = ids.now_ms() + 25 * 3600 * 1000
    ids.set_time_source(lambda: later)
    try:
        third, _ = await discover(runtime, check_tracked=True)
    finally:
        ids.set_time_source(None)
    assert third.stats["check_tracked"]["checked"] >= 2


def test_TDISC_EXPIRY_cli_check_tracked(
    ats: Site,
    virtual_time: VirtualClock,
    cli_signed_in: Callable[..., CliResult],
    fake_api: FakeApi,
    user_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json

    from pilih_jobs.runtime import Runtime as Rt

    backend = FakeDiscovery(fake_api, user_id)
    monkeypatch.setenv("PILIH_JOBS_TEST_BASE_URLS", json.dumps({"greenhouse": ats.base}))
    rt = Rt.create(api_url=fake_api.issuer)
    try:
        track(
            rt,
            backend,
            kind="greenhouse",
            org="acme",
            ref="111",
            title="Gone",
            url="https://boards.greenhouse.io/acme/jobs/111",
        )
    finally:
        rt.close()
    ats.status("/v1/boards/acme/jobs/111", 404)
    result = cli_signed_in("--json", "discover", "--check-tracked")
    assert result.code == 0, result.stdout
    assert result.ndjson[-1]["data"]["stats"]["check_tracked"]["closed"] == 1
    assert [p.status for p in backend.postings.values()] == ["closed"]
