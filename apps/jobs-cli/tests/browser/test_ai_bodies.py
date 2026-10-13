"""TFIX-AI-BODIES through the real agent loop: real Chromium against the fixture ATS.

The FakeChannel answers a body that the contract JSON Schema refuses with `400
invalid_request`, exactly like `apps/api`; before the fix every apply below paused
`ai_unavailable` at the first form (leaf-5.1 #3). Each scenario must run to its normal
outcome, every `/api/v1/ai/*` body must be accepted, and together the scenarios must
exercise all four AI endpoints.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.browser.support import run
from tests.fixtures.ats_server import FixtureServer
from tests.fixtures.ats_server.fake_channel import FakeChannel
from tests.support.contract_schema import AI_REQUEST_SCHEMAS, ai_request_violations

pytestmark = pytest.mark.browser


async def test_TFIX_AI_BODIES_real_attempts_send_only_contract_valid_ai_bodies(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    seen: set[str] = set()
    # A job page with two apply entries (next-action picks one), the three-step wizard,
    # and the generic thank-you page after an XHR submit (unverified).
    for index, (path, status) in enumerate(
        (
            ("/entries/job", "submitted_verified"),
            ("/s2/step1", "submitted_verified"),
            ("/s12/apply", "submitted_unverified"),
        )
    ):
        channel = FakeChannel()
        result, channel, _ = await run(tmp_path / str(index), fixture_ats, path, channel=channel)
        assert channel.contract_violations == [], path
        assert "ai_unavailable" not in channel.pause_reasons(), path
        assert result.outcome == "submitted", path
        assert result.submission_status == status, path
        for endpoint, body in channel.ai_calls:
            assert ai_request_violations(endpoint, body) == [], (path, endpoint)
            seen.add(endpoint)
            if endpoint == "field-plan":
                assert "fact_keys" not in body
        fixture_ats.state.reset()
    assert seen == set(AI_REQUEST_SCHEMAS)
