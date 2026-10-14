"""`POST /v1/scrape`: run one source's strategy and answer a `ScrapeResponse` (24 §3)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Final, cast

from pilih_jobs.contracts._generated.cloud import ScrapeResponse
from pilih_jobs.discovery.errors import DiscoveryError, PolicyViolation
from pilih_jobs.discovery.items import engine_versions
from pydantic import ValidationError

from pilih_scraper import __version__, fetching, logs
from pilih_scraper.context import RunContext, now_ms
from pilih_scraper.errors import ScrapeStop, error_dict, from_discovery, from_stop
from pilih_scraper.postings import PostingBuilder, SourceInfo
from pilih_scraper.strategies.ai import run_ai
from pilih_scraper.strategies.base import Limits, ScrapeJob
from pilih_scraper.strategies.html import run_html
from pilih_scraper.strategies.jsonld import run_json_ld
from pilih_scraper.strategies.jsonmap import run_embedded_json, run_json_api
from pilih_scraper.strategies.rss import run_rss

ANSWER_RESERVE_MS: Final = 2000
_log = logs.get_logger("scrape")


def versions() -> dict[str, str]:
    return {"scraper": __version__, **engine_versions()}


def limits_of(rate: dict[str, Any]) -> Limits:
    def num(key: str, default: int, low: int, high: int) -> int:
        value = rate.get(key)
        number = value if isinstance(value, int) and not isinstance(value, bool) else default
        return max(low, min(high, number))

    return Limits(
        min_delay_ms=num("min_delay_ms", 2000, 1000, 60_000),
        max_pages=num("max_pages", 3, 1, 10),
        max_items=num("max_items", 200, 1, 500),
        max_details=num("max_details", 20, 0, 50),
    )


async def _dispatch(job: ScrapeJob, strategy: str, config: dict[str, Any]) -> None:
    match strategy:
        case "json_api":
            await run_json_api(job, config)
        case "rss":
            await run_rss(job, config)
        case "json_ld":
            await run_json_ld(job, config)
        case "embedded_json":
            await run_embedded_json(job, config)
        case "html_selectors":
            await run_html(job, config, browser=False)
        case "browser":
            await run_html(job, config, browser=True)
        case "ai":
            await run_ai(job, config)
        case _:
            raise ScrapeStop(
                "invalid_config",
                f"Strategy {strategy!r} cannot be scraped; choose an extraction strategy first.",
            )


async def scrape(body: dict[str, Any], factory: fetching.EngineFactory) -> dict[str, Any]:
    source = cast(dict[str, Any], body["source"])
    config = cast(dict[str, Any], source.get("strategy_config") or {})
    strategy = str(source["strategy"])
    ctx = RunContext(
        run_id=str(body["run_id"]),
        deadline_ms=max(1000, int(body["deadline_ms"]) - ANSWER_RESERVE_MS),
    )
    defaults = config.get("defaults")
    builder = PostingBuilder(
        SourceInfo(
            id=str(source["id"]),
            slug=str(source["slug"]),
            canonical_domain=str(source["canonical_domain"]),
            strategy=strategy,
            defaults=cast(dict[str, Any], defaults) if isinstance(defaults, dict) else {},
            attribution=config.get("attribution")
            if isinstance(config.get("attribution"), str)
            else None,
        ),
        ctx,
        observed_at=now_ms(),
    )
    limits = limits_of(cast(dict[str, Any], source.get("rate_limit") or {}))
    allow_browser = bool(source.get("allow_browser"))
    engine = factory.make(allow_browser=allow_browser)
    job = ScrapeJob(
        engine=engine,
        ref=fetching.source_ref(
            key=f"cloud:{source['slug']}",
            org=str(source["canonical_domain"]),
            min_delay_ms=limits.min_delay_ms,
            allow_browser=allow_browser,
            source_id=str(source["id"]),
        ),
        ctx=ctx,
        builder=builder,
        limits=limits,
        canonical_domain=str(source["canonical_domain"]),
        cursor_in=cast(dict[str, Any], body.get("cursor_state") or {}),
        allow_browser=allow_browser,
        ai_fallback=bool(body.get("ai_fallback")),
    )
    ctx.add_log("info", "scrape_started", f"Strategy {strategy} for {source['name']}")
    error: dict[str, Any] | None = None
    try:
        await asyncio.wait_for(_dispatch(job, strategy, config), timeout=ctx.deadline_ms / 1000)
    except TimeoutError:
        error = error_dict(
            "timeout", "The scrape reached its deadline; the next run resumes from the checkpoint."
        )
    except ValidationError as exc:
        issue = exc.errors()[0]
        where = ".".join(str(p) for p in issue["loc"])
        error = error_dict(
            "invalid_config",
            f"strategy_config is invalid for {strategy} at {where}: {issue['msg']}",
        )
    except DiscoveryError as exc:
        if exc.error_class == "robots_disallowed":
            ctx.stats.robots_skipped += 1
        error = from_discovery(exc)
    except ScrapeStop as stop:
        error = from_stop(stop)
    except PolicyViolation as exc:
        error = error_dict("policy_blocked", f"Refused by the discovery policy: {exc}"[:500])
    except Exception as exc:  # noqa: BLE001 - one source's bug must not crash the service
        _log.exception("scrape_crashed", extra={"run_id": ctx.run_id})
        error = error_dict("engine_unavailable", f"Internal scraper error ({type(exc).__name__}).")
    finally:
        await engine.aclose()
    items = builder.items
    if not items and job.ai_fallback and not job.ai_candidates:
        job.add_ai_candidates("no_items")
    if not items and error is None:
        ctx.warn("no_items", "The source answered but no postings were extracted")
    if error is not None:
        level = "warn" if items else "error"
        ctx.add_log(
            level,
            "scrape_stopped",
            str(error["message"]),
            url=error.get("url"),
            http_status=error.get("http_status"),
        )
    complete = job.complete and error is None
    cursor = {**job.cursor_in, **job.cursor_out, "v": 1}
    if complete:
        cursor["last_complete_at"] = now_ms()
    cursor = {k: v for k, v in cursor.items() if v is not None}
    outcome = "ok" if error is None else "partial" if items else "failed"
    ctx.add_log(
        "info",
        "scrape_finished",
        f"{outcome}: {len(items)} postings ({ctx.stats.invalid} invalid, "
        f"{ctx.stats.duplicates} duplicates), complete={complete}",
        ms=ctx.elapsed_ms(),
    )
    response: dict[str, Any] = {
        "v": 1,
        "outcome": outcome,
        "complete": complete,
        "items": items,
        "ai_candidates": job.ai_candidates,
        "cursor_state": cursor,
        "stats": ctx.stats.as_dict(ctx.elapsed_ms()),
        "error": error,
        "warnings": ctx.warnings(),
        "log": ctx.final_log(),
        "engine": versions(),
    }
    ScrapeResponse.model_validate(response)
    logs.event(
        _log,
        "scrape_done",
        level=logging.INFO,
        run_id=ctx.run_id,
        source=source["slug"],
        outcome=outcome,
        items=len(items),
        error_class=error["error_class"] if error else None,
        ms=ctx.elapsed_ms(),
    )
    return response
