"""`ai`: the page text goes to the api's AI extractor (24 §4.3); nothing is parsed here."""

from __future__ import annotations

from typing import Any

from pilih_jobs.contracts._generated.cloud import AiStrategyConfig
from pilih_jobs.discovery.types import FetchMode

from pilih_scraper import fetching
from pilih_scraper.strategies.base import ScrapeJob


async def run_ai(job: ScrapeJob, config: dict[str, Any]) -> None:
    cfg = AiStrategyConfig.model_validate(config)
    result = await job.engine.fetch_listing(
        fetching.request(cfg.url, FetchMode.STATIC_HTML), source=job.ref
    )
    job.note_page(result)
    job.check_wall(cfg.url, result)
    job.add_ai_candidates("strategy_ai")
    job.complete = False
