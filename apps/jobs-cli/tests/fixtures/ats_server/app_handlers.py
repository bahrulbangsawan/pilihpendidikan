"""All fixture handlers in one map (scenarios, extraction cases, injection corpus)."""

from __future__ import annotations

from tests.fixtures.ats_server.extract_cases import extract_handlers
from tests.fixtures.ats_server.injection import injection_handlers
from tests.fixtures.ats_server.pages import scenario_handlers
from tests.fixtures.ats_server.server import Handler


def all_handlers() -> dict[str, Handler]:
    handlers: dict[str, Handler] = {}
    handlers.update(scenario_handlers())
    handlers.update(extract_handlers())
    handlers.update(injection_handlers())
    return handlers
