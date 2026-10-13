"""T20-04: the entity cache keeps the higher revision and applies tombstones (20 §4.1)."""

from __future__ import annotations

from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import EntityCache, apply_change

ISSUER = "https://api.test"


def _apply(
    db: StateDB, revision: int, op: str = "upsert", stage: str = "ready", entity_id: str = "app_1"
) -> bool:
    with db.transaction() as conn:
        return apply_change(
            conn,
            issuer=ISSUER,
            entity="application",
            entity_id=entity_id,
            revision=revision,
            op=op,
            data={"id": entity_id, "revision": revision, "stage": stage},
            fetched_at=1,
        )


def test_T20_04_lower_revision_never_overwrites_higher(db: StateDB) -> None:
    cache = EntityCache(db, ISSUER)
    assert _apply(db, 5, stage="applied")
    assert not _apply(db, 3, stage="saved")  # out-of-order duplicate
    assert not _apply(db, 5, stage="saved")  # same revision is a no-op
    assert cache.get("application", "app_1") == {"id": "app_1", "revision": 5, "stage": "applied"}
    assert _apply(db, 6, stage="interviewing")
    assert cache.revision("application", "app_1") == 6


def test_T20_04_tombstones_apply_and_hide_rows(db: StateDB) -> None:
    cache = EntityCache(db, ISSUER)
    _apply(db, 2)
    assert _apply(db, 3, op="delete")
    assert cache.get("application", "app_1") is None
    assert cache.get("application", "app_1", include_deleted=True) == {
        "id": "app_1",
        "revision": 2,
        "stage": "ready",
    }
    assert not _apply(db, 2)  # a stale upsert cannot resurrect it
    assert cache.list("application") == []
    assert _apply(db, 4, stage="saved")  # a newer upsert (restore) does
    assert cache.get("application", "app_1") is not None


def test_T20_04_tombstone_without_prior_row(db: StateDB) -> None:
    assert _apply(db, 1, op="delete", entity_id="app_9")
    assert EntityCache(db, ISSUER).get("application", "app_9") is None


def test_T20_04_read_through_put_list_and_count(db: StateDB) -> None:
    cache = EntityCache(db, ISSUER)
    cache.put("approval", {"id": "apr_1", "revision": 1, "state": "pending"})
    cache.put("approval", {"id": "apr_2", "revision": 1, "state": "approved"})
    assert cache.count("approval", lambda a: a["state"] == "pending") == 1
    assert not cache.put("approval", {"id": "apr_1", "revision": 0, "state": "expired"})
    assert [a["id"] for a in cache.list("approval")] == ["apr_1", "apr_2"]
    cache.put("settings", {"user_id": "usr_1", "revision": 2})
    assert cache.get("settings", "usr_1") is not None
    assert cache.clear() == 3


def test_T20_04_issuers_are_isolated(db: StateDB) -> None:
    EntityCache(db, "https://a.test").put("rule", {"id": "rul_1", "revision": 1})
    assert EntityCache(db, "https://b.test").get("rule", "rul_1") is None
