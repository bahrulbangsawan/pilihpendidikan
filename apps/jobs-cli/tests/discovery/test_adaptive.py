"""T15-ADAPTIVE: selector drift (15 §6) — v1 saves, v2 relocates, v3 fails without saving."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from pilih_jobs.discovery.engine import ScraplingJobEngine
from pilih_jobs.discovery.engine.adaptive import identifier_prefix
from pilih_jobs.storage.db import StateDB
from tests.discovery.support import Harness, Site, bodies, by_title, fixture_text, resolved

FIELDS = {
    "title": ".job-title",
    "location": ".job-location",
    "url": ".job-link",
    "description": ".job-summary",
}


def _source(site: Site) -> object:
    return resolved(
        "career_page",
        {"url": site.url("/careers"), "item_css": ".job-card", "fields": FIELDS},
        label="Acme",
    )


def _rows(engine: ScraplingJobEngine) -> dict[str, str]:
    path = engine.adaptive.path
    if not path.exists():
        return {}
    with sqlite3.connect(path) as conn:
        return dict(conn.execute("SELECT identifier, element_data FROM storage").fetchall())


async def _run(
    site: Site, engine: ScraplingJobEngine, fixture: str, db: StateDB | None = None
) -> object:
    site.server.clear_all_handlers()
    site.robots("User-agent: *\nAllow: /\n")
    site.html("/careers", fixture_text(fixture))
    return await Harness(engine, db=db).run(_source(site))  # type: ignore[arg-type]


async def test_T15_ADAPTIVE_v1_saves_primary_fields(site: Site, engine: ScraplingJobEngine) -> None:
    outcome = await _run(site, engine, "adaptive/listing_v1.html")
    assert len(bodies(outcome)) == 5
    assert outcome.stats.relocated_items == 0
    prefix = identifier_prefix("career_page", "localhost")
    assert set(_rows(engine)) == {
        f"{prefix}{f}" for f in ("__item__", "title", "location", "url", "description")
    }
    assert engine.adaptive.path.is_relative_to(engine.crawl_root.parent)


async def test_T15_ADAPTIVE_v2_relocates_above_threshold(
    site: Site, engine: ScraplingJobEngine
) -> None:
    await _run(site, engine, "adaptive/listing_v1.html")
    saved = _rows(engine)
    outcome = await _run(site, engine, "adaptive/listing_v2.html")
    items = by_title(outcome)
    assert set(items) == {
        "Senior Backend Engineer",
        "Product Designer",
        "Data Analyst",
        "QA Engineer",
        "Mobile Engineer",
    }
    backend = items["Senior Backend Engineer"]
    assert backend["extraction"]["method"] == "adaptive"
    assert "title" in backend["extraction"]["relocated_fields"]
    assert backend["extraction"]["confidence"] <= 0.6
    assert backend["apply_url"].endswith("/jobs/1")
    assert outcome.stats.selector_drift  # type: ignore[attr-defined]
    assert any(e.error_class == "selector_drift" for e in outcome.errors)  # type: ignore[attr-defined]
    assert _rows(engine) == saved  # a relocation never overwrites the stored fingerprint


async def test_T15_ADAPTIVE_v3_fails_without_saving(site: Site, engine: ScraplingJobEngine) -> None:
    await _run(site, engine, "adaptive/listing_v1.html")
    saved = _rows(engine)
    outcome = await _run(site, engine, "adaptive/listing_v3.html")
    assert bodies(outcome) == []
    assert outcome.stop is not None
    assert outcome.stop.error_class == "unsupported_content"
    assert _rows(engine) == saved


async def test_T15_ADAPTIVE_invalid_items_are_not_saved(
    site: Site, engine: ScraplingJobEngine
) -> None:
    site.html("/careers", fixture_text("adaptive/listing_v1.html"))
    source = resolved(
        "career_page",
        {
            "url": site.url("/careers"),
            "item_css": ".job-card",
            "fields": {"title": ".job-title", "url": ".missing-link"},
        },
    )
    outcome = await Harness(engine).run(source)
    assert bodies(outcome) == []
    assert outcome.stats.invalid == 5
    assert _rows(engine) == {}


async def test_T15_ADAPTIVE_same_field_in_three_consecutive_runs(
    site: Site, engine: ScraplingJobEngine, state_db: StateDB
) -> None:
    await _run(site, engine, "adaptive/listing_v1.html", state_db)
    flagged = []
    for _ in range(3):
        outcome = await _run(site, engine, "adaptive/listing_v4.html", state_db)
        assert outcome.stats.relocated_items == 1  # 1 of 5 items: below the 30 % ratio
        flagged.append(bool(outcome.stats.selector_drift))
    assert flagged == [False, False, True]


async def test_T15_ADAPTIVE_reset_deletes_only_the_source_prefix(
    site: Site, engine: ScraplingJobEngine, tmp_path: Path
) -> None:
    await _run(site, engine, "adaptive/listing_v1.html")
    with sqlite3.connect(engine.adaptive.path) as conn:
        conn.execute(
            "INSERT INTO storage(url, identifier, element_data) "
            "VALUES('x', 'career_page:other.com:title', '{}')"
        )
    deleted = engine.reset_adaptive(identifier_prefix("career_page", "localhost"))
    assert deleted == 5
    assert set(_rows(engine)) == {"career_page:other.com:title"}
