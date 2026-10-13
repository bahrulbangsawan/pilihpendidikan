"""Live canaries (15 §16): one public board per stable adapter, opt-in only.

Skipped unless `PILIH_JOBS_LIVE=1`; never run against Workday, LinkedIn or Indeed.
"""

from __future__ import annotations

import os
import random
from pathlib import Path

import pytest

from pilih_jobs.discovery.clock import RealClock
from pilih_jobs.discovery.engine import ScraplingJobEngine
from tests.discovery.support import Harness, resolved

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        os.environ.get("PILIH_JOBS_LIVE") != "1", reason="live canary (PILIH_JOBS_LIVE=1)"
    ),
]

BOARDS = [
    ("greenhouse", {"board_token": os.environ.get("PILIH_JOBS_LIVE_GREENHOUSE", "gitlab")}),
    ("lever", {"site": os.environ.get("PILIH_JOBS_LIVE_LEVER", "palantir")}),
    ("ashby", {"job_board_name": os.environ.get("PILIH_JOBS_LIVE_ASHBY", "ramp")}),
]


@pytest.mark.parametrize(("adapter_id", "config"), BOARDS)
async def test_T15_LIVE_canary(adapter_id: str, config: dict[str, str], tmp_path: Path) -> None:
    engine = ScraplingJobEngine(
        data_dir=tmp_path, cache_dir=tmp_path, clock=RealClock(), rng=random.Random()
    )
    try:
        outcome = await Harness(engine).run(resolved(adapter_id, config), max_pages=1)
    finally:
        await engine.aclose()
    assert outcome.stop is None, outcome.stop
    assert outcome.stats.found > 0
    assert outcome.stats.invalid == 0
