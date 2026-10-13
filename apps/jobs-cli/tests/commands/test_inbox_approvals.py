"""TCMD-INBOX, TCMD-APPROVALS and the rules / logs / worker setting commands."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path

import pytest

from pilih_jobs.cli.approvals import verify_payload_hash
from pilih_jobs.cli.context import CliState
from pilih_jobs.email.handoff import canonical_json
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.outbox import Outbox
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult
from tests.tasks.fakes import CloudFake

Cli = Callable[..., CliResult]


# ---------------------------------------------------------------------------- inbox
def test_TCMD_INBOX_list_and_show(cli_cloud: Cli, cloud: CloudFake) -> None:
    item = cloud.add_inbox_item(score=81)
    cloud.add_inbox_item(state="dismissed")
    rows = cli_cloud("--json", "inbox", "list", "--min-score", "70", "--limit", "10").json["data"][
        "items"
    ]
    assert [r["user_job_id"] for r in rows] == [item["user_job"]["id"]]
    assert rows[0]["score"] == 81
    assert rows[0]["title"] == "Senior Backend Engineer"
    shown = cli_cloud("--json", "inbox", "show", item["user_job"]["id"]).json["data"]
    assert shown["posting"]["id"] == item["posting"]["id"]
    full = cli_cloud("--json", "inbox", "show", item["user_job"]["id"], "--description").json[
        "data"
    ]
    assert full["posting"]["description_text"] == item["posting"]["description_text"]
    assert cli_cloud("--json", "inbox", "list", "--state", "bogus").code == 2
    assert cli_cloud("--json", "inbox", "show", "app_01JA6V8M3W8Z1T6Q4Y2B7K9C00").code == 2


def test_TCMD_INBOX_track_and_dismiss_report_per_id(cli_cloud: Cli, cloud: CloudFake) -> None:
    first, second = cloud.add_inbox_item(), cloud.add_inbox_item()
    ids = [first["user_job"]["id"], second["user_job"]["id"]]
    bulk = cli_cloud("--json", "inbox", "track", *ids).json["data"]["results"]
    assert [r["user_job_id"] for r in bulk] == ids
    assert {r["status"] for r in bulk} == {"ok"}
    created = cli_cloud(
        "--json", "inbox", "track", ids[0], "--mode", "approval", "--stage", "ready"
    ).json["data"]
    assert created["results"][0]["application_id"].startswith("app_")
    dismissed = cli_cloud("--json", "inbox", "dismiss", *ids).json["data"]["results"]
    assert {r["inbox_state"] for r in dismissed} == {"dismissed"}


def test_TCMD_INBOX_dismissing_many_needs_confirmation_and_offline_queues(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi, home: Path
) -> None:
    many = [f"ujb_01JA6V8M3W8Z1T6Q4Y2B7K9D{n:02d}" for n in range(51)]
    assert cli_cloud("--json", "inbox", "dismiss", *many).code == 8
    fake_api.offline = True
    queued = cli_cloud("--json", "--yes", "inbox", "dismiss", *many)
    fake_api.offline = False
    assert queued.code == 7
    assert queued.json["error"]["details"]["queued"] == 1
    db = StateDB(home / "data" / "state.db")
    try:
        entry = Outbox(db, fake_api.issuer).entries()[0]
    finally:
        db.close()
    assert entry.path == "/api/v1/inbox:bulk"
    assert entry.json()["action"] == "dismiss"
    assert len(entry.json()["user_job_ids"]) == 51


# ---------------------------------------------------------------------------- approvals
def _browser_payload(form_hash: str) -> dict[str, object]:
    return {
        "type": "browser_submit",
        "form_hash": form_hash,
        "url": "https://job-boards.greenhouse.io/acme/jobs/1/apply",
        "posting_id": "pst_01JA6V8M3W8Z1T6Q4Y2B7K9C00",
        "fields": [],
        "attachments": [],
    }


def test_TCMD_APPROVALS_list_filters(cli_cloud: Cli, cloud: CloudFake) -> None:
    approval = cloud.add_pending_approval()
    rows = cli_cloud("--json", "approvals", "list").json["data"]["items"]
    assert [r["id"] for r in rows] == [approval["id"]]
    assert cli_cloud("--json", "approvals", "list", "--kind", "answer").json["data"]["items"] == []
    assert cli_cloud("--json", "approvals", "list", "--kind", "nope").code == 2


def test_TCMD_APPROVALS_decide_approve_and_reject(cli_cloud: Cli, cloud: CloudFake) -> None:
    approval = cloud.add_pending_approval()
    assert cli_cloud("--json", "approvals", "decide", approval["id"]).code == 8
    approved = cli_cloud("--json", "approvals", "decide", approval["id"], "--approve").json["data"]
    assert approved["state"] == "approved"
    assert cloud.decisions[-1] == {"decision": "approve", "payload_hash": approval["payload_hash"]}
    again = cli_cloud("--json", "approvals", "decide", approval["id"], "--reject")
    assert again.code == 6
    assert again.json["error"]["code"] == "already_decided"
    other = cloud.add_pending_approval()
    assert (
        cli_cloud("--json", "approvals", "decide", other["id"], "--reject").json["data"]["state"]
        == "rejected"
    )


def test_TCMD_APPROVALS_yes_never_approves_a_submission_interactively(
    cli_cloud: Cli, cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    approval = cloud.add_pending_approval()
    monkeypatch.setattr(CliState, "interactive", property(lambda _self: True))
    asked: list[str] = []
    monkeypatch.setattr("typer.confirm", lambda q, default=False: asked.append(q) or False)
    result = cli_cloud("--json", "--yes", "approvals", "decide", approval["id"], "--approve")
    assert result.json["data"] == {"state": "pending", "decided": False}
    assert asked
    assert "Submit this application" in asked[0]
    assert cloud.decisions == []


def test_TCMD_APPROVALS_payload_hash_must_match_the_content(
    cli_cloud: Cli, cloud: CloudFake
) -> None:
    form_hash = "a" * 64
    tampered = cloud.add_pending_approval(
        payload=_browser_payload(form_hash), payload_hash="b" * 64
    )
    result = cli_cloud("--json", "approvals", "decide", tampered["id"], "--approve")
    assert result.code == 6
    assert result.json["error"]["code"] == "payload_hash_mismatch"
    assert cloud.decisions == []
    payload = _browser_payload(form_hash)
    canonical = hashlib.sha256(
        canonical_json({k: v for k, v in payload.items() if k != "type"}).encode()
    ).hexdigest()
    assert verify_payload_hash({"payload": payload, "payload_hash": canonical}) is True
    assert verify_payload_hash({"payload": payload, "payload_hash": form_hash}) is True
    assert (
        verify_payload_hash({"payload": {"type": "cv_variant"}, "payload_hash": "c" * 64}) is None
    )


def test_TCMD_APPROVALS_answer_kind_sends_the_response(cli_cloud: Cli, cloud: CloudFake) -> None:
    payload = {
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
    approval = cloud.add_pending_approval(kind="answer", payload=payload, payload_hash="d" * 64)
    result = cli_cloud(
        "--json", "approvals", "decide", approval["id"], "--approve", "--answer", "IDR 30 juta"
    )
    assert result.code == 0, result.stdout
    assert cloud.decisions[-1]["response"] == {"answers": [{"ref": "q1", "value": "IDR 30 juta"}]}


def test_TCMD_APPROVALS_decide_needs_the_step_up_scope(cli_base: Cli, cloud: CloudFake) -> None:
    approval = cloud.add_pending_approval()
    result = cli_base("--json", "approvals", "decide", approval["id"], "--approve")
    assert result.code == 4
    assert result.json["error"]["hint"] == "pilih-jobs login --scope automation:manage"


# ---------------------------------------------------------------------------- rules
def test_TCMD_APPROVALS_rules_list_show_enable_disable(cli_cloud: Cli, cloud: CloudFake) -> None:
    rule = cloud.add_rule(mode="approval", enabled=False)
    auto = cloud.add_rule(mode="auto", enabled=False)
    rows = cli_cloud("--json", "rules", "list").json["data"]["items"]
    assert {r["id"] for r in rows} == {rule["id"], auto["id"]}
    assert cli_cloud("--json", "rules", "show", rule["id"]).json["data"]["rule"]["id"] == rule["id"]
    enabled = cli_cloud("--json", "rules", "enable", rule["id"]).json["data"]
    assert enabled["rule"]["enabled"] is True
    assert enabled["changed"] is True
    refused = cli_cloud("--json", "rules", "enable", auto["id"])
    assert refused.code == 9
    assert refused.json["error"]["code"] == "mode_not_allowed"
    assert (
        cli_cloud("--json", "rules", "disable", rule["id"]).json["data"]["rule"]["enabled"] is False
    )


# ---------------------------------------------------------------------------- worker settings
def test_TCMD_APPROVALS_worker_enable_disable_and_kill_switch(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi
) -> None:
    disabled = cli_cloud("--json", "worker", "disable").json["data"]
    assert disabled["accepts_tasks"] is False
    device = next(iter(fake_api.devices.values()))
    assert device["accepts_tasks"] is False
    device["revision"] += 5  # changed elsewhere: one automatic retry with the current revision
    assert cli_cloud("--json", "worker", "enable").json["data"]["accepts_tasks"] is True
    assert cli_cloud("--json", "worker", "pause-all").json["data"] == {"automation_paused": True}
    assert cloud.settings["automation_paused"] is True
    assert cli_cloud("--json", "worker", "resume-all").code == 8  # resuming asks
    assert (
        cli_cloud("--json", "--yes", "worker", "resume-all").json["data"]["automation_paused"]
        is False
    )
    status = cli_cloud("--json", "automation", "status").json["data"]  # hidden alias
    assert status["running"] is False
    assert status["local_tasks"] == []


# ---------------------------------------------------------------------------- logs
def test_TCMD_APPROVALS_logs_filters_and_ndjson(cli_cloud: Cli, home: Path) -> None:
    log_dir = home / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    records = [
        {"ts": 1, "level": "info", "event": "claimed", "task_id": "tsk_A", "msg": "a"},
        {"ts": 2, "level": "debug", "event": "noise", "task_id": "tsk_B", "msg": "b"},
        {
            "ts": 3,
            "level": "error",
            "event": "boom",
            "task_id": "tsk_A",
            "attempt_id": "att_X",
            "msg": "token=abc123secretvalue",
        },
    ]
    (log_dir / "pilih-jobs.log").write_text(
        "\n".join(json.dumps(r) for r in records) + "\nnot json\n"
    )
    steps = home / "data" / "runs" / "att_X"
    steps.mkdir(parents=True)
    (steps / "steps.jsonl").write_text(json.dumps({"ts": 4, "event": "action_executed"}) + "\n")
    task_lines = cli_cloud("--json", "logs", "--task", "tsk_A").ndjson
    assert [r["event"] for r in task_lines] == ["claimed", "boom"]
    assert "abc123secretvalue" not in json.dumps(task_lines)
    errors = cli_cloud("--json", "logs", "--level", "error").ndjson
    assert [r["event"] for r in errors] == ["boom"]
    run = cli_cloud("--json", "logs", "--run", "att_X").ndjson
    assert [r["event"] for r in run] == ["action_executed", "boom"]
    human = cli_cloud("logs", "--lines", "1")
    assert "boom" in human.stdout
    assert "claimed" not in human.stdout
    assert cli_cloud("--json", "logs", "--level", "loud").code == 2
    assert cli_cloud("--json", "logs", "--run", "att_none").code == 5
