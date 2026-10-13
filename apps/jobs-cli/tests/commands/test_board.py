"""TCMD-BOARD: board / application commands (06 §11 parity, 16 §3.3, 20 §10 offline)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.outbox import Outbox
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult
from tests.tasks.fakes import CloudFake

Cli = Callable[..., CliResult]


def _outbox(home: Path, issuer: str) -> list[dict[str, object]]:
    db = StateDB(home / "data" / "state.db")
    try:
        return [e.summary() | {"body": e.json()} for e in Outbox(db, issuer).entries()]
    finally:
        db.close()


def test_TCMD_BOARD_board_and_list(cli_cloud: Cli, cloud: CloudFake) -> None:
    ready = cloud.add_application(stage="ready")
    cloud.add_application(stage="saved")
    board = cli_cloud("--json", "board").json["data"]
    columns = {c["stage"]: c for c in board["columns"]}
    assert columns["ready"]["items"][0]["id"] == ready["id"]
    assert columns["ready"]["total"] == 1
    only = cli_cloud("--json", "board", "--stage", "ready").json["data"]["columns"]
    assert [c["stage"] for c in only] == ["ready"]
    listed = cli_cloud("--json", "list", "--stage", "saved", "--limit", "5").json["data"]["items"]
    assert len(listed) == 1
    assert listed[0]["stage"] == "saved"
    assert "Senior Backend Engineer" in cli_cloud("board").stdout
    assert cli_cloud("--json", "board", "--stage", "nope").code == 2


def test_TCMD_BOARD_show_with_audit_and_legacy_ids(cli_cloud: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application(legacy_job_id="job-42")
    cloud.queue_task(app_id=app["id"])
    shown = cli_cloud("--json", "show", app["id"]).json["data"]
    assert shown["application"]["id"] == app["id"]
    assert "events" not in shown
    audit = cli_cloud("--json", "show", "job-42", "--audit").json["data"]
    assert audit["application"]["id"] == app["id"]
    assert isinstance(audit["events"], list)
    assert audit["task_details"][0]["task"]["application_id"] == app["id"]
    assert cli_cloud("--json", "show", "job-404").code == 5


def test_TCMD_BOARD_offline_reads_come_from_the_cache_with_a_banner(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi
) -> None:
    app = cloud.add_application(stage="ready")
    assert cli_cloud("--json", "sync").code == 0  # pull into the entity cache
    fake_api.offline = True
    listed = cli_cloud("--json", "list")
    shown = cli_cloud("--json", "show", app["id"])
    fake_api.offline = False
    assert listed.code == 0
    assert listed.json["data"]["offline"].startswith("offline — data as of")
    assert [i["id"] for i in listed.json["data"]["items"]] == [app["id"]]
    assert shown.json["data"]["application"]["id"] == app["id"]


def test_TCMD_BOARD_move_uses_base_revision_and_validates_transitions(
    cli_cloud: Cli, cloud: CloudFake
) -> None:
    app = cloud.add_application(stage="ready")
    other = cloud.add_application(stage="applied")
    moved = cli_cloud("--json", "move", app["id"], "applied", "--before", other["id"]).json["data"]
    assert moved["application"]["stage"] == "applied"
    assert moved["application"]["revision"] == app["revision"] + 1
    bad = cli_cloud("--json", "move", app["id"], "saved")
    assert bad.code == 1
    assert bad.json["error"]["code"] == "invalid_transition"


def test_TCMD_BOARD_move_conflict_is_exit_6_non_interactive(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi
) -> None:
    app = cloud.add_application(stage="ready")
    cli_cloud("--json", "sync")
    fake_api.web_move(app["id"], "preparing")  # the web changed it after our pull
    fake_api.fail_next("GET", "^/api/v1/changes$", 503, "upstream_unavailable")  # stale cache
    result = cli_cloud("--json", "move", app["id"], "applied")
    assert result.code == 6
    assert result.json["error"]["code"] == "revision_conflict"
    assert result.json["error"]["details"]["current"]["stage"] == "preparing"


def test_TCMD_BOARD_offline_mutations_are_queued_and_exit_7(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi, home: Path
) -> None:
    app = cloud.add_application(stage="ready")
    cli_cloud("--json", "sync")
    fake_api.offline = True
    edited = cli_cloud("--json", "edit", app["id"], "--priority", "high")
    noted = cli_cloud("--json", "note", app["id"], "Called the recruiter")
    fake_api.offline = False
    assert edited.code == 7
    assert noted.code == 7
    assert noted.json["error"]["details"]["queued"] == 2
    entries = _outbox(home, fake_api.issuer)
    assert [e["method"] for e in entries] == ["PATCH", "POST"]
    assert entries[0]["body"] == {"base_revision": app["revision"], "priority": 1}
    assert entries[1]["body"]["payload"] == {"text": "Called the recruiter"}
    assert cli_cloud("--json", "sync").json["data"]["pushed"] == 2
    assert fake_api.application(app["id"])["priority"] == 1


def test_TCMD_BOARD_submission_commands(cli_cloud: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application(stage="ready")
    applied = cli_cloud(
        "--json", "applied", app["id"], "--method", "email", "--date", "2026-10-01"
    ).json["data"]
    assert applied["application"]["stage"] == "applied"
    assert applied["application"]["submission_method"] == "email"
    other = cloud.add_application(stage="ready", submission_status="submitted_unverified")
    confirmed = cli_cloud("--json", "confirm", other["id"], "--yes").json["data"]
    assert confirmed["application"]["submission_status"] == "submitted_verified"
    denied = cli_cloud("--json", "confirm", other["id"], "--no").json["data"]
    assert denied["application"]["submission_status"] == "failed"
    assert cli_cloud("--json", "confirm", other["id"]).code == 8
    assert cli_cloud("--json", "applied", app["id"], "--method", "fax").code == 2


def test_TCMD_BOARD_edit_follow_up_archive_rm(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi
) -> None:
    app = cloud.add_application(stage="applied")
    edited = cli_cloud("--json", "edit", app["id"], "--mode", "assisted", "--follow-up", "7d").json[
        "data"
    ]
    assert edited["application"]["mode"] == "assisted"
    assert edited["application"]["follow_up_at"] > 0
    cleared = cli_cloud("--json", "follow-up", app["id"], "done").json["data"]
    assert cleared["application"]["follow_up_at"] is None
    note = [e for e in fake_api.events if e["type"] == "note_added"][-1]
    assert note["payload"]["kind"] == "follow_up_done"
    dated = cli_cloud("--json", "follow-up", app["id"], "2026-12-01").json["data"]
    assert dated["application"]["follow_up_at"] is not None
    archived = cli_cloud("--json", "archive", app["id"]).json["data"]
    assert archived["archived"] is True
    assert fake_api.application(app["id"])["archived"] is True
    assert cli_cloud("--json", "rm", app["id"], "--purge").code == 8  # needs a confirmation
    purged = cli_cloud("--json", "--yes", "rm", app["id"], "--purge").json["data"]
    assert purged["deleted"] is True
    assert purged["purged"] is True
    assert cli_cloud("--json", "edit", app["id"]).code == 2


def test_TCMD_BOARD_checklists(cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi) -> None:
    app = cloud.add_application(stage="ready", sections=[])
    added = cli_cloud(
        "--json", "checklist", "add", app["id"], "Prepare portfolio", "--url", "https://x.dev"
    ).json["data"]
    item = added["item"]
    assert added["sections"][0]["name"] == "Checklist"
    assert added["sections"][0]["items"][0]["id"] == item["id"]
    done = cli_cloud("--json", "checklist", "done", app["id"], item["id"]).json["data"]
    assert done["sections"][0]["items"][0]["done"] is True
    listed = cli_cloud("--json", "checklist", "list", app["id"]).json["data"]
    assert listed["sections"][0]["items"][0]["done"] is True
    removed = cli_cloud("--json", "checklist", "rm", app["id"], item["id"]).json["data"]
    assert removed["sections"][0]["items"] == []
    assert cli_cloud("--json", "checklist", "done", app["id"], "item-missing").code == 5
    assert fake_api.application(app["id"])["sections"][0]["items"] == []


def test_TCMD_BOARD_interviews_offers_track_score_stats(cli_cloud: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application(stage="applied")
    interview = cli_cloud(
        "--json",
        "interview",
        "add",
        app["id"],
        "--at",
        "2026-11-03 10:00",
        "--kind",
        "technical",
        "--duration",
        "60",
        "--location",
        "https://meet.example/x",
    )
    assert interview.code == 0, interview.stdout
    assert cloud.interviews[-1]["kind"] == "technical"
    assert cloud.interviews[-1]["duration_min"] == 60
    offer = cli_cloud(
        "--json",
        "offer",
        "add",
        app["id"],
        "--base",
        "45000000",
        "--currency",
        "idr",
        "--deadline",
        "2026-11-20",
    )
    assert offer.code == 0
    assert cloud.offers[-1]["compensation"] == {
        "period": "year",
        "base": 45000000.0,
        "currency": "IDR",
    }
    tracked = cli_cloud("--json", "track", "https://acme.com/jobs/7", "--stage", "saved").json[
        "data"
    ]
    assert tracked["application"]["stage"] == "saved"
    item = cloud.add_inbox_item()
    scored = cli_cloud(
        "--json", "score", item["user_job"]["id"], "pst_01JA6V8M3W8Z1T6Q4Y2B7K9C00"
    ).json["data"]
    assert scored["queued"]
    assert cloud.score_requests[0] == {"user_job_ids": [item["user_job"]["id"]]}
    assert cloud.score_requests[1] == {"posting_ids": ["pst_01JA6V8M3W8Z1T6Q4Y2B7K9C00"]}
    all_new = cli_cloud("--json", "score", "--all-new", "--wait").json["data"]
    assert all_new["queued"]
    assert all(s["status"] == "ready" for s in all_new["scores"].values())
    stats = cli_cloud("--json", "stats", "--from", "2026-09-01", "--by", "source").json["data"]
    assert "funnel" in stats["summary"]
    assert "rows" in stats["breakdown"]
    assert cli_cloud("--json", "score").code == 2
    assert "funnel" in json.dumps(cli_cloud("--json", "stats").json)
