"""The one place that imports Scrapling (D-36), inside the policy's import window.

Only explicit modules are imported — `scrapling.fetchers.requests` (the static HTTP
fetchers; 0.4.15 has no `fetchers.static` module), `scrapling.fetchers.chrome` (plain
Playwright), the parser, the SQLite adaptive storage and the spiders — never the lazy
`scrapling.fetchers` attribute resolver. Scrapling's own console logging is routed into
the redacting pilih-jobs log instead of stderr.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import cache
from typing import Any, cast

from pilih_jobs.discovery.engine import policy
from pilih_jobs.logging import get_logger
from pilih_jobs.version import dependency_version

_forward_target = get_logger("discovery.scrapling")


class _ForwardHandler(logging.Handler):
    """Hands Scrapling's records to the pilih-jobs logger (file handler + redaction)."""

    def emit(self, record: logging.LogRecord) -> None:
        if _forward_target.isEnabledFor(record.levelno):
            _forward_target.handle(record)


@dataclass(frozen=True)
class ScraplingApi:
    """Scrapling entry points (typed `Any`: the library is beta and loosely typed)."""

    version: str
    fetcher_session: Any
    dynamic_session: Any
    selector: Any
    sqlite_storage: Any
    response: Any
    spider: Any
    sitemap_spider: Any
    crawl_rule: Any
    link_extractor: Any
    request: Any
    curl_error: Any


def quiet_logger(logger: logging.Logger, *, level: int = logging.WARNING) -> None:
    """Drop Scrapling's console handlers and forward to the pilih-jobs log instead."""
    handlers: list[logging.Handler] = list(logger.handlers)
    for handler in handlers:
        if isinstance(handler, logging.StreamHandler | _ForwardHandler):
            logger.removeHandler(cast(logging.Handler, handler))
    logger.addHandler(_ForwardHandler())
    logger.setLevel(level)
    logger.propagate = False


@cache
def load() -> ScraplingApi:
    with policy.scrapling_import_window():
        from curl_cffi.curl import CurlError
        from scrapling.core.storage import SQLiteStorageSystem
        from scrapling.engines.toolbelt.custom import Response
        from scrapling.fetchers.chrome import (
            AsyncDynamicSession,  # pyright: ignore[reportPrivateImportUsage] - explicit module, D-36
        )
        from scrapling.fetchers.requests import FetcherSession
        from scrapling.parser import Selector
        from scrapling.spiders import CrawlRule, LinkExtractor, Request, SitemapSpider, Spider
    quiet_logger(logging.getLogger("scrapling"))
    return ScraplingApi(
        version=dependency_version("scrapling") or "unknown",
        fetcher_session=FetcherSession,
        dynamic_session=AsyncDynamicSession,
        selector=Selector,
        sqlite_storage=SQLiteStorageSystem,
        response=Response,
        spider=Spider,
        sitemap_spider=SitemapSpider,
        crawl_rule=CrawlRule,
        link_extractor=LinkExtractor,
        request=Request,
        curl_error=CurlError,
    )
