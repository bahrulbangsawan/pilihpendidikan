"""`email draft|show|approve|send|confirm` — email applications (09 §6.1, §10).

- `draft <app_id> [--to] [--locale en|id] [--attach fil_…]` renders the template and creates a
  `local_handoff` draft (the approved CV PDF is attached by default);
- `show <eml_id>` prints the draft and its attachments;
- `approve <eml_id>` shows the full content with SHA-256 values and binds it (`payload_hash`);
  it needs `automation:manage` (step-up) and an interactive confirmation (`--yes` never
  approves a submission);
- `send <eml_id>` writes `<data>/runs/<eml_id>/application.eml` (RFC 5322, RFC 2047 subject,
  base64 PDFs, `X-Unsent: 1`) after verifying every attachment, opens it with the OS handler
  and asks "Did you send it?"; non-interactive sessions print instructions and leave the email
  `approved`;
- `confirm <eml_id> --sent|--not-sent` records the hand-off answer.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Final, cast

import typer
from rich.console import Console

from pilih_jobs.cli.board import check_app_id, require_scope
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.contracts import ids
from pilih_jobs.email import handoff
from pilih_jobs.email.opener import open_with_os
from pilih_jobs.errors import InputRequiredError, PilihError, UsageError
from pilih_jobs.runtime import Runtime

group = typer.Typer(name="email", help="Email applications (09).", no_args_is_help=True)

LOCALES: Final = ("en", "id")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
#: Replaced in tests: the OS opener (09 §6.1 step 3).
opener = open_with_os


def _check_email_id(value: str) -> str:
    if not ids.is_id("eml", value):
        raise UsageError(f"{value!r} is not an email application id (eml_…).")
    return value


def _show_human(console: Console, value: Any) -> None:
    info = cast(dict[str, Any], value)
    record = cast(dict[str, Any], info.get("email") or info)
    console.print(
        key_value_table(
            {
                "email": record.get("id"),
                "status": record.get("status"),
                "delivery": record.get("delivery"),
                "to": record.get("to_address") or record.get("to"),
                "subject": record.get("subject"),
            }
        )
    )
    console.print(str(record.get("body_text") or ""), markup=False)
    attachments = cast(list[dict[str, Any]], info.get("attachments") or [])
    if attachments:
        console.print(items_table(attachments, ["file_id", "name", "sha256", "size_bytes"]))
    if info.get("payload_hash"):
        console.print(f"payload_hash: {info['payload_hash']}", markup=False, style="dim")


@group.command("draft")
def draft_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    to: Annotated[
        str | None, typer.Option("--to", help="Recipient (the employer's address).")
    ] = None,
    locale: Annotated[str, typer.Option("--locale", help="en|id")] = "en",
    attach: Annotated[
        list[str] | None, typer.Option("--attach", help="Extra file ids (fil_…), repeatable.")
    ] = None,
    recipient_name: Annotated[
        str | None, typer.Option("--recipient-name", help='Greeting name (default "Hiring Team").')
    ] = None,
) -> None:
    """Create an email application draft (local hand-off)."""
    st = state(ctx)
    check_app_id(app_id)
    if locale not in LOCALES:
        raise UsageError("--locale must be en or id.")
    extra = list(attach or [])
    bad = [f for f in extra if not ids.is_id("fil", f)]
    if bad:
        raise UsageError(f"Not a file id (fil_…): {', '.join(bad)}")
    if to is None:
        to = st.prompt("Recipient address", needed="to")
    to = to.strip()
    if not _EMAIL.match(to) or len(to) > 254:
        raise UsageError(f"{to!r} is not an email address.")
    # 09 §1: the "this address belongs to the employer" tick (--yes ticks it in scripts).
    confirmed = st.yes or (
        st.interactive and st.confirm(f"I confirm {to} belongs to the employer.", default=False)
    )
    rt = st.runtime()

    async def run() -> dict[str, Any]:
        async with rt.api_client() as api:
            return await handoff.create_draft(
                api,
                rt.db,
                rt.issuer,
                handoff.DraftInput(
                    application_id=app_id,
                    to=to,
                    locale=locale,
                    attach=extra,
                    recipient_confirmed=confirmed,
                    recipient_name=recipient_name,
                ),
            )

    record = st.run(run())
    st.out.result(
        {"email_application": record},
        human=lambda c, v: _show_human(c, {"email": v["email_application"]}),
    )


@group.command("show")
def show_cmd(ctx: typer.Context, email_id: Annotated[str, typer.Argument(help="eml_… id")]) -> None:
    """Show an email application with its attachments."""
    st = state(ctx)
    _check_email_id(email_id)
    rt = st.runtime()

    async def run() -> dict[str, Any]:
        async with rt.api_client() as api:
            record, detail = await handoff.find_email(api, rt.db, rt.issuer, email_id)
            view = await handoff.approval_view(api, record)
        approval = (detail or {}).get("approval") if detail and "email" in detail else None
        return {
            "email": record,
            "attachments": view["attachments"],
            "payload_hash": handoff.server_payload_hash(rt.db, email_id) or view["payload_hash"],
            "approval": approval,
        }

    st.out.result(st.run(run()), human=_show_human)


@group.command("approve")
def approve_cmd(
    ctx: typer.Context,
    email_id: Annotated[str, typer.Argument(help="eml_… id")],
    confirm_recipient: Annotated[
        bool,
        typer.Option(
            "--confirm-recipient",
            help='Tick "this address belongs to the employer" (needed for free-mail or '
            "non-matching domains).",
        ),
    ] = False,
) -> None:
    """Approve a draft: binds recipient, subject, body and attachment SHA-256 values."""
    st = state(ctx)
    _check_email_id(email_id)
    rt = st.runtime()
    require_scope(st, rt, "automation:manage", purpose="Approving an email application")

    async def load() -> tuple[dict[str, Any], dict[str, Any]]:
        async with rt.api_client() as api:
            record, _ = await handoff.find_email(api, rt.db, rt.issuer, email_id)
            return record, await handoff.approval_view(api, record)

    record, view = st.run(load())
    # The server's review hash wins when known (leaf 2.9 draft response); else 09 §4 locally.
    view["payload_hash"] = handoff.server_payload_hash(rt.db, email_id) or view["payload_hash"]
    if record.get("status") != "draft":
        raise PilihError(f"{email_id} is {record.get('status')}, not a draft.", code="not_a_draft")
    if not st.out.json_mode and not st.out.quiet:
        _show_human(st.out.console(err=True), {"email": record, **view})
    if not st.confirm(
        f"Approve sending this email to {view['to']}?",
        default=False,
        submission=True,
        needed={"email_id": email_id, "payload_hash": view["payload_hash"]},
    ):
        st.out.result({"status": record.get("status"), "approved": False})
        return
    recipient_ok = (
        confirm_recipient
        or not handoff.recipient_confirmation_required(rt.db, email_id)
        or (
            st.interactive
            and typer.confirm(f"I confirm {view['to']} belongs to the employer.", default=False)
        )
    )

    async def approve() -> dict[str, Any]:
        async with rt.api_client() as api:
            data = await handoff.approve_email(
                api, record, view["payload_hash"], recipient_confirmed=recipient_ok
            )
        handoff.remember_email(rt.db, rt.issuer, cast(dict[str, Any], data["email"]))
        return data

    data = st.run(approve())
    email = cast(dict[str, Any], data["email"])
    st.out.result({"status": email.get("status"), **data})


async def _send(st: CliState, rt: Runtime, email_id: str) -> dict[str, Any]:
    async with rt.api_client() as api:
        record, _ = await handoff.find_email(api, rt.db, rt.issuer, email_id)
        address, name = await handoff.sender_identity(api)
        bundle = await handoff.build_handoff(
            api, rt.paths, record, from_address=address, from_name=name
        )
    opened = opener(bundle.eml_path)
    out: dict[str, Any] = {**bundle.as_dict(), "opened": opened, "status": record.get("status")}
    if not opened or not st.interactive:
        for line in handoff.manual_instructions(bundle):
            st.out.info(line)
    if not st.interactive:
        out["instructions"] = handoff.manual_instructions(bundle)
        return out
    sent = st.confirm("Did you send it?", default=False, submission=True)
    if not sent:
        st.out.info(
            f"Left as approved. When you send it: pilih-jobs email confirm {email_id} --sent"
        )
        return out
    async with rt.api_client() as api:
        data = await handoff.report_handed_off(api, email_id, sent=True, sent_at=rt.clock.now_ms())
    email = cast(dict[str, Any], data["email"])
    handoff.remember_email(rt.db, rt.issuer, email)
    application = cast(dict[str, Any], data.get("application") or {})
    out.update(
        status=email.get("status"),
        submission_status=application.get("submission_status"),
        handed_off=True,
    )
    return out


@group.command("send")
def send_cmd(ctx: typer.Context, email_id: Annotated[str, typer.Argument(help="eml_… id")]) -> None:
    """Build the .eml, open the mail client and ask whether it was sent (local hand-off)."""
    st = state(ctx)
    _check_email_id(email_id)
    rt = st.runtime()
    data = st.run(_send(st, rt, email_id))
    st.out.result(
        data,
        human=lambda c, v: c.print(f"{v['eml_path']} — status {v.get('status')}", markup=False),
    )


@group.command("confirm")
def confirm_cmd(
    ctx: typer.Context,
    email_id: Annotated[str, typer.Argument(help="eml_… id")],
    sent: Annotated[
        bool, typer.Option("--sent", help="You sent it from your mail client.")
    ] = False,
    not_sent: Annotated[bool, typer.Option("--not-sent", help="It was not sent.")] = False,
) -> None:
    """Record whether the hand-off was actually sent."""
    st = state(ctx)
    _check_email_id(email_id)
    if sent and not_sent:
        raise UsageError("--sent and --not-sent are mutually exclusive.")
    if not (sent or not_sent):
        if not st.interactive:
            raise InputRequiredError(
                "Pass --sent or --not-sent.", details={"needed": {"email_id": email_id}}
            )
        sent = st.confirm(f"Did you send {email_id}?", default=False, submission=True)
    rt = st.runtime()

    async def run() -> dict[str, Any]:
        async with rt.api_client() as api:
            data = await handoff.report_handed_off(
                api, email_id, sent=sent, sent_at=rt.clock.now_ms() if sent else None
            )
        email = cast(dict[str, Any], data["email"])
        handoff.remember_email(rt.db, rt.issuer, email)
        application = cast(dict[str, Any], data.get("application") or {})
        return {
            "status": email.get("status"),
            "submission_status": application.get("submission_status"),
            **data,
        }

    st.out.result(st.run(run()))


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="email")
