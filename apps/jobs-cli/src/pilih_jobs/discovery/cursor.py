"""Incremental crawling state, `job_sources.cursor_state` (15 §9).

```json
{"v": 1,
 "listing": {"etag": "W/\\"abc\\"", "last_modified": "Sat, 10 Oct 2026 08:00:00 GMT"},
 "watermark_updated_at": 1791683600000,
 "seen_refs_digest": "<sha256 of the sorted source_job_refs>",
 "detail_etags": {"<source_job_ref>": "\\"etag\\""}}
```

`detail_etags` is an LRU capped at 2,000 entries. The state is synced through the
run's `complete` call (only for complete source runs), so any device can continue.
"""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from collections.abc import Iterable, Mapping
from typing import Any, Final, cast

from pilih_jobs.discovery.jsonutil import obj

DETAIL_ETAGS_MAX: Final = 2000


class CursorState:
    def __init__(self, data: Mapping[str, Any] | None = None) -> None:
        raw: Mapping[str, Any] = data or {}
        listing_map = obj(raw.get("listing"))
        etag = listing_map.get("etag")
        modified = listing_map.get("last_modified")
        self.listing_etag: str | None = etag if isinstance(etag, str) and etag else None
        self.listing_last_modified: str | None = (
            modified if isinstance(modified, str) and modified else None
        )
        watermark = raw.get("watermark_updated_at")
        self.watermark: int | None = (
            watermark if isinstance(watermark, int) and not isinstance(watermark, bool) else None
        )
        digest = raw.get("seen_refs_digest")
        self.seen_refs_digest: str | None = digest if isinstance(digest, str) else None
        self.detail_etags: OrderedDict[str, str] = OrderedDict()
        etags = raw.get("detail_etags")
        if isinstance(etags, Mapping):
            for key, value in cast(Mapping[Any, Any], etags).items():
                if isinstance(key, str) and isinstance(value, str):
                    self.detail_etags[key] = value
        self._trim()
        self._extra = {
            k: v
            for k, v in raw.items()
            if k not in {"v", "listing", "watermark_updated_at", "seen_refs_digest", "detail_etags"}
        }

    def _trim(self) -> None:
        while len(self.detail_etags) > DETAIL_ETAGS_MAX:
            self.detail_etags.popitem(last=False)

    def detail_etag(self, ref: str) -> str | None:
        value = self.detail_etags.get(ref)
        if value is not None:
            self.detail_etags.move_to_end(ref)
        return value

    def set_detail_etag(self, ref: str, etag: str | None) -> None:
        if not etag:
            return
        self.detail_etags[ref] = etag
        self.detail_etags.move_to_end(ref)
        self._trim()

    def set_listing(self, etag: str | None, last_modified: str | None) -> None:
        self.listing_etag = etag or None
        self.listing_last_modified = last_modified or None

    def advance_watermark(self, value: int | None) -> None:
        if value is None:
            return
        if self.watermark is None or value > self.watermark:
            self.watermark = value

    @staticmethod
    def digest(refs: Iterable[str]) -> str:
        joined = "\n".join(sorted(set(refs)))
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = dict(self._extra)
        out["v"] = 1
        if self.listing_etag or self.listing_last_modified:
            out["listing"] = {
                "etag": self.listing_etag,
                "last_modified": self.listing_last_modified,
            }
        if self.watermark is not None:
            out["watermark_updated_at"] = self.watermark
        if self.seen_refs_digest:
            out["seen_refs_digest"] = self.seen_refs_digest
        if self.detail_etags:
            out["detail_etags"] = dict(self.detail_etags)
        return out

    def copy(self) -> CursorState:
        return CursorState(self.to_dict())
