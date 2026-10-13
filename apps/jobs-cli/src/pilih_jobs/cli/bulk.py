"""Multi-id commands (16 §3.3 "Bulk"): id checks, per-id results, the summary and exit code.

Every list-item mutation accepts several ids. With one id a command keeps its single-id
output; with more it reports

    {"results": [{"id", "status", "error"?, "message"?, …fields}],
     "summary": {"ok", "skipped", "conflict", "not_found", "failed", "queued"}}

`status` is `ok` (done, or an expected no-op such as an already-disabled rule), `skipped`
(deliberately not attempted, `error` says why), `conflict` (409 / already decided),
`not_found` (404), `failed` (anything else) or `queued` (offline: the change waits in the
outbox, 20 §10). One id failing never stops the others; errors that hold for every id (not
signed in, a missing scope, an upgrade, Ctrl+C) abort the command as usual.

Exit code: 0 when every id is `ok` (or a skip that is a no-op); otherwise the most relevant
code of 16 §3.2 — the first `failed` id's own code, then 7 (queued), 6 (conflict),
a skip's own code (8 when it needs a decision one by one), 5 (not found).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Final, cast

import typer
from rich.console import Console

from pilih_jobs.cli.context import CliState
from pilih_jobs.cli.output import items_table
from pilih_jobs.contracts import ids
from pilih_jobs.errors import ExitCode, PilihError, UsageError

if TYPE_CHECKING:
    from pilih_jobs.api.client import ApiClient

STATUSES: Final = ("ok", "skipped", "conflict", "not_found", "failed", "queued")

#: Errors that hold for every id: they abort the whole command instead of one row.
_ABORT: Final = frozenset(
    {
        ExitCode.NOT_AUTHENTICATED,
        ExitCode.PERMISSION_DENIED,
        ExitCode.UPGRADE_REQUIRED,
        ExitCode.INTERRUPTED,
    }
)


#: `--all` stops after this many items so a runaway cursor can never loop forever.
ALL_PAGES_MAX_ITEMS = 10_000
PAGE_SIZE = 200


async def collect_pages(
    api: ApiClient,
    path: str,
    params: dict[str, Any],
    *,
    limit: int | None,
) -> list[dict[str, Any]]:
    """GET `path` page by page (`next_cursor`) until `limit` items, or every item when
    `limit` is None (`--all`, capped at ALL_PAGES_MAX_ITEMS)."""
    want = ALL_PAGES_MAX_ITEMS if limit is None else limit
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    while len(items) < want:
        page = cast(
            dict[str, Any],
            await api.get(
                path, {**params, "limit": min(PAGE_SIZE, want - len(items)), "cursor": cursor}
            ),
        )
        items.extend(cast(list[dict[str, Any]], page.get("items") or []))
        cursor = cast(str | None, page.get("next_cursor"))
        if not cursor:
            break
    return items[:want]


def check_ids(prefix: str, values: Iterable[str], *, label: str | None = None) -> list[str]:
    """Validate every `<prefix>_…` id up front (usage error, exit 2); dedupe, keep order.

    An argument may hold several ids separated by whitespace: zsh does not
    word-split `$(pilih-jobs inbox list --ids)`, so the whole listing arrives
    as one argument.
    """
    items = [part for value in values for part in value.split()]
    if not items:
        raise UsageError(f"Pass at least one {prefix}_… id.")
    bad = [v for v in items if not ids.is_id(prefix, v)]
    if bad:
        what = label or f"{prefix}_… id"
        raise UsageError(f"Not a {what}: {', '.join(bad)}")
    return list(dict.fromkeys(items))


@dataclass
class Outcome:
    """One id's result plus the exit code it implies (not serialised)."""

    id: str
    status: str
    fields: dict[str, Any] = field(default_factory=lambda: {})
    error: str | None = None
    message: str | None = None
    exit: int = 0

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "status": self.status}
        if self.error is not None:
            out["error"] = self.error
        if self.message is not None:
            out["message"] = self.message
        out.update(self.fields)
        return out


def ok(item_id: str, **fields: Any) -> Outcome:
    return Outcome(item_id, "ok", fields)


def skipped(item_id: str, reason: str, message: str, *, exit_code: int = 0) -> Outcome:
    return Outcome(item_id, "skipped", error=reason, message=message, exit=exit_code)


def from_error(item_id: str, exc: PilihError) -> Outcome:
    code = exc.exit
    if code == ExitCode.NOT_FOUND:
        status = "not_found"
    elif code == ExitCode.CONFLICT:
        status = "conflict"
    elif code == ExitCode.UNAVAILABLE and exc.code == "queued":
        status = "queued"
    else:
        status = "failed"
    fields: dict[str, Any] = {}
    if status == "conflict" and isinstance(exc.details.get("current"), dict):
        current = cast(dict[str, Any], exc.details["current"])
        fields["current_revision"] = current.get("revision")
        if "stage" in current:
            fields["current_stage"] = current.get("stage")
    return Outcome(item_id, status, fields, error=exc.code, message=exc.message, exit=int(code))


async def run_each(
    values: Sequence[str], action: Callable[[str], Awaitable[Outcome]]
) -> list[Outcome]:
    """Run `action` per id; a per-id `PilihError` becomes that id's outcome."""
    outcomes: list[Outcome] = []
    for value in values:
        try:
            outcomes.append(await action(value))
        except PilihError as exc:
            if exc.exit in _ABORT:
                raise
            outcomes.append(from_error(value, exc))
    return outcomes


def summary(statuses: Iterable[str]) -> dict[str, int]:
    counts: dict[str, int] = dict.fromkeys(STATUSES, 0)
    for status in statuses:
        counts[status if status in counts else "failed"] += 1
    return counts


def exit_code(outcomes: Sequence[Outcome]) -> int:
    for outcome in outcomes:
        if outcome.status == "failed":
            return outcome.exit or int(ExitCode.FAILURE)
    for status, default in (
        ("queued", ExitCode.UNAVAILABLE),
        ("conflict", ExitCode.CONFLICT),
        ("skipped", ExitCode.OK),  # a skip counts only when it carries a code
        ("not_found", ExitCode.NOT_FOUND),
    ):
        for outcome in outcomes:
            if outcome.status == status and (outcome.exit or default):
                return outcome.exit or int(default)
    return 0


def render(console: Console, data: Any, columns: Sequence[str] | None = None) -> None:
    """Human mode: a compact table and one summary line."""
    value = cast(dict[str, Any], data)
    rows = cast(list[dict[str, Any]], value.get("results") or [])
    if rows:
        cols = list(columns or ("id", "status"))
        # Why an id failed matters more than its details: on a narrow terminal the
        # rightmost columns are left out first, so the reason goes right after status.
        at = cols.index("status") + 1 if "status" in cols else len(cols)
        for key in ("error", "message"):
            if key not in cols and any(row.get(key) for row in rows):
                cols.insert(at, key)
                at += 1
        console.print(items_table(rows, cols))
    counts = cast(dict[str, int], value.get("summary") or {})
    line = ", ".join(f"{n} {status.replace('_', ' ')}" for status, n in counts.items() if n)
    console.print(line or "nothing to do", markup=False)


def emit(
    st: CliState,
    outcomes: Sequence[Outcome],
    *,
    columns: Sequence[str] | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Print `{results, summary}` and exit with the code of the worst result."""
    data: dict[str, Any] = {
        "results": [o.as_dict() for o in outcomes],
        "summary": summary(o.status for o in outcomes),
        **(extra or {}),
    }
    st.out.result(data, human=lambda console, value: render(console, value, columns))
    code = exit_code(outcomes)
    if code:
        raise typer.Exit(code)


def print_ids(st: CliState, values: Iterable[Any]) -> None:
    """`--ids`: one id per line on stdout (JSON: `{"ids": […]}`), for piping into bulk commands.

    Printed even with `--quiet`: the ids are what was asked for.
    """
    items = [str(v) for v in values if v]
    if st.out.json_mode:
        st.out.result({"ids": items})
        return
    st.out.emitted_result = True
    if items:
        st.out.stdout.write("\n".join(items) + "\n")
        st.out.stdout.flush()
