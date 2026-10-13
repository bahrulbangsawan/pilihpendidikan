"""Fixtures for outbox/flusher tests: a controllable clock and an outbox on a temp state.db."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from pilih_jobs.api.client import ApiClient, StaticToken
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.outbox import Outbox
from tests.support.fake_api import FakeApi

ISSUER = "https://api.test"


class ManualClock:
    def __init__(self, start: int = 1_791_770_000_000) -> None:
        self.now = start

    def __call__(self) -> int:
        return self.now

    def advance(self, ms: int) -> None:
        self.now += ms


@pytest.fixture
def clock() -> ManualClock:
    return ManualClock()


@pytest.fixture
def db(tmp_path: Path) -> Iterator[StateDB]:
    database = StateDB(tmp_path / "state.db")
    yield database
    database.close()


@pytest.fixture
def outbox(db: StateDB, clock: ManualClock) -> Outbox:
    return Outbox(db, ISSUER, now=clock)


@pytest.fixture
def api_for(fake_api: FakeApi) -> Iterator[tuple[ApiClient, str]]:
    user = fake_api.add_user()
    access, _ = fake_api.issue_tokens(user)
    client = ApiClient(fake_api.issuer, tokens=StaticToken(access), transport=fake_api.transport)
    return client, user
