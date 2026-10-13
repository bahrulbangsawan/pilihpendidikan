"""TCMD-BULK: multi-id commands (16 §3.3 "Bulk"), `--ids` listings, untruncated ids."""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.cli.context import CliState
from pilih_jobs.cli.status import fmt_since
from pilih_jobs.contracts import ids
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.outbox import Outbox
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult
from tests.tasks.fakes import CloudFake

Cli = Callable[..., CliResult]
ZERO = {"ok": 0, "skipped": 0, "conflict": 0, "not_found": 0, "failed": 0, "queued": 0}


def _summary(**counts: int) -> dict[str, int]:
    return {**ZERO, **counts}


def _by_id(result: CliResult) -> dict[str, dict[str, Any]]:
    return {r["id"]: r for r in result.json["data"]["results"]}


# ---------------------------------------------------------------------------- inbox
def test_TCMD_BULK_inbox_seen_and_restore_report_per_id(cli_cloud: Cli, cloud: CloudFake) -> None:
    new, dismissed = cloud.add_inbox_item(), cloud.add_inbox_item(state="dismissed")
    tracked = cloud.add_inbox_item(state="tracked")
    missing = ids.new_id("ujb")
    a, b, c = (i["user_job"]["id"] for i in (new, dismissed, tracked))

    seen = cli_cloud("--json", "inbox", "seen", a, a, missing)
    assert seen.code == 5  # not found is the only problem
    data = seen.json["data"]
    assert [r["id"] for r in data["results"]] == [a, missing]  # deduped, order kept
    assert data["results"][0] == {"id": a, "status": "ok", "user_job_id": a, "inbox_state": "seen"}
    assert data["results"][1]["status"] == "not_found"
    assert data["summary"] == _summary(ok=1, not_found=1)

    restored = cli_cloud("--json", "inbox", "restore", b, c)
    assert restored.code == 0  # a tracked item is left alone: ok, unchanged
    states = {r["id"]: r["inbox_state"] for r in restored.json["data"]["results"]}
    assert states == {b: "seen", c: "tracked"}
    assert cloud.inbox_bulk_calls[-1] == {"user_job_ids": [b, c], "action": "restore"}

    human = cli_cloud("inbox", "restore", b)
    assert human.code == 0
    assert "1 ok" in human.stdout


def test_TCMD_BULK_inbox_dismiss_a_tracked_item_is_a_conflict(
    cli_cloud: Cli, cloud: CloudFake
) -> None:
    tracked, new = cloud.add_inbox_item(state="tracked"), cloud.add_inbox_item()
    result = cli_cloud(
        "--json", "inbox", "dismiss", tracked["user_job"]["id"], new["user_job"]["id"]
    )
    assert result.code == 6
    rows = result.json["data"]["results"]
    assert [r["status"] for r in rows] == ["conflict", "ok"]
    assert rows[0]["error"] == "conflict"
    assert "archive" in rows[0]["message"]


def test_TCMD_BULK_inbox_chunks_above_200_and_dedupes(cli_cloud: Cli, cloud: CloudFake) -> None:
    items = [cloud.add_inbox_item() for _ in range(3)]
    known = [i["user_job"]["id"] for i in items]
    unknown = [ids.new_id("ujb") for _ in range(447)]
    values = [*known, *unknown, *known]  # duplicates at the end
    result = cli_cloud("--json", "--yes", "inbox", "seen", *values)
    assert [len(call["user_job_ids"]) for call in cloud.inbox_bulk_calls] == [200, 200, 50]
    sent = [u for call in cloud.inbox_bulk_calls for u in call["user_job_ids"]]
    assert sent == [*known, *unknown]
    assert result.json["data"]["summary"] == _summary(ok=3, not_found=447)
    assert result.code == 5


def test_TCMD_BULK_inbox_track_chunks_and_dedupes(cli_cloud: Cli, cloud: CloudFake) -> None:
    item = cloud.add_inbox_item()
    ujb = item["user_job"]["id"]
    many = [ujb, *(ids.new_id("ujb") for _ in range(200)), ujb]
    result = cli_cloud("--json", "inbox", "track", *many)
    assert [len(c["user_job_ids"]) for c in cloud.inbox_bulk_calls] == [200, 1]
    assert result.json["data"]["results"][0]["inbox_state"] == "tracked"
    assert result.json["data"]["summary"] == _summary(ok=1, not_found=200)


def test_TCMD_BULK_inbox_offline_queues_every_chunk(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi, home: Path
) -> None:
    many = [ids.new_id("ujb") for _ in range(250)]
    fake_api.offline = True
    queued = cli_cloud("--json", "--yes", "inbox", "restore", *many)
    fake_api.offline = False
    assert queued.code == 7
    assert queued.json["error"]["details"]["queued"] == 2
    db = StateDB(home / "data" / "state.db")
    try:
        bodies = [e.json() for e in Outbox(db, fake_api.issuer).entries()]
    finally:
        db.close()
    assert [len(b["user_job_ids"]) for b in bodies] == [200, 50]
    assert {b["action"] for b in bodies} == {"restore"}
    assert [u for b in bodies for u in b["user_job_ids"]] == many


def test_TCMD_BULK_inbox_list_ids_pipe_into_dismiss(cli_cloud: Cli, cloud: CloudFake) -> None:
    first, second = cloud.add_inbox_item(score=90), cloud.add_inbox_item(score=10)
    listed = cli_cloud("inbox", "list", "--ids", "--min-score", "0")
    expected = [first["user_job"]["id"], second["user_job"]["id"]]
    assert listed.stdout.split() == expected
    as_json = cli_cloud("--json", "inbox", "list", "--ids")
    assert as_json.json["data"] == {"ids": expected}
    quiet = cli_cloud("-q", "inbox", "list", "--ids")
    assert quiet.stdout.split() == expected  # the ids are the output, even with --quiet
    dismissed = cli_cloud("--json", "inbox", "dismiss", *listed.stdout.split())
    assert dismissed.json["data"]["summary"]["ok"] == 2


def test_TCMD_BULK_one_argument_may_hold_many_ids(cli_cloud: Cli, cloud: CloudFake) -> None:
    # zsh does not word-split `$(pilih-jobs inbox list --ids)`: the listing arrives as one argument.
    first, second = cloud.add_inbox_item(score=90), cloud.add_inbox_item(score=10)
    listed = cli_cloud("inbox", "list", "--ids", "--min-score", "0")
    dismissed = cli_cloud("--json", "inbox", "dismiss", listed.stdout)
    assert dismissed.code == 0
    assert [r["id"] for r in dismissed.json["data"]["results"]] == [
        first["user_job"]["id"],
        second["user_job"]["id"],
    ]
    bad = cli_cloud("--json", "inbox", "seen", f"{first['user_job']['id']}\nnot-an-id")
    assert bad.code == 2


def test_TCMD_BULK_prefixes_are_checked_up_front(cli_cloud: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application()
    ujb = cloud.add_inbox_item()["user_job"]["id"]
    cases = [
        ("inbox", "seen", ujb, app["id"]),
        ("move", app["id"], ujb, "applied"),
        ("archive", app["id"], "nope"),
        ("rm", app["id"], ujb),
        ("rules", "enable", app["id"]),
        ("devices", "revoke", ujb),
        ("approvals", "decide", app["id"], "--reject"),
        ("tasks", "cancel", app["id"]),
        ("tasks", "retry", "tsk_nope"),
    ]
    for case in cases:
        result = cli_cloud("--json", *case)
        assert result.code == 2, case
        assert result.json["error"]["code"] == "usage_error", case
    assert cloud.inbox_bulk_calls == []
    assert cloud.fake.application(app["id"])["revision"] == app["revision"]


# ---------------------------------------------------------------------------- applications
def test_TCMD_BULK_move_many_reports_per_id(cli_cloud: Cli, cloud: CloudFake) -> None:
    first, second = cloud.add_application(stage="ready"), cloud.add_application(stage="ready")
    stuck = cloud.add_application(stage="applied")
    missing = ids.new_id("app")
    result = cli_cloud(
        "--json", "move", first["id"], second["id"], stuck["id"], missing, first["id"], "applied"
    )
    rows = _by_id(result)
    assert list(rows) == [first["id"], second["id"], stuck["id"], missing]
    assert rows[first["id"]]["stage"] == "applied"
    assert rows[first["id"]]["revision"] == first["revision"] + 1
    assert rows[stuck["id"]]["status"] == "ok"  # already there: a no-op move
    assert rows[stuck["id"]]["changed"] is False
    # nothing was sent for it, so its place in the column is unchanged
    assert cloud.fake.application(stuck["id"])["revision"] == stuck["revision"]
    assert rows[missing]["status"] == "not_found"
    assert result.json["data"]["summary"] == _summary(ok=3, not_found=1)
    assert result.code == 5
    back = cli_cloud("--json", "move", first["id"], second["id"], "saved")
    assert back.code == 1  # applied → saved is not allowed: failed, exit of the failure
    assert {r["error"] for r in back.json["data"]["results"]} == {"invalid_transition"}


def test_TCMD_BULK_move_single_id_output_is_unchanged(cli_cloud: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application(stage="ready")
    data = cli_cloud("--json", "move", app["id"], "applied").json["data"]
    assert set(data) == {"application"}
    assert data["application"]["stage"] == "applied"
    human = cli_cloud("move", app["id"], "interviewing")
    assert human.stdout.strip() == f"{app['id']} → interviewing (revision {app['revision'] + 2})."


def test_TCMD_BULK_move_usage_rules(cli_cloud: Cli, cloud: CloudFake) -> None:
    first, second = cloud.add_application(), cloud.add_application()
    placed = cli_cloud(
        "--json", "move", first["id"], second["id"], "applied", "--after", first["id"]
    )
    assert placed.code == 2
    assert "--before/--after" in placed.json["error"]["message"]
    assert cli_cloud("--json", "move", first["id"]).code == 2  # no stage
    assert cli_cloud("--json", "move", first["id"], second["id"], "nowhere").code == 2


def test_TCMD_BULK_move_conflict_does_not_stop_the_others(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi
) -> None:
    stale, fine = cloud.add_application(stage="ready"), cloud.add_application(stage="ready")
    cli_cloud("--json", "sync")
    fake_api.web_move(stale["id"], "preparing")
    fake_api.fail_next("GET", "^/api/v1/changes$", 503, "upstream_unavailable")
    result = cli_cloud("--json", "move", stale["id"], fine["id"], "applied")
    assert result.code == 6
    rows = _by_id(result)
    assert rows[stale["id"]]["status"] == "conflict"
    assert rows[stale["id"]]["error"] == "revision_conflict"
    assert rows[stale["id"]]["current_stage"] == "preparing"
    assert rows[fine["id"]]["stage"] == "applied"


def test_TCMD_BULK_edit_archive_follow_up(cli_cloud: Cli, cloud: CloudFake) -> None:
    first, second = cloud.add_application(), cloud.add_application()
    pair = (first["id"], second["id"])
    edited = cli_cloud("--json", "edit", *pair, "--priority", "high")
    assert edited.code == 0
    assert edited.json["data"]["summary"] == _summary(ok=2)
    assert all(cloud.fake.application(a)["priority"] == 1 for a in pair)
    follow = cli_cloud("--json", "follow-up", *pair, "7d")
    assert follow.code == 0
    assert all(cloud.fake.application(a)["follow_up_at"] for a in pair)
    done = cli_cloud("--json", "follow-up", *pair, "done")
    assert done.code == 0
    assert all(cloud.fake.application(a)["follow_up_at"] is None for a in pair)
    notes = [e for e in cloud.fake.events if e["type"] == "note_added"]
    assert {e["application_id"] for e in notes} == set(pair)
    archived = cli_cloud("--json", "archive", *pair)
    assert {r["archived"] for r in archived.json["data"]["results"]} == {True}
    single = cli_cloud("--json", "archive", first["id"], "--undo").json["data"]
    assert single["archived"] is False
    assert single["application"]["archived"] is False


def test_TCMD_BULK_rm_purge_confirms_once_for_the_set(
    cli_cloud: Cli, cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    apps = [cloud.add_application() for _ in range(3)]
    values = [a["id"] for a in apps]
    assert cli_cloud("--json", "rm", *values, "--purge").code == 8  # needs --yes

    monkeypatch.setattr(CliState, "interactive", property(lambda _self: True))
    asked: list[str] = []
    monkeypatch.setattr("typer.confirm", lambda q, default=False: asked.append(q) or True)
    result = cli_cloud("rm", *values, "--purge")
    assert result.code == 0
    deletes = [q for q in asked if "delete" in q]  # (the first-run telemetry question aside)
    assert len(deletes) == 1
    assert "Permanently delete 3 applications" in deletes[0]
    assert "3 ok" in result.stdout
    assert all(("application", a) not in cloud.fake.entities for a in values)


def test_TCMD_BULK_rm_yes_archives_and_reports_missing(cli_cloud: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application()
    missing = ids.new_id("app")
    result = cli_cloud("--json", "--yes", "rm", app["id"], missing)
    assert result.code == 5
    rows = _by_id(result)
    assert rows[app["id"]] == {"id": app["id"], "status": "ok", "deleted": False, "archived": True}
    assert rows[missing]["status"] == "not_found"
    single = cli_cloud("--json", "--yes", "rm", app["id"]).json["data"]
    assert single["deleted"] is False
    assert "results" not in single


def test_TCMD_BULK_list_and_board_ids(cli_cloud: Cli, cloud: CloudFake) -> None:
    ready, saved = cloud.add_application(stage="ready"), cloud.add_application(stage="saved")
    assert set(cli_cloud("list", "--ids").stdout.split()) == {ready["id"], saved["id"]}
    assert cli_cloud("board", "--ids", "--stage", "ready").stdout.split() == [ready["id"]]
    assert cli_cloud("--json", "list", "--ids", "--stage", "saved").json["data"] == {
        "ids": [saved["id"]]
    }


# ---------------------------------------------------------------------------- rules, devices
def test_TCMD_BULK_rules_enable_many(cli_cloud: Cli, cloud: CloudFake) -> None:
    rule, done = cloud.add_rule(enabled=False), cloud.add_rule(enabled=True)
    auto = cloud.add_rule(mode="auto")
    result = cli_cloud("--json", "rules", "enable", rule["id"], done["id"], auto["id"])
    assert result.code == 9
    rows = _by_id(result)
    assert rows[rule["id"]] == {"id": rule["id"], "status": "ok", "enabled": True, "changed": True}
    assert rows[done["id"]]["changed"] is False
    assert rows[auto["id"]]["status"] == "failed"
    assert rows[auto["id"]]["error"] == "mode_not_allowed"
    off = cli_cloud("--json", "rules", "disable", rule["id"], done["id"])
    assert off.code == 0
    assert cli_cloud("rules", "list", "--ids").stdout.split() == [
        rule["id"],
        done["id"],
        auto["id"],
    ]


def test_TCMD_BULK_devices_revoke_many_this_device_last(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi, user_id: str
) -> None:
    other = fake_api._create_device(user_id, "Old laptop")
    listed = cli_cloud("devices", "list", "--ids").stdout.split()
    assert other["id"] in listed
    this = next(d for d in listed if d != other["id"])
    assert cli_cloud("--json", "devices", "revoke", this, other["id"]).code == 8
    result = cli_cloud("--json", "--yes", "devices", "revoke", this, other["id"])
    assert result.code == 0, result.stdout
    rows = result.json["data"]["results"]
    assert [r["id"] for r in rows] == [this, other["id"]]  # reported in the given order
    assert rows[0]["this_device"] is True
    assert all(fake_api.devices[d]["revoked_at"] for d in (this, other["id"]))


# ---------------------------------------------------------------------------- approvals
def _variant_payload() -> dict[str, Any]:
    return {
        "type": "cv_variant",
        "cv_variant_id": ids.new_id("cvv"),
        "file_id": ids.new_id("fil"),
        "sha256": "f" * 64,
        "template": "harvard",
        "rephrased_bullets": 2,
        "notes_for_user": [],
    }


def _answer_payload() -> dict[str, Any]:
    return {
        "type": "answer",
        "questions": [
            {
                "ref": "q1",
                "question": "Expected salary?",
                "required": True,
                "options": [],
                "question_key": "salary_expectation",
                "sensitivity": "personal",
                "suggestion": None,
            }
        ],
    }


def test_TCMD_BULK_approve_skips_submissions_and_inputs(cli_cloud: Cli, cloud: CloudFake) -> None:
    submit = cloud.add_pending_approval()
    answer = cloud.add_pending_approval(
        kind="answer", payload=_answer_payload(), payload_hash="d" * 64
    )
    variant = cloud.add_pending_approval(
        kind="cv_variant",
        payload=_variant_payload(),
        payload_hash="e" * 64,
    )
    missing = ids.new_id("apr")
    result = cli_cloud(
        "--json",
        "approvals",
        "decide",
        submit["id"],
        answer["id"],
        variant["id"],
        missing,
        "--approve",
    )
    rows = _by_id(result)
    assert rows[submit["id"]]["status"] == "skipped"
    assert rows[submit["id"]]["error"] == "submission_needs_review"
    assert rows[answer["id"]]["error"] == "needs_input"
    assert rows[variant["id"]] == {
        "id": variant["id"],
        "status": "ok",
        "kind": "cv_variant",
        "state": "approved",
    }
    assert rows[missing]["status"] == "not_found"
    assert result.code == 8  # submissions wait for a one-by-one decision
    assert [d["decision"] for d in cloud.decisions] == ["approve"]
    assert cloud.decisions[0]["payload_hash"] == "e" * 64


def test_TCMD_BULK_reject_many_and_usage(cli_cloud: Cli, cloud: CloudFake) -> None:
    first, second = cloud.add_pending_approval(), cloud.add_pending_approval()
    pair = (first["id"], second["id"])
    assert cli_cloud("--json", "approvals", "decide", *pair).code == 2  # no decision
    assert cli_cloud("--json", "approvals", "decide", *pair, "--approve", "--answer", "x").code == 2
    rejected = cli_cloud("--json", "approvals", "decide", *pair, "--reject")
    assert rejected.code == 0
    assert {r["state"] for r in rejected.json["data"]["results"]} == {"rejected"}
    again = cli_cloud("--json", "approvals", "decide", *pair, "--reject")
    assert again.code == 6
    assert {r["error"] for r in again.json["data"]["results"]} == {"already_decided"}
    pending = cli_cloud("approvals", "list", "--ids", "--state", "rejected").stdout.split()
    assert set(pending) == set(pair)


def test_TCMD_BULK_bulk_approve_verifies_every_payload_hash(
    cli_cloud: Cli, cloud: CloudFake
) -> None:
    tampered = cloud.add_pending_approval(
        payload={
            "type": "browser_submit",
            "form_hash": "a" * 64,
            "url": "https://job-boards.greenhouse.io/acme/jobs/1/apply",
            "posting_id": ids.new_id("pst"),
            "fields": [],
            "attachments": [],
        },
        payload_hash="b" * 64,
    )
    fine = cloud.add_pending_approval(
        kind="cv_variant",
        payload=_variant_payload(),
        payload_hash="e" * 64,
    )
    result = cli_cloud("--json", "approvals", "decide", tampered["id"], fine["id"], "--approve")
    rows = _by_id(result)
    assert rows[tampered["id"]]["error"] == "payload_hash_mismatch"
    assert rows[fine["id"]]["state"] == "approved"
    assert result.code == 6


def test_TCMD_BULK_bulk_decide_needs_the_step_up_scope(cli_base: Cli, cloud: CloudFake) -> None:
    first, second = cloud.add_pending_approval(), cloud.add_pending_approval()
    result = cli_base("--json", "approvals", "decide", first["id"], second["id"], "--reject")
    assert result.code == 4
    assert cloud.decisions == []


# ---------------------------------------------------------------------------- tasks
def test_TCMD_BULK_tasks_list_cancel_retry(cli_cloud: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application()
    queued = cloud.queue_task(app_id=app["id"])
    leased = cloud.queue_task("discover")
    leased.update(state="running", lease_id=ids.new_id("lse"), lease_device_id=None)
    late = cloud.queue_task("discover")
    late.update(state="running", lease_id=ids.new_id("lse"), submit_intent_at=cloud.now())
    failed = cloud.queue_task("render_cv")
    failed.update(state="failed", error_class="timeout")
    unknown = cloud.queue_task("discover")
    unknown.update(state="outcome_unknown")

    rows = cli_cloud("--json", "tasks", "list", "--kind", "discover").json["data"]["items"]
    assert {r["id"] for r in rows} == {leased["id"], late["id"], unknown["id"]}
    assert cli_cloud("tasks", "list", "--ids", "--state", "failed").stdout.split() == [failed["id"]]
    assert cli_cloud("--json", "tasks", "list", "--state", "bogus").code == 2

    single = cli_cloud("--json", "tasks", "cancel", queued["id"]).json["data"]
    assert single["task"]["state"] == "cancelled"
    many = cli_cloud("--json", "tasks", "cancel", queued["id"], leased["id"], late["id"])
    assert many.code == 6
    by = _by_id(many)
    assert by[queued["id"]]["state"] == "cancelled"  # already cancelled: a no-op
    assert by[leased["id"]]["cancel_requested"] is True
    assert by[late["id"]]["error"] == "too_late"

    retried = cli_cloud("--json", "tasks", "retry", failed["id"], unknown["id"])
    assert retried.code == 9
    by = _by_id(retried)
    assert by[failed["id"]]["new_task_id"].startswith("tsk_")
    assert by[unknown["id"]]["error"] == "policy_violation"
    confirmed = cli_cloud("--json", "tasks", "retry", unknown["id"], "--confirm-not-submitted")
    assert confirmed.code == 0
    assert confirmed.json["data"]["task"]["retry_of"] == unknown["id"]
    assert cloud.retries[-1] == {"task_id": unknown["id"], "confirm_not_submitted": True}
    hint = cli_cloud("--json", "tasks", "retry", ids.new_id("tsk"))
    assert hint.code == 5


def test_TCMD_BULK_tasks_cancel_needs_the_step_up_scope(cli_base: Cli, cloud: CloudFake) -> None:
    task = cloud.queue_task("discover")
    result = cli_base("--json", "tasks", "cancel", task["id"])
    assert result.code == 4
    assert result.json["error"]["hint"] == "pilih-jobs login --scope automation:manage"


# ---------------------------------------------------------------------------- human output
def test_TCMD_BULK_human_tables_never_truncate_ids(
    cli_cloud: Cli, cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("COLUMNS", "60")
    item = cloud.add_inbox_item()
    item["posting"]["title"] = "A very long job title that has to wrap somewhere on screen"
    rule = cloud.add_rule()
    task = cloud.queue_task("discover")
    for args, wanted in (
        (("inbox", "list"), item["user_job"]["id"]),
        (("rules", "list"), rule["id"]),
        (("tasks", "list"), task["id"]),
    ):
        out = cli_cloud(*args).stdout
        assert wanted in out, out
        assert "…" not in out.split(wanted)[0][-3:]


def test_TCMD_BULK_status_formats_the_last_sync(cli_cloud: Cli, cloud: CloudFake) -> None:
    assert cli_cloud("--json", "sync").code == 0
    out = cli_cloud("status").stdout
    line = next(line for line in out.splitlines() if line.startswith("last sync"))
    assert re.search(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(", line), line
    assert not re.search(r"\d{13}", line)
    raw = cli_cloud("--json", "status").json["data"]["last_sync_at"]
    assert isinstance(raw, int)
    assert fmt_since(None, now_ms=0) == "never"
    assert fmt_since(1_000, now_ms=1_000 + 7_200_000).endswith("(2 h ago)")


def test_TCMD_BULK_list_all_pages_through_every_item(cli_cloud: Cli, cloud: CloudFake) -> None:
    created = [cloud.add_inbox_item()["user_job"]["id"] for _ in range(230)]
    one_page = cli_cloud("inbox", "list", "--ids", "--limit", "200")
    assert len(one_page.stdout.split()) == 200
    every = cli_cloud("inbox", "list", "--ids", "--all")
    assert sorted(every.stdout.split()) == sorted(created)
