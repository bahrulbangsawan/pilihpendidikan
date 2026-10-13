"""`approvals list|decide` (03 §8, 21 §6.3, 16 §3.3).

`decide` shows the exact payload, verifies that `payload_hash` matches the content where the
spec defines the binding (browser submit: 19 §8.2 / the form hash; email submit: 09 §4), and
sends `POST /api/v1/approvals/{id}/decide {decision, payload_hash, response?}`. It needs the
step-up scope `automation:manage` (D-29). `--yes` never approves a submission: a `submit`
approval needs the explicit `--approve` flag or an interactive answer.
"""

from __future__ import annotations

import hashlib
from typing import Annotated, Any, Final, cast

import typer
from rich.console import Console

from pilih_jobs.api.client import ApiClient
from pilih_jobs.cli.board import emit_result, fetch_or_cache, fmt_ms, require_scope
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.contracts import ids
from pilih_jobs.email.handoff import canonical_json, email_payload_hash
from pilih_jobs.errors import (
    ConflictError,
    InputRequiredError,
    NotFoundError,
    UsageError,
)
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.cache import EntityCache

group = typer.Typer(name="approvals", help="Pending approvals (03 §8).", no_args_is_help=True)

KINDS: Final = ("submit", "answer", "cv_variant", "rule_activation")
STATES: Final = ("pending", "approved", "rejected", "expired")


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def expected_hashes(approval: dict[str, Any]) -> set[str] | None:
    """Hashes that bind this payload (None when the client cannot derive the binding)."""
    payload = cast(dict[str, Any], approval.get("payload") or {})
    kind = payload.get("type")
    if kind == "browser_submit":
        subset = {
            key: payload[key]
            for key in ("form_hash", "fields", "attachments", "url", "posting_id")
            if key in payload
        }
        candidates = {_sha(canonical_json(subset))}
        form_hash = payload.get("form_hash")
        if isinstance(form_hash, str):
            candidates.add(form_hash)
        return candidates
    if kind == "email_submit":
        attachments = cast(list[dict[str, Any]], payload.get("attachments") or [])
        return {
            email_payload_hash(
                to=str(payload.get("to", "")),
                cc=[str(c) for c in cast(list[Any], payload.get("cc") or [])],
                subject=str(payload.get("subject", "")),
                body_text=str(payload.get("body_text", "")),
                attachment_sha256=[str(a.get("sha256", "")) for a in attachments],
            )
        }
    return None


def verify_payload_hash(approval: dict[str, Any]) -> bool | None:
    candidates = expected_hashes(approval)
    if candidates is None:
        return None
    return approval.get("payload_hash") in candidates


async def list_approvals(
    api: ApiClient, *, kind: str | None, approval_state: str | None
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(50):
        page = cast(
            dict[str, Any],
            await api.get(
                "/api/v1/approvals",
                {"state": approval_state, "kind": kind, "limit": 200, "cursor": cursor},
            ),
        )
        items += cast(list[dict[str, Any]], page.get("items") or [])
        cursor = cast(str | None, page.get("next_cursor"))
        if not cursor:
            break
    return items


def _summary(approval: dict[str, Any]) -> dict[str, Any]:
    payload = cast(dict[str, Any], approval.get("payload") or {})
    title = {
        "browser_submit": payload.get("url"),
        "email_submit": f"email to {payload.get('to')}: {payload.get('subject')}",
        "answer": f"{len(cast(list[Any], payload.get('questions') or []))} question(s)",
        "cv_variant": payload.get("cv_variant_id"),
        "rule_activation": payload.get("name"),
    }.get(str(payload.get("type")), "")
    return {
        "id": approval.get("id"),
        "kind": approval.get("kind"),
        "state": approval.get("state"),
        "application_id": approval.get("application_id"),
        "summary": title,
        "expires_at": approval.get("expires_at"),
    }


@group.command("list")
def list_cmd(
    ctx: typer.Context,
    kind: Annotated[
        str | None, typer.Option("--kind", help="submit|answer|cv_variant|rule_activation")
    ] = None,
    approval_state: Annotated[
        str, typer.Option("--state", help="pending|approved|rejected|expired")
    ] = "pending",
) -> None:
    """List approvals (pending by default)."""
    st = state(ctx)
    if kind is not None and kind not in KINDS:
        raise UsageError(f"--kind must be one of {', '.join(KINDS)}.")
    if approval_state not in STATES:
        raise UsageError(f"--state must be one of {', '.join(STATES)}.")
    rt = st.runtime()

    async def fetch(api: ApiClient) -> list[dict[str, Any]]:
        items = await list_approvals(api, kind=kind, approval_state=approval_state)
        cache = EntityCache(rt.db, rt.issuer)
        for item in items:
            cache.put("approval", item)
        return items

    def cached() -> list[dict[str, Any]] | None:
        return EntityCache(rt.db, rt.issuer).list(
            "approval",
            lambda a: a.get("state") == approval_state and (kind is None or a.get("kind") == kind),
        )

    items, banner = st.run(fetch_or_cache(rt, fetch, cached))
    data: dict[str, Any] = {"items": items}
    if banner:
        data["offline"] = banner

    def human(console: Console, value: Any) -> None:
        rows = [
            {**_summary(a), "expires_at": fmt_ms(a.get("expires_at"))}
            for a in cast(list[dict[str, Any]], cast(dict[str, Any], value)["items"])
        ]
        console.print(items_table(rows) if rows else "(no approvals)")

    emit_result(st, data, human)


def render_payload(console: Console, approval: dict[str, Any]) -> None:
    """The exact content the decision binds (protected values are already masked)."""
    payload = cast(dict[str, Any], approval.get("payload") or {})
    kind = payload.get("type")
    console.print(
        key_value_table(
            {
                "approval": approval.get("id"),
                "kind": approval.get("kind"),
                "application": approval.get("application_id"),
                "payload_hash": approval.get("payload_hash"),
                "expires": fmt_ms(approval.get("expires_at")),
            }
        )
    )
    if kind == "browser_submit":
        console.print(f"Submit to: {payload.get('url')}", markup=False, style="bold")
        rows = [
            {
                "field": f.get("label"),
                "value": f.get("value_display"),
                "source": f.get("value_source"),
                "ai": f.get("ai_written"),
            }
            for f in cast(list[dict[str, Any]], payload.get("fields") or [])
        ]
        if rows:
            console.print(items_table(rows))
    elif kind == "email_submit":
        console.print(f"To: {payload.get('to')}", markup=False)
        console.print(f"Subject: {payload.get('subject')}", markup=False)
        console.print(str(payload.get("body_text") or ""), markup=False)
    elif kind == "answer":
        for question in cast(list[dict[str, Any]], payload.get("questions") or []):
            suggestion = cast(dict[str, Any] | None, question.get("suggestion"))
            console.print(
                f'[{question.get("ref")}] "{question.get("question")}"'
                + (f" — suggested: {suggestion.get('value')}" if suggestion else ""),
                markup=False,
            )
    elif kind == "rule_activation":
        console.print(str(payload.get("summary") or ""), markup=False)
    for attachment in cast(list[dict[str, Any]], payload.get("attachments") or []):
        console.print(
            f"attachment: {attachment.get('name')}  sha256 {attachment.get('sha256')}",
            markup=False,
        )


def _answers(approval: dict[str, Any], values: list[str], st: CliState) -> dict[str, Any] | None:
    payload = cast(dict[str, Any], approval.get("payload") or {})
    questions = cast(list[dict[str, Any]], payload.get("questions") or [])
    if payload.get("type") != "answer":
        if values:
            raise UsageError("--answer applies to answer approvals only.")
        return None
    answers: list[dict[str, Any]] = []
    given: dict[str, str] = {}
    for value in values:
        ref, sep, text = value.partition("=")
        if sep and any(q.get("ref") == ref for q in questions):
            given[ref] = text
        elif len(questions) == 1:
            given[str(questions[0]["ref"])] = value
        else:
            raise UsageError("With several questions use --answer REF=VALUE for each.")
    for question in questions:
        ref = str(question["ref"])
        if ref not in given:
            if not st.interactive:
                raise InputRequiredError(
                    f"An answer is needed for {ref}.",
                    details={"needed": {"approval_id": approval.get("id"), "answer": ref}},
                )
            given[ref] = st.prompt(f'Answer for "{question.get("question")}"', needed=ref)
        answers.append({"ref": ref, "value": given[ref][:4000]})
    return {"answers": answers}


async def find_approval(api: ApiClient, rt: Runtime, approval_id: str) -> dict[str, Any]:
    for approval_state in ("pending", None):
        for item in await list_approvals(api, kind=None, approval_state=approval_state):
            if item.get("id") == approval_id:
                EntityCache(rt.db, rt.issuer).put("approval", item)
                return item
    raise NotFoundError(f"No approval {approval_id}.")


async def decide(
    api: ApiClient,
    approval: dict[str, Any],
    decision: str,
    response: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"decision": decision, "payload_hash": approval["payload_hash"]}
    if response is not None:
        body["response"] = response
    return cast(dict[str, Any], await api.post(f"/api/v1/approvals/{approval['id']}/decide", body))


@group.command("decide")
def decide_cmd(
    ctx: typer.Context,
    approval_id: Annotated[str, typer.Argument(help="apr_… id")],
    approve: Annotated[
        bool, typer.Option("--approve", help="Approve exactly this content.")
    ] = False,
    reject: Annotated[bool, typer.Option("--reject", help="Reject it.")] = False,
    answer: Annotated[
        list[str] | None,
        typer.Option("--answer", help="Answer text (REF=VALUE with several questions)."),
    ] = None,
) -> None:
    """Approve or reject (shows the payload, verifies payload_hash; automation:manage)."""
    st = state(ctx)
    if not ids.is_id("apr", approval_id):
        raise UsageError(f"{approval_id!r} is not an approval id (apr_…).")
    if approve and reject:
        raise UsageError("--approve and --reject are mutually exclusive.")
    rt = st.runtime()
    require_scope(st, rt, "automation:manage", purpose="Deciding an approval")

    async def run() -> dict[str, Any]:
        async with rt.api_client() as api:
            approval = await find_approval(api, rt, approval_id)
            if approval.get("state") != "pending":
                raise ConflictError(
                    f"{approval_id} is already {approval.get('state')}.",
                    code="already_decided",
                    details={"state": approval.get("state")},
                )
            if verify_payload_hash(approval) is False:
                raise ConflictError(
                    "The payload_hash does not match the content shown; refusing to decide.",
                    code="payload_hash_mismatch",
                )
            if not st.out.json_mode and not st.out.quiet:
                render_payload(st.out.console(err=True), approval)
            decision = _decision(st, approval, approve=approve, reject=reject)
            if decision is None:
                return {"state": "pending", "decided": False}
            response = _answers(approval, list(answer or []), st) if decision == "approve" else None
            data = await decide(api, approval, decision, response)
            decided = cast(dict[str, Any], data["approval"])
            EntityCache(rt.db, rt.issuer).put("approval", decided)
            return {"state": decided.get("state"), "approval": decided, "task": data.get("task")}

    data = st.run(run())
    st.out.result(data, human=lambda c, v: c.print(f"{approval_id}: {v['state']}", markup=False))


def _decision(st: CliState, approval: dict[str, Any], *, approve: bool, reject: bool) -> str | None:
    if reject:
        return "reject"
    submission = approval.get("kind") == "submit"
    if approve:
        if st.interactive and submission:
            question = "Submit this application with exactly the content above?"
            return "approve" if st.confirm(question, default=False, submission=True) else None
        return "approve"
    if not st.interactive:
        raise InputRequiredError(
            "Pass --approve or --reject.",
            details={"needed": {"approval_id": approval.get("id")}},
        )
    choice = st.prompt("[a]pprove / [r]eject / [s]kip", needed="decision").strip().lower()
    if choice.startswith("a"):
        if submission and not st.confirm(
            "Submit this application with exactly the content above?",
            default=False,
            submission=True,
        ):
            return None
        return "approve"
    if choice.startswith("r"):
        return "reject"
    return None


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="approvals")
