"""`cv list|generate|show|review|download|render` (08, 16 §3.3).

- `generate` asks the API to tailor a variant (`cv:write` + `ai:invoke`; `cv:write` is a
  step-up on first use, 17 §5.1); `--wait` polls until it leaves `generating`;
- `review` prints the diff (08 §7), downloads the PDF to the staging directory and approves
  or rejects with `base_revision` (`cv:write`);
- `download` verifies SHA-256 and the ETag, deletes on mismatch, names the staged copy
  `<Full_Name>_CV_<Company>.pdf` and works offline from the verified cache (08 §8, 20 §10);
- `render` renders a variant headlessly through a render ticket (normally the worker's
  `render_cv` task does this, 08 §6.3).
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any, cast

import typer
from rich.console import Console

from pilih_jobs.cli.board import check_app_id, require_scope
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.contracts import ids
from pilih_jobs.cv import variants
from pilih_jobs.errors import InputRequiredError, UsageError

group = typer.Typer(name="cv", help="Base CVs and tailored CV variants (08).", no_args_is_help=True)


def _variant_ref(value: str) -> str:
    if not (ids.is_id("cvv", value) or ids.is_id("app", value)):
        raise UsageError(f"{value!r} is neither a cvv_… nor an app_… id.")
    return value


@group.command("list")
def list_cmd(ctx: typer.Context) -> None:
    """List base CVs (GET /api/v1/cvs)."""
    st = state(ctx)
    rt = st.runtime()

    async def run() -> list[dict[str, Any]]:
        async with rt.api_client() as api:
            return await variants.list_base_cvs(api)

    items = st.run(run())

    def human(console: Console, value: Any) -> None:
        rows = cast(list[dict[str, Any]], cast(dict[str, Any], value)["items"])
        console.print(items_table(rows) if rows else "(no CVs)")

    st.out.result({"items": items}, human=human)


@group.command("generate")
def generate_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    base: Annotated[str | None, typer.Option("--base", help="Base CV slug (apps/cv).")] = None,
    template: Annotated[
        str, typer.Option("--template", help="basic|harvard|simple|standard")
    ] = variants.DEFAULT_TEMPLATE,
    no_tailor: Annotated[
        bool, typer.Option("--no-tailor", help="Use the base CV as is (no AI rewrite).")
    ] = False,
    wait: Annotated[bool, typer.Option("--wait", help="Wait until generation finishes.")] = False,
) -> None:
    """Request a tailored variant (POST …/cv-variants)."""
    st = state(ctx)
    check_app_id(app_id)
    if template not in variants.TEMPLATES:
        raise UsageError(f"--template must be one of {', '.join(variants.TEMPLATES)}.")
    rt = st.runtime()
    require_scope(st, rt, "cv:write", purpose="Generating a CV variant")

    async def run() -> dict[str, Any]:
        async with rt.api_client() as api:
            return await variants.generate_variant(
                api,
                app_id,
                base_cv_id=base,
                template=template,
                tailor=not no_tailor,
                wait=wait,
                db=rt.db,
                issuer=rt.issuer,
            )

    variant = st.run(run())
    st.out.result(
        {"cv_variant": variant},
        human=lambda c, v: c.print(
            f"{v['cv_variant']['id']}: {v['cv_variant']['status']}", markup=False
        ),
    )


def _show_human(console: Console, value: Any) -> None:
    info = cast(dict[str, Any], value)
    variant = cast(dict[str, Any], info["cv_variant"])
    file_view = cast(dict[str, Any] | None, info.get("file"))
    console.print(
        key_value_table(
            {
                "variant": variant["id"],
                "status": variant.get("status"),
                "application": variant.get("application_id"),
                "base CV": variant.get("base_cv_id"),
                "template": variant.get("template"),
                "pdf": f"{file_view['id']} (sha256 {file_view['sha256']})" if file_view else None,
                "edited after approval": info.get("edited_after_approval"),
            }
        )
    )
    summary = cast(dict[str, Any] | None, info.get("diff_summary"))
    if summary:
        console.print(key_value_table(summary, title="diff"))
    if info.get("show_diff"):
        variants.render_diff(console, cast(dict[str, Any], variant.get("diff") or {}))


@group.command("show")
def show_cmd(
    ctx: typer.Context,
    cvv_id: Annotated[str, typer.Argument(help="cvv_… id")],
    diff: Annotated[bool, typer.Option("--diff", help="Print the full tailoring diff.")] = False,
) -> None:
    """Variant status and diff summary."""
    st = state(ctx)
    if not ids.is_id("cvv", cvv_id):
        raise UsageError(f"{cvv_id!r} is not a cvv_… id.")
    rt = st.runtime()

    async def run() -> dict[str, Any]:
        async with rt.api_client() as api:
            return await variants.get_variant(api, rt.db, rt.issuer, cvv_id)

    detail = st.run(run())
    variant = cast(dict[str, Any], detail["cv_variant"])
    data = {
        **detail,
        "diff_summary": variants.diff_summary(cast(dict[str, Any], variant.get("diff") or {})),
    }
    if diff and not st.out.json_mode:
        data["show_diff"] = True
    st.out.result(data, human=_show_human)


def _review_decision(st: CliState, approve: bool, reject: bool) -> str | None:
    if approve:
        return "approve"
    if reject:
        return "reject"
    if not st.interactive:
        raise InputRequiredError(
            "Pass --approve or --reject.",
            details={"needed": {"decision": ["--approve", "--reject"]}},
        )
    choice = st.prompt("[a]pprove / [r]eject / [s]kip", needed="decision").strip().lower()
    return {"a": "approve", "r": "reject"}.get(choice[:1])


@group.command("review")
def review_cmd(
    ctx: typer.Context,
    ref: Annotated[str, typer.Argument(help="app_… or cvv_… id")],
    approve: Annotated[bool, typer.Option("--approve", help="Approve the variant.")] = False,
    reject: Annotated[bool, typer.Option("--reject", help="Reject the variant.")] = False,
    reason: Annotated[str | None, typer.Option("--reason", help="Why it was rejected.")] = None,
) -> None:
    """Print the diff, download the PDF, then approve or reject (cv:write, 08 §7)."""
    st = state(ctx)
    _variant_ref(ref)
    if approve and reject:
        raise UsageError("--approve and --reject are mutually exclusive.")
    rt = st.runtime()
    if approve or reject or st.interactive:
        require_scope(st, rt, "cv:write", purpose="Reviewing a CV variant")

    async def run() -> dict[str, Any]:
        async with rt.api_client() as api:
            cvv_id, _ = await variants.resolve_variant_id(api, ref)
            detail = await variants.get_variant(api, rt.db, rt.issuer, cvv_id)
            variant = cast(dict[str, Any], detail["cv_variant"])
            out: dict[str, Any] = {
                "cv_variant": variant,
                "diff_summary": variants.diff_summary(
                    cast(dict[str, Any], variant.get("diff") or {})
                ),
            }
            if detail.get("file"):
                downloaded = await variants.download_variant(
                    api, rt.db, rt.issuer, rt.paths, cvv_id
                )
                out["pdf"] = downloaded["path"]
            if not st.out.json_mode and not st.out.quiet:
                console = st.out.console(err=True)
                variants.render_diff(console, cast(dict[str, Any], variant.get("diff") or {}))
                if out.get("pdf"):
                    console.print(f"PDF: {out['pdf']}", markup=False)
            decision = _review_decision(st, approve, reject)
            if decision is None or variant.get("status") not in ("draft",):
                out["decided"] = False
                return out
            if decision == "approve":
                result = await variants.approve_variant(api, cvv_id, int(variant["revision"]))
            else:
                result = await variants.reject_variant(
                    api, cvv_id, int(variant["revision"]), reason
                )
            out["cv_variant"] = result["cv_variant"]
            out["decided"] = True
            out["decision"] = decision
            return out

    data = st.run(run())
    st.out.result(
        data,
        human=lambda c, v: c.print(
            f"{v['cv_variant']['id']}: {v['cv_variant']['status']}", markup=False
        ),
    )


@group.command("download")
def download_cmd(
    ctx: typer.Context,
    ref: Annotated[str, typer.Argument(help="cvv_… or app_… id")],
    out: Annotated[
        Path | None, typer.Option("--out", help="File or directory to write to.")
    ] = None,
) -> None:
    """Download the approved PDF (staging dir or --out), verifying SHA-256 and ETag."""
    st = state(ctx)
    _variant_ref(ref)
    rt = st.runtime()

    async def run() -> dict[str, Any]:
        async with rt.api_client() as api:
            return await variants.download_variant(
                api, rt.db, rt.issuer, rt.paths, ref, out=out.expanduser() if out else None
            )

    data = st.run(run())
    if data.get("warning"):
        st.out.notice(str(data["warning"]))
    st.out.result(
        data, human=lambda c, v: c.print(f"{v['path']} (sha256 {v['sha256']})", markup=False)
    )


@group.command("render")
def render_cmd(ctx: typer.Context, cvv_id: Annotated[str, typer.Argument(help="cvv_… id")]) -> None:
    """Headless-render a variant PDF and upload it (normally the worker's render_cv task)."""
    st = state(ctx)
    if not ids.is_id("cvv", cvv_id):
        raise UsageError(f"{cvv_id!r} is not a cvv_… id.")
    rt = st.runtime()
    require_scope(st, rt, "cv:write", purpose="Rendering a CV variant")

    async def render_page(url: str, timeout_s: float) -> dict[str, Any]:
        from pilih_jobs.browser import headless  # leaf 4.3; imported only when rendering

        return await headless.render_cv_page(url, timeout_s=timeout_s)

    async def run() -> dict[str, Any]:
        async with rt.api_client() as api:
            return await variants.render_variant(api, cvv_id, render_page)

    data = st.run(run())
    st.out.result(
        data, human=lambda c, v: c.print(f"Rendered {cvv_id}: {v['file_id']}", markup=False)
    )


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="cv")
