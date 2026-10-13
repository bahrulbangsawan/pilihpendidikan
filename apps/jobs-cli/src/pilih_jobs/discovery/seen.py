"""Deduplication (15 §11, 20 §7): in-run fingerprint set and the local `seen_postings`.

- `RunDeduper` keeps the first occurrence of a fingerprint in a run; later ones count
  as `duplicates`.
- `LocalSeenCache` (state.db `seen_postings`): a fingerprint with the same `content_hash`
  uploaded within 24 h is sent as an *unchanged-only* item. Rows are written only after
  the server acknowledged the batch (`discovery.sync` flush hook), so a posting queued
  but never delivered is re-sent in full.
- The fingerprints seen in the last complete run of a source are kept in `kv` so a
  `304 Not Modified` listing still marks every posting as seen (15 §9).
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Final, cast

from pilih_jobs.storage.db import StateDB

UNCHANGED_WINDOW_MS: Final = 24 * 3600 * 1000
LAST_RUN_PREFIX: Final = "discovery:last:"


@dataclass(frozen=True)
class SeenEntry:
    fingerprint: str
    content_hash: str
    posting_id: str | None
    last_uploaded_at: int | None


class RunDeduper:
    def __init__(self) -> None:
        self._seen: set[str] = set()

    def add(self, fingerprint: str) -> bool:
        """True for the first occurrence of `fingerprint` in this run."""
        if fingerprint in self._seen:
            return False
        self._seen.add(fingerprint)
        return True

    def __contains__(self, fingerprint: object) -> bool:
        return fingerprint in self._seen


class LocalSeenCache:
    def __init__(self, db: StateDB | None, issuer: str) -> None:
        self.db = db
        self.issuer = issuer

    def get(self, fingerprint: str) -> SeenEntry | None:
        if self.db is None:
            return None
        row = self.db.query_one(
            "SELECT * FROM seen_postings WHERE issuer = ? AND fingerprint = ?",
            (self.issuer, fingerprint),
        )
        if row is None:
            return None
        return SeenEntry(
            fingerprint=str(row["fingerprint"]),
            content_hash=str(row["content_hash"]),
            posting_id=cast(str | None, row["posting_id"]),
            last_uploaded_at=cast(int | None, row["last_uploaded_at"]),
        )

    def is_unchanged(self, fingerprint: str, content_hash: str, now_ms: int) -> bool:
        entry = self.get(fingerprint)
        return (
            entry is not None
            and entry.content_hash == content_hash
            and entry.last_uploaded_at is not None
            and now_ms - entry.last_uploaded_at <= UNCHANGED_WINDOW_MS
        )

    def record(self, rows: Iterable[tuple[str, str, str | None]], *, uploaded_at: int) -> int:
        """Upsert `(fingerprint, content_hash, posting_id)` after the server accepted them."""
        if self.db is None:
            return 0
        count = 0
        with self.db.transaction() as conn:
            for fingerprint, content_hash, posting_id in rows:
                conn.execute(
                    "INSERT INTO seen_postings(issuer, fingerprint, content_hash, posting_id, "
                    "last_uploaded_at) VALUES(?,?,?,?,?) ON CONFLICT(issuer, fingerprint) DO "
                    "UPDATE SET content_hash = excluded.content_hash, posting_id = "
                    "COALESCE(excluded.posting_id, seen_postings.posting_id), "
                    "last_uploaded_at = excluded.last_uploaded_at",
                    (self.issuer, fingerprint, content_hash, posting_id, uploaded_at),
                )
                count += 1
        return count

    def forget(self, fingerprints: Iterable[str]) -> int:
        if self.db is None:
            return 0
        count = 0
        with self.db.transaction() as conn:
            for fingerprint in fingerprints:
                cursor = conn.execute(
                    "DELETE FROM seen_postings WHERE issuer = ? AND fingerprint = ?",
                    (self.issuer, fingerprint),
                )
                count += cursor.rowcount
        return count

    # ------------------------------------------------------------------ last complete run
    def last_run(self, source_key: str) -> list[tuple[str, str]]:
        if self.db is None:
            return []
        raw = self.db.kv_get(f"{LAST_RUN_PREFIX}{self.issuer}:{source_key}")
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return []
        out: list[tuple[str, str]] = []
        for entry in cast(list[Any], data) if isinstance(data, list) else []:
            if isinstance(entry, list) and len(cast(list[Any], entry)) == 2:
                fp, hash_ = cast(list[Any], entry)
                if isinstance(fp, str) and isinstance(hash_, str):
                    out.append((fp, hash_))
        return out

    def set_last_run(self, source_key: str, entries: Iterable[tuple[str, str]]) -> None:
        if self.db is None:
            return
        payload = json.dumps(sorted({(fp, h) for fp, h in entries}), separators=(",", ":"))
        self.db.kv_set(f"{LAST_RUN_PREFIX}{self.issuer}:{source_key}", payload)
