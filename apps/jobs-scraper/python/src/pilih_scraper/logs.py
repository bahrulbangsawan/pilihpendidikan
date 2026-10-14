"""Structured JSON logging to stdout (Workers Logs / container logs).

Lines carry ids, URLs, counts and timings only — never page bodies (24 §8).
"""

from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any, Final

LOGGER_NAME: Final = "pilih_scraper"
_RESERVED: Final = frozenset(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, Any] = {
            "ts": int(time.time() * 1000),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage()[:500],
        }
        line.update(
            {
                key: value
                for key, value in record.__dict__.items()
                if key not in _RESERVED and not key.startswith("_")
            }
        )
        if record.exc_info and record.exc_info[0] is not None:
            line["exc"] = record.exc_info[0].__name__
        return json.dumps(line, default=str, ensure_ascii=False)


def configure(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    for name, lvl in ((LOGGER_NAME, level), ("pilih_jobs", logging.WARNING)):
        logger = logging.getLogger(name)
        logger.handlers = [handler]
        logger.setLevel(lvl)
        logger.propagate = False


def get_logger(name: str = "") -> logging.Logger:
    return logging.getLogger(f"{LOGGER_NAME}.{name}" if name else LOGGER_NAME)


def event(logger: logging.Logger, name: str, level: int = logging.INFO, **fields: Any) -> None:
    logger.log(level, name, extra={"event": name, **fields})
