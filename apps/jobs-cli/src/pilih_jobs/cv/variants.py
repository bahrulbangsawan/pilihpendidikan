"""CV variants: lookup, generation, review, download and headless render (08 §4.5–§8).

All network access goes through `ApiClient`; the PDF is downloaded with
`cv.download.download_verified` (SHA-256 + ETag, deleted on mismatch). File metadata seen
online (`sha256`) is remembered in `kv` so a cached PDF can be served offline (20 §10).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Final, cast
from urllib.parse import urlsplit

from rich.console import Console
from rich.table import Table

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import NetworkError
from pilih_jobs.contracts import ids
from pilih_jobs.cv.download import (
    DownloadResult,
    download_verified,
    from_cache,
    presentable_cv_name,
    rename_presentable,
    staging_dir,
)
from pilih_jobs.errors import NotFoundError, PilihError, UnavailableError, UsageError
from pilih_jobs.paths import Paths
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import EntityCache

TEMPLATES: Final = ("basic", "harvard", "simple", "standard")
DEFAULT_TEMPLATE: Final = "standard"
GENERATE_WAIT_S: Final = 120.0
GENERATE_POLL_S = 2.0
DOWNLOADABLE: Final = ("approved", "draft")

RenderPage = Callable[[str, float], Awaitable[dict[str, Any]]]


def _file_meta_key(file_id: str) -> str:
    return f"file_meta:{file_id}"


def remember_file(db: StateDB, file_view: dict[str, Any]) -> None:
    file_id = file_view.get("id")
    if isinstance(file_id, str):
        db.kv_set_json(
            _file_meta_key(file_id),
            {"sha256": file_view.get("sha256"), "size_bytes": file_view.get("size_bytes")},
        )


def remembered_sha256(db: StateDB, file_id: str) -> str | None:
    meta = db.kv_get_json(_file_meta_key(file_id))
    if isinstance(meta, dict):
        value = cast(dict[str, Any], meta).get("sha256")
        return value if isinstance(value, str) else None
    return None


async def list_base_cvs(api: ApiClient) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = cast(dict[str, Any], await api.get("/api/v1/cvs", {"cursor": cursor}))
        items.extend(cast(list[dict[str, Any]], page.get("items") or []))
        cursor = cast(str | None, page.get("next_cursor"))
        if not cursor:
            return items


async def get_variant(
    api: ApiClient, db: StateDB, issuer: str, cvv_id: str, *, cv_data: bool = False
) -> dict[str, Any]:
    params = {"include": "cv_data"} if cv_data else None
    detail = cast(dict[str, Any], await api.get(f"/api/v1/cv-variants/{cvv_id}", params))
    EntityCache(db, issuer).put("cv_variant", cast(dict[str, Any], detail["cv_variant"]))
    file_view = detail.get("file")
    if isinstance(file_view, dict):
        remember_file(db, cast(dict[str, Any], file_view))
    return detail


async def resolve_variant_id(api: ApiClient, ref: str) -> tuple[str, dict[str, Any] | None]:
    """`cvv_…` as is; `app_…` → the application's attached (else newest usable) variant."""
    if ids.is_id("cvv", ref):
        return ref, None
    if not ids.is_id("app", ref):
        raise UsageError(f"{ref!r} is neither a cvv_… nor an app_… id.")
    detail = cast(dict[str, Any], await api.get(f"/api/v1/applications/{ref}"))
    app = cast(dict[str, Any], detail["application"])
    attached = app.get("cv_variant_id")
    if isinstance(attached, str):
        return attached, detail
    variants = sorted(
        (
            v
            for v in cast(list[dict[str, Any]], detail.get("cv_variants") or [])
            if v.get("status") in ("approved", "draft", "generating")
        ),
        key=lambda v: int(v.get("created_at") or 0),
        reverse=True,
    )
    if not variants:
        raise NotFoundError(f"{ref} has no CV variant yet.", hint=f"pilih-jobs cv generate {ref}")
    return str(variants[0]["id"]), detail


async def generate_variant(
    api: ApiClient,
    application_id: str,
    *,
    base_cv_id: str | None,
    template: str,
    tailor: bool,
    wait: bool,
    db: StateDB,
    issuer: str,
    sleep: Callable[[float], Awaitable[None]] | None = None,
    timeout_s: float = GENERATE_WAIT_S,
) -> dict[str, Any]:
    if template not in TEMPLATES:
        raise UsageError(f"--template must be one of {', '.join(TEMPLATES)}.")
    base = base_cv_id or await default_base_cv(api, application_id)
    data = cast(
        dict[str, Any],
        await api.post(
            f"/api/v1/applications/{application_id}/cv-variants",
            {"base_cv_id": base, "template": template, "tailor": tailor},
        ),
    )
    variant = cast(dict[str, Any], data["cv_variant"])
    EntityCache(db, issuer).put("cv_variant", variant)
    if not wait:
        return variant
    deadline = time.monotonic() + timeout_s
    while variant.get("status") == "generating" and time.monotonic() < deadline:
        await (sleep or asyncio.sleep)(GENERATE_POLL_S)
        detail = await get_variant(api, db, issuer, str(variant["id"]))
        variant = cast(dict[str, Any], detail["cv_variant"])
    return variant


async def default_base_cv(api: ApiClient, application_id: str) -> str:
    detail = cast(dict[str, Any], await api.get(f"/api/v1/applications/{application_id}"))
    base = cast(dict[str, Any], detail["application"]).get("base_cv_id")
    if isinstance(base, str) and base:
        return base
    cvs = [c for c in await list_base_cvs(api) if not c.get("is_tailored")]
    if not cvs:
        raise NotFoundError(
            "No base CV found; create one at cv.pilihpendidikan.com first.", code="no_base_cv"
        )
    return str(cvs[0]["id"])


# ---------------------------------------------------------------------- diff
def diff_summary(diff: dict[str, Any]) -> dict[str, Any]:
    bullets = cast(list[dict[str, Any]], diff.get("bullets") or [])
    operations: dict[str, int] = {}
    for bullet in bullets:
        op = str(bullet.get("operation") or "keep")
        operations[op] = operations.get(op, 0) + 1
    order = cast(dict[str, Any], diff.get("section_order") or {})
    summary = cast(dict[str, Any], diff.get("summary") or {})
    return {
        "bullets": len(bullets),
        "operations": operations,
        "excluded_entries": len(cast(list[Any], diff.get("excluded_entries") or [])),
        "section_order_changed": order.get("from") != order.get("to"),
        "summary_changed": bool(summary) and summary.get("from") != summary.get("to"),
        "notes_for_user": list(cast(list[str], diff.get("notes_for_user") or [])),
        "prompt_version": diff.get("prompt_version"),
    }


def render_diff(console: Console, diff: dict[str, Any]) -> None:
    """The variant diff in the terminal (08 §7): bullets with their sources, exclusions."""
    if not diff:
        console.print("No tailoring diff (the base CV is used as is).", markup=False)
        return
    order = cast(dict[str, Any], diff.get("section_order") or {})
    if order.get("from") != order.get("to"):
        console.print(
            f"Section order: {' > '.join(map(str, order.get('from') or []))}  →  "
            f"{' > '.join(map(str, order.get('to') or []))}",
            markup=False,
        )
    summary = cast(dict[str, Any], diff.get("summary") or {})
    if summary and summary.get("from") != summary.get("to"):
        console.print("Summary:", markup=False, style="bold")
        console.print(f"  - {summary.get('from', '')}", markup=False, style="red")
        console.print(f"  + {summary.get('to', '')}", markup=False, style="green")
    table = Table("entry", "operation", "text", "sources", box=None, header_style="bold")
    for bullet in cast(list[dict[str, Any]], diff.get("bullets") or []):
        sources = cast(list[dict[str, Any]], bullet.get("sources") or [])
        table.add_row(
            str(bullet.get("entry_id", "")),
            str(bullet.get("operation", "")),
            str(bullet.get("text", "")),
            "; ".join(str(s.get("text") or s.get("id") or "") for s in sources),
        )
    if table.row_count:
        console.print(table)
    for entry in cast(list[dict[str, Any]], diff.get("excluded_entries") or []):
        console.print(
            f"excluded: {entry.get('section')}/{entry.get('label') or entry.get('entry_id')}",
            markup=False,
            style="dim",
        )
    for note in cast(list[str], diff.get("notes_for_user") or []):
        console.print(f"note: {note}", markup=False, style="yellow")


# ---------------------------------------------------------------------- download
async def _presentable_name(api: ApiClient, variant: dict[str, Any]) -> str:
    full_name: str | None = None
    company: str | None = None
    try:
        facts = cast(dict[str, Any], await api.get("/api/v1/profile/facts"))
        for fact in cast(list[dict[str, Any]], facts.get("facts") or []):
            if fact.get("key") == "contact.full_name" and isinstance(fact.get("value"), str):
                full_name = cast(str, fact["value"])
        application_id = variant.get("application_id")
        if isinstance(application_id, str):
            detail = cast(dict[str, Any], await api.get(f"/api/v1/applications/{application_id}"))
            company = cast(dict[str, Any], detail.get("posting") or {}).get("company_name")
    except (PilihError, KeyError):
        pass
    return presentable_cv_name(full_name, company)


async def download_variant(
    api: ApiClient,
    db: StateDB,
    issuer: str,
    paths: Paths,
    ref: str,
    *,
    out: Path | None = None,
) -> dict[str, Any]:
    """`cv download` (08 §8): approved (or draft, with a warning) PDF, verified, staged."""
    try:
        cvv_id, _ = await resolve_variant_id(api, ref)
        detail = await get_variant(api, db, issuer, cvv_id)
    except NetworkError as exc:
        return _download_offline(db, issuer, paths, ref, out=out, cause=exc)
    variant = cast(dict[str, Any], detail["cv_variant"])
    status = variant.get("status")
    if status not in DOWNLOADABLE:
        raise PilihError(
            f"{cvv_id} is {status}; only approved (or draft) variants can be downloaded.",
            code="cv_not_ready",
        )
    file_view = cast(dict[str, Any] | None, detail.get("file"))
    if not file_view or not variant.get("file_id"):
        raise PilihError(
            f"{cvv_id} has no rendered PDF yet.",
            code="cv_not_rendered",
            hint=f"pilih-jobs cv render {cvv_id}",
        )
    sha256 = str(file_view["sha256"])
    target = _target(paths, cvv_id, out)
    result = await download_verified(api, str(file_view["id"]), target, sha256, paths=paths)
    path = result.path
    if _rename_staged(out):
        path = rename_presentable(path, await _presentable_name(api, variant))
    data: dict[str, Any] = {"cv_variant_id": cvv_id, "status": status, **_as(result, path)}
    if status == "draft":
        data["warning"] = "This variant is still a draft (not approved)."
    return data


def _rename_staged(out: Path | None) -> bool:
    """Staged copies get the employer-facing name; an explicit `--out FILE` is kept."""
    return out is None or out.is_dir()


def _target(paths: Paths, cvv_id: str, out: Path | None) -> Path:
    if out is None:
        return staging_dir(paths, cvv_id) / f"cv-{cvv_id}.pdf"
    if out.is_dir():
        return out / f"cv-{cvv_id}.pdf"
    return out


def _as(result: DownloadResult, path: Path) -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": result.sha256,
        "size_bytes": result.size_bytes,
        "from_cache": result.from_cache,
    }


def _download_offline(
    db: StateDB, issuer: str, paths: Paths, ref: str, *, out: Path | None, cause: NetworkError
) -> dict[str, Any]:
    variant = EntityCache(db, issuer).get("cv_variant", ref) if ref.startswith("cvv_") else None
    file_id = cast(str | None, variant.get("file_id")) if variant else None
    sha256 = remembered_sha256(db, file_id) if file_id else None
    if variant is None or sha256 is None:
        raise UnavailableError(
            f"Offline and {ref} is not in the local cache: {cause.message}"
        ) from cause
    cvv_id = str(variant["id"])
    result = from_cache(paths, sha256, _target(paths, cvv_id, out))
    if result is None:
        raise UnavailableError(f"Offline and the PDF of {cvv_id} is not cached.") from cause
    return {
        "cv_variant_id": cvv_id,
        "status": variant.get("status"),
        "offline": True,
        **_as(result, result.path),
    }


# ---------------------------------------------------------------------- decide
async def approve_variant(api: ApiClient, cvv_id: str, revision: int) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        await api.post(f"/api/v1/cv-variants/{cvv_id}/approve", {"base_revision": revision}),
    )


async def reject_variant(
    api: ApiClient, cvv_id: str, revision: int, reason: str | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {"base_revision": revision}
    if reason:
        body["reason"] = reason[:500]
    return cast(dict[str, Any], await api.post(f"/api/v1/cv-variants/{cvv_id}/reject", body))


# ---------------------------------------------------------------------- render
async def render_variant(api: ApiClient, cvv_id: str, render_page: RenderPage) -> dict[str, Any]:
    """`cv render` (08 §6.3, PLAN C8): ticket → headless render page → uploaded `cv_pdf`."""
    ticket = cast(dict[str, Any], await api.post(f"/api/v1/cv-variants/{cvv_id}/render-ticket"))
    url = str(ticket["url"])
    if urlsplit(url).scheme not in ("https", "http"):
        raise PilihError("The render ticket URL is not http(s).", code="render_failed")
    rendered = await render_page(url, 60.0)
    if rendered.get("status") != "done" or not isinstance(rendered.get("file_id"), str):
        raise PilihError(
            str(rendered.get("message") or "The render page reported an error."),
            code="render_failed",
        )
    return {
        "cv_variant_id": cvv_id,
        "file_id": rendered["file_id"],
        "sha256": rendered.get("sha256"),
    }
