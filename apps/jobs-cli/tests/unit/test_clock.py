"""T20-05: clock offset correction and the monotonic lease deadline (20 §9)."""

from __future__ import annotations

from pathlib import Path

from pilih_jobs.clock import LEASE_SAFETY_MARGIN_MS, ClockSync, corrected
from pilih_jobs.contracts import ids
from pilih_jobs.storage.db import StateDB


class Clocks:
    def __init__(self) -> None:
        self.wall = 1_791_770_000_000
        self.mono = 5_000_000

    def get_wall(self) -> int:
        return self.wall

    def get_mono(self) -> int:
        return self.mono


def test_T20_05_offset_corrects_outgoing_timestamps() -> None:
    clocks = Clocks()
    clock = ClockSync(wall=clocks.get_wall, monotonic=clocks.get_mono)
    clock.observe(clocks.wall + 2 * 3_600_000)  # local clock 2 h behind (20 §12 F10)
    assert clock.offset_ms == 2 * 3_600_000
    assert clock.now_ms() == clocks.wall + 2 * 3_600_000
    assert corrected(clocks.wall - 5_000, clock) == clocks.wall + 2 * 3_600_000 - 5_000


def test_T20_05_lease_deadline_uses_the_monotonic_clock() -> None:
    clocks = Clocks()
    clock = ClockSync(wall=clocks.get_wall, monotonic=clocks.get_mono)
    server_time = 1_800_000_000_000
    deadline = clock.lease_deadline(server_time + 120_000, server_time)
    assert deadline == clocks.mono + 120_000 - LEASE_SAFETY_MARGIN_MS
    clocks.wall += 10 * 3_600_000  # a wall-clock jump does not move the deadline
    assert clock.lease_deadline(server_time + 120_000, server_time) == deadline
    clocks.mono += 110_001
    assert clock.monotonic_ms() > deadline


def test_T20_05_http_date_and_persistence(tmp_path: Path) -> None:
    db = StateDB(tmp_path / "state.db")
    db.upsert_account("https://api.test", "usr_x", None)
    clocks = Clocks()
    clock = ClockSync(
        wall=clocks.get_wall, monotonic=clocks.get_mono, db=db, issuer="https://api.test"
    )
    sample = clock.observe_http_date("Mon, 12 Oct 2026 10:00:00 GMT")
    assert sample is not None
    row = db.account("https://api.test")
    assert row is not None
    assert row["last_seen_server_time"] == sample.server_time_ms
    restored = ClockSync(wall=clocks.get_wall, monotonic=clocks.get_mono, db=db)
    assert restored.offset_ms == clock.offset_ms
    assert clock.observe_http_date("not a date") is None


def test_T20_05_ulids_use_the_corrected_clock() -> None:
    clocks = Clocks()
    clock = ClockSync(wall=clocks.get_wall, monotonic=clocks.get_mono)
    clock.observe(clocks.wall + 3_600_000)
    clock.install()
    try:
        value = ids.new_id("evt")
        assert ids.id_timestamp(value) == clocks.wall + 3_600_000
    finally:
        ids.set_time_source(None)
