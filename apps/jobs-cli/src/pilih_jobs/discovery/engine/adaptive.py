"""Adaptive selector management (15 §6).

- **Storage path override (mandatory):** Scrapling's default store lives in
  site-packages; ours is `<data>/scrapling/adaptive.db` (per user, never synced).
- **Identifiers:** `"<adapter_id>:<source_org or host>:<field>"` — the host is repeated
  so `jobs.acme.com` and `careers.acme.com` never collide.
- **Save policy:** an element is saved only when its field was found by the *primary*
  selector and the extracted item passed validation (`confirm()` after validation), so a
  wrong relocation can never overwrite a good fingerprint.
- **Relocation threshold:** 60 % for required fields, 50 % for optional ones.
- **Reset:** `discover --reset-adaptive <source>` deletes that identifier prefix.
"""

from __future__ import annotations

import contextlib
import sqlite3
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Final
from urllib.parse import urljoin

from pilih_jobs.discovery.engine.page import ScraplingPage, clean_text
from pilih_jobs.discovery.types import ExtractionOutcome, ExtractionSpec, FieldSpec
from pilih_jobs.logging import get_logger
from pilih_jobs.paths import ensure_private_dir

_log = get_logger("discovery.adaptive")

REQUIRED_THRESHOLD: Final = 60
OPTIONAL_THRESHOLD: Final = 50
ITEM_FIELD: Final = "__item__"
MAX_ITEMS_PER_PAGE: Final = 500
CONFIDENCE_PRIMARY: Final = 0.8
CONFIDENCE_ADAPTIVE: Final = 0.6


def identifier(adapter_id: str, org: str, field: str) -> str:
    return f"{adapter_id}:{org.lower()}:{field}"


def identifier_prefix(adapter_id: str, org: str) -> str:
    return f"{adapter_id}:{org.lower()}:"


class AdaptiveStore:
    def __init__(self, path: Path, sqlite_storage: Any = None) -> None:
        self.path = path
        self._storage_cls: Any = sqlite_storage

    def selector_kwargs(self, url: str) -> dict[str, Any]:
        ensure_private_dir(self.path.parent)
        return {
            "adaptive": True,
            "storage": self._storage_cls,
            "storage_args": {"storage_file": str(self.path), "url": url},
        }

    def _connect(self) -> sqlite3.Connection | None:
        if not self.path.exists():
            return None
        return sqlite3.connect(str(self.path), timeout=5)

    def count(self, prefix: str = "") -> int:
        conn = self._connect()
        if conn is None:
            return 0
        with contextlib.closing(conn):
            try:
                row = conn.execute(
                    "SELECT COUNT(*) FROM storage WHERE identifier LIKE ? ESCAPE '\\'",
                    (_like_prefix(prefix),),
                ).fetchone()
            except sqlite3.OperationalError:
                return 0
        return int(row[0]) if row else 0

    def identifiers(self, prefix: str = "") -> list[str]:
        conn = self._connect()
        if conn is None:
            return []
        with contextlib.closing(conn):
            try:
                rows = conn.execute(
                    "SELECT identifier FROM storage WHERE identifier LIKE ? ESCAPE '\\' "
                    "ORDER BY identifier",
                    (_like_prefix(prefix),),
                ).fetchall()
            except sqlite3.OperationalError:
                return []
        return [str(r[0]) for r in rows]

    def reset(self, prefix: str) -> int:
        """Delete every stored element whose identifier starts with `prefix`."""
        if not prefix:
            raise ValueError("refusing to reset the whole adaptive store without a prefix")
        conn = self._connect()
        if conn is None:
            return 0
        with contextlib.closing(conn):
            try:
                cursor = conn.execute(
                    "DELETE FROM storage WHERE identifier LIKE ? ESCAPE '\\'",
                    (_like_prefix(prefix),),
                )
                conn.commit()
            except sqlite3.OperationalError:
                return 0
            return cursor.rowcount


def _like_prefix(prefix: str) -> str:
    escaped = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%"


# ---------------------------------------------------------------- extraction
def _query(
    scope: Any, field: FieldSpec, ident: str, *, adaptive: bool, threshold: int
) -> list[Any]:
    try:
        if field.css:
            return list(
                scope.css(
                    field.css,
                    identifier=ident,
                    adaptive=adaptive,
                    auto_save=False,
                    percentage=threshold,
                )
            )
        if field.xpath:
            return list(
                scope.xpath(
                    field.xpath,
                    identifier=ident,
                    adaptive=adaptive,
                    auto_save=False,
                    percentage=threshold,
                )
            )
    except Exception:  # noqa: BLE001 - an invalid configured selector is a miss
        return []
    return []


def _value(node: Any, field: FieldSpec, page: ScraplingPage) -> str:
    if field.attr:
        raw = clean_text(str(node.attrib.get(field.attr) or ""))
        if raw and field.attr in ("href", "src"):
            return urljoin(page.url, raw)
        return raw
    if field.html:
        return str(node.html_content)
    return ScraplingPage.node_text(node)


def extract_scope(
    page: ScraplingPage,
    scope: Any,
    spec: ExtractionSpec,
    *,
    org: str,
    adaptive_enabled: bool,
) -> ExtractionOutcome:
    values: dict[str, Any] = {}
    relocated: list[str] = []
    missing: list[str] = []
    saves: list[tuple[Any, str]] = []
    xpath_used = False
    for field in spec.fields:
        ident = identifier(spec.identifier_prefix, org, field.name)
        threshold = REQUIRED_THRESHOLD if field.required else OPTIONAL_THRESHOLD
        nodes = _query(scope, field, ident, adaptive=False, threshold=threshold)
        primary = bool(nodes)
        if not nodes and field.adaptive and adaptive_enabled:
            nodes = _query(scope, field, ident, adaptive=True, threshold=threshold)
        texts = [v for v in (_value(n, field, page) for n in nodes) if v]
        if not texts:
            if field.required:
                missing.append(field.name)
            continue
        values[field.name] = texts if field.many else texts[0]
        xpath_used = xpath_used or (field.css is None and field.xpath is not None)
        if primary:
            if field.adaptive and adaptive_enabled:
                saves.append((nodes[0], ident))
        else:
            relocated.append(field.name)
    method = "adaptive" if relocated else ("xpath" if xpath_used else "css")
    confidence = CONFIDENCE_ADAPTIVE if relocated else CONFIDENCE_PRIMARY
    return ExtractionOutcome(
        values=values,
        method=method,
        relocated_fields=relocated,
        missing_required=missing,
        confidence=confidence,
        pending_saves=saves,
    )


def item_scopes(
    page: ScraplingPage, spec: ExtractionSpec, *, org: str, adaptive_enabled: bool
) -> tuple[list[Any], Any | None, bool]:
    """Item containers of a listing page: (scopes, element to save, relocated?)."""
    if not spec.item_css:
        return [page.selector], None, False
    ident = identifier(spec.identifier_prefix, org, ITEM_FIELD)
    container = FieldSpec(ITEM_FIELD, css=spec.item_css, required=True)
    nodes = _query(page.selector, container, ident, adaptive=False, threshold=REQUIRED_THRESHOLD)
    if nodes:
        return nodes[:MAX_ITEMS_PER_PAGE], nodes[0], False
    if not adaptive_enabled:
        return [], None, False
    relocated = _query(page.selector, container, ident, adaptive=True, threshold=REQUIRED_THRESHOLD)
    if not relocated:
        return [], None, False
    first = relocated[0]
    try:
        similar = list(first.find_similar())
    except Exception:  # noqa: BLE001 - find_similar is best effort
        similar = []
    return [first, *similar][:MAX_ITEMS_PER_PAGE], None, True


def confirm(outcomes: Iterable[ExtractionOutcome]) -> int:
    """Save the primary elements of validated outcomes (15 §6 save policy)."""
    saved: set[str] = set()
    for outcome in outcomes:
        for element, ident in outcome.pending_saves:
            if ident in saved:
                continue
            try:
                element.save(element, ident)
            except Exception as exc:  # noqa: BLE001 - adaptive storage is best effort
                _log.debug("adaptive save failed for %s: %s", ident, type(exc).__name__)
                continue
            saved.add(ident)
        outcome.pending_saves.clear()
    return len(saved)
