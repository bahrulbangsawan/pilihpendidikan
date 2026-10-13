"""T9-04, T9-05, T9-06 and TCMD-EMAIL: the `.eml` of a local hand-off (RFC 5322, RFC 2047,
multipart with base64 PDFs, `X-Unsent: 1`), integrity of attachments, the OS opener and the
`email` command group (09 §6.1, §10)."""

from __future__ import annotations

import email
import email.policy
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.cli.context import CliState
from pilih_jobs.email.eml import Attachment, build_eml
from pilih_jobs.email.handoff import email_payload_hash
from pilih_jobs.email.opener import open_with_os, opener_command
from pilih_jobs.email.templates import TEMPLATES, render_email_template
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult
from tests.tasks.fakes import PDF, CloudFake, sha

Cli = Callable[..., CliResult]
REPO = Path(__file__).resolve().parents[4]
SUBJECT_ID = "Lamaran Staf Keuangan — Rahma Putri"


def _eml(**overrides: Any) -> bytes:
    values: dict[str, Any] = {
        "from_address": "rahma@example.com",
        "from_name": "Rahma Putri",
        "to_address": "karir@contoh.co.id",
        "subject": SUBJECT_ID,
        "body_text": "Yth. Tim Rekrutmen,\n\nDengan hormat, saya melamar.\nTerima kasih.",
        "attachments": [Attachment("Rahma_Putri_CV_Contoh.pdf", PDF)],
        "date": 1_791_770_000,
    }
    values.update(overrides)
    return build_eml(**values)


def test_T9_04_rfc5322_headers_and_x_unsent() -> None:
    raw = _eml()
    head = raw.split(b"\r\n\r\n", 1)[0].decode("ascii")  # headers are pure ASCII
    for name in (
        "From:",
        "To:",
        "Subject:",
        "Date:",
        "Message-ID:",
        "MIME-Version: 1.0",
        "X-Unsent: 1",
    ):
        assert name in head
    assert b"\r\n" in raw
    assert b"\n" not in raw.replace(b"\r\n", b"")
    message = email.message_from_bytes(raw, policy=email.policy.default)
    assert message["From"].addresses[0].addr_spec == "rahma@example.com"
    assert message["To"] == "karir@contoh.co.id"
    assert message["X-Unsent"] == "1"
    assert message["Message-ID"].endswith("@example.com>")


def test_T9_04_non_ascii_subject_uses_rfc2047_encoded_words() -> None:
    raw = _eml()
    subject_line = next(line for line in raw.split(b"\r\n") if line.startswith(b"Subject:"))
    assert b"=?utf-8?" in subject_line.lower()
    assert "—".encode() not in raw.split(b"\r\n\r\n", 1)[0]
    parsed = email.message_from_bytes(raw, policy=email.policy.default)
    assert parsed["Subject"] == SUBJECT_ID


def test_T9_04_multipart_mixed_with_base64_pdf_round_trips() -> None:
    raw = _eml(
        attachments=[Attachment("CV Rahmå.pdf", PDF), Attachment("Portfolio.pdf", PDF + b"2")]
    )
    message = email.message_from_bytes(raw, policy=email.policy.default)
    assert message.get_content_type() == "multipart/mixed"
    parts = list(message.iter_parts())
    body = parts[0]
    assert body.get_content_type() == "text/plain"
    assert body.get_content_charset() == "utf-8"
    assert "Dengan hormat" in body.get_content()
    pdfs = parts[1:]
    assert [p.get_content_type() for p in pdfs] == ["application/pdf", "application/pdf"]
    assert all(p["Content-Transfer-Encoding"] == "base64" for p in pdfs)
    assert pdfs[0].get_filename() == "CV Rahmå.pdf"
    assert pdfs[0].get_content() == PDF
    assert pdfs[1].get_content() == PDF + b"2"


def test_T9_04_templates_match_the_contracts_and_render_without_holes() -> None:
    for locale in ("en", "id"):
        source = (
            REPO / "packages" / "jobs-contracts" / "email-templates" / f"{locale}.txt"
        ).read_text("utf-8")
        assert TEMPLATES[locale] == source.replace("\r\n", "\n"), locale
    rendered = render_email_template(
        locale="id",
        facts={"contact.full_name": "Rahma Putri"},
        posting={"title": "Staf Keuangan", "company_name": "Contoh", "source_job_ref": "FIN-7"},
    )
    assert rendered.subject == SUBJECT_ID
    assert "(ref. FIN-7)" in rendered.body_text
    assert "Yth. Tim Rekrutmen Contoh," in rendered.body_text
    for hole in ("None", "undefined", "null", "{", "\n\n\n"):
        assert hole not in rendered.body_text
    bare = render_email_template(
        locale="en", facts={}, posting={"title": "Analyst", "company_name": "X"}
    )
    assert bare.subject == "Application for Analyst"  # the dangling " —" is cut


def test_T9_04_payload_hash_binds_the_exact_content() -> None:
    base = email_payload_hash(to="a@b.co", subject="S", body_text="B", attachment_sha256=[sha(PDF)])
    assert len(base) == 64
    assert base == email_payload_hash(
        to="a@b.co", subject="S", body_text="B", attachment_sha256=[sha(PDF)]
    )
    assert base != email_payload_hash(
        to="a@b.co", subject="S", body_text="B.", attachment_sha256=[sha(PDF)]
    )
    assert base != email_payload_hash(to="a@b.co", subject="S", body_text="B", attachment_sha256=[])


def test_T9_06_os_opener_per_platform(tmp_path: Path) -> None:
    target = tmp_path / "application.eml"
    assert opener_command(target, "darwin") == ["open", str(target)]
    assert opener_command(target, "linux") == ["xdg-open", str(target)]
    assert opener_command(target, "win32") is None
    ran: list[list[str]] = []

    def runner(argv: Any) -> int:
        ran.append(list(argv))
        return 0

    assert open_with_os(target, platform="darwin", runner=runner, which=lambda _n: "/usr/bin/open")
    assert ran == [["open", str(target)]]
    started: list[str] = []
    assert open_with_os(target, platform="win32", startfile=started.append)
    assert started == [str(target)]
    assert not open_with_os(target, platform="linux", runner=runner, which=lambda _n: None)

    def broken(_path: str) -> None:
        raise OSError("no association")

    assert not open_with_os(target, platform="win32", startfile=broken)


def _approved_email(cloud: CloudFake) -> tuple[dict[str, Any], dict[str, Any]]:
    app = cloud.add_application()
    variant = cloud.add_cv_variant(app["id"])
    record = {
        "id": "eml_01JA6V8M3W8Z1T6Q4Y2B7K9C11",
        "user_id": cloud.user_id,
        "application_id": app["id"],
        "to_address": "careers@acme.co.id",
        "subject": "Application for Engineer — Rahma Putri",
        "body_text": "Dear Hiring Team,\n\nPlease find my CV attached.",
        "attachment_file_ids": [variant["file_id"]],
        "delivery": "local_handoff",
        "status": "approved",
        "provider_message_id": None,
        "approved_at": cloud.now(),
        "sent_at": None,
        "revision": 2,
        "created_at": cloud.now(),
        "updated_at": cloud.now(),
    }
    cloud.emails[record["id"]] = record
    return record, app


def _remember(home: Path, issuer: str, record: dict[str, Any]) -> None:
    from pilih_jobs.email.handoff import remember_email
    from pilih_jobs.storage.db import StateDB

    db = StateDB(home / "data" / "state.db")
    try:
        remember_email(db, issuer, record)
    finally:
        db.close()


def test_T9_06_send_non_interactive_prints_instructions_and_leaves_approved(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi, home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    record, _ = _approved_email(cloud)
    _remember(home, fake_api.issuer, record)
    opened: list[Path] = []
    monkeypatch.setattr("pilih_jobs.cli.email.opener", lambda path: opened.append(path) or True)
    result = cli_cloud("--json", "email", "send", record["id"])
    assert result.code == 0, result.stdout
    data = result.json["data"]
    eml = Path(data["eml_path"])
    assert eml == home / "data" / "runs" / record["id"] / "application.eml"
    assert opened == [eml]
    assert oct(eml.stat().st_mode)[-3:] == "600"
    parsed = email.message_from_bytes(eml.read_bytes(), policy=email.policy.default)
    assert parsed["To"] == "careers@acme.co.id"
    assert parsed["X-Unsent"] == "1"
    assert parsed["From"].addresses[0].addr_spec == "rahma@example.com"
    assert any("email confirm" in line for line in data["instructions"])
    assert cloud.handed_off == []
    assert cloud.emails[record["id"]]["status"] == "approved"


def test_T9_06_send_interactive_asks_and_reports_the_hand_off(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi, home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    record, app = _approved_email(cloud)
    _remember(home, fake_api.issuer, record)
    monkeypatch.setattr("pilih_jobs.cli.email.opener", lambda _path: True)
    monkeypatch.setattr(CliState, "interactive", property(lambda _self: True))
    asked: list[str] = []
    monkeypatch.setattr(
        "typer.confirm", lambda question, default=False: asked.append(question) or True
    )
    result = cli_cloud("--json", "email", "send", record["id"])
    assert result.code == 0, result.stdout
    assert asked[0] == "Did you send it?"
    assert cloud.handed_off[-1]["sent_confirmed"] is True
    assert isinstance(cloud.handed_off[-1]["sent_at"], int)
    data = result.json["data"]
    assert data["status"] == "handed_off"
    assert data["submission_status"] == "submitted_unverified"
    assert cloud.fake.entities[("application", app["id"])]["stage"] == "applied"


def test_T9_05_attachment_sha256_mismatch_aborts_the_hand_off(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi, home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    record, _ = _approved_email(cloud)
    _remember(home, fake_api.issuer, record)
    cloud.content_override[record["attachment_file_ids"][0]] = PDF + b"swapped"
    opened: list[Path] = []
    monkeypatch.setattr("pilih_jobs.cli.email.opener", lambda path: opened.append(path) or True)
    result = cli_cloud("--json", "email", "send", record["id"])
    assert result.code == 1
    assert result.json["error"]["code"] == "artifact_integrity"
    assert opened == []
    assert cloud.handed_off == []
    folder = home / "data" / "runs" / record["id"]
    assert not (folder / "application.eml").exists()
    assert not [p for p in folder.iterdir() if p.suffix == ".pdf"]


def test_TCMD_EMAIL_draft_show_approve_confirm(
    cli_cloud: Cli, cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = cloud.add_application()
    variant = cloud.add_cv_variant(app["id"])
    drafted = cli_cloud(
        "--json",
        "--yes",
        "email",
        "draft",
        app["id"],
        "--to",
        "careers@acme.co.id",
        "--locale",
        "id",
    )
    assert drafted.code == 0, drafted.stdout
    record = drafted.json["data"]["email_application"]
    assert record["status"] == "draft"
    assert record["attachment_file_ids"] == [variant["file_id"]]
    assert record["subject"].startswith("Lamaran ")
    assert "Rahma Putri" in record["subject"]
    shown = cli_cloud("--json", "email", "show", record["id"]).json["data"]
    assert shown["attachments"][0]["sha256"] == sha(PDF)
    expected = email_payload_hash(
        to=record["to_address"],
        subject=record["subject"],
        body_text=record["body_text"],
        attachment_sha256=[sha(PDF)],
    )
    assert shown["payload_hash"] == expected
    # --yes never approves a submission: a TTY confirmation is required (exit 8)
    refused = cli_cloud("--json", "--yes", "email", "approve", record["id"])
    assert refused.code == 8
    assert refused.json["error"]["details"]["needed"]["payload_hash"] == expected
    monkeypatch.setattr(CliState, "interactive", property(lambda _self: True))
    monkeypatch.setattr("typer.confirm", lambda _q, default=False: True)
    approved = cli_cloud("--json", "email", "approve", record["id"])
    assert approved.code == 0, approved.stdout
    assert approved.json["data"]["status"] == "approved"
    assert cloud.decisions[-1]["payload_hash"] == expected
    monkeypatch.setattr(CliState, "interactive", property(lambda _self: False))
    confirmed = cli_cloud("--json", "email", "confirm", record["id"], "--not-sent").json["data"]
    assert confirmed["submission_status"] == "failed"
    assert cloud.handed_off[-1]["sent_confirmed"] is False
    assert cli_cloud("--json", "email", "confirm", record["id"]).code == 8
    assert cli_cloud("--json", "email", "draft", app["id"], "--to", "not-an-address").code == 2


def test_TCMD_EMAIL_approve_needs_the_step_up_scope(cli_base: Cli, cloud: CloudFake) -> None:
    result = cli_base("--json", "email", "approve", "eml_01JA6V8M3W8Z1T6Q4Y2B7K9C11")
    assert result.code == 4
    assert result.json["error"]["details"]["scope"] == "automation:manage"


def test_TCMD_EMAIL_approve_sends_the_server_review_hash_and_the_recipient_tick(
    cli_cloud: Cli, cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = cloud.add_application()
    cloud.add_cv_variant(app["id"])
    cloud.review_hash = "e" * 64
    drafted = cli_cloud("--json", "--yes", "email", "draft", app["id"], "--to", "hr.acme@gmail.com")
    record = drafted.json["data"]["email_application"]
    monkeypatch.setattr(CliState, "interactive", property(lambda _self: True))
    questions: list[str] = []
    monkeypatch.setattr(
        "typer.confirm", lambda q, default=False: questions.append(q) or "employer" not in q
    )
    approved = cli_cloud("--json", "email", "approve", record["id"])
    assert approved.code == 0, approved.stdout
    assert cloud.decisions[-1] == {
        "email": record["id"],
        "payload_hash": "e" * 64,
        "recipient_confirmed": False,
    }
    assert any("belongs to the employer" in q for q in questions)
    cloud.emails[record["id"]]["status"] = "draft"
    again = cli_cloud("--json", "email", "approve", record["id"], "--confirm-recipient")
    assert again.code == 0
    assert cloud.decisions[-1]["recipient_confirmed"] is True


def test_TCMD_EMAIL_show_reads_the_email_route_on_a_fresh_device(
    cli_cloud: Cli, cloud: CloudFake, home: Path
) -> None:
    """`GET /api/v1/emails/{id}` needs no local index: a draft made on the web is shown."""
    from pilih_jobs.storage.db import StateDB

    app = cloud.add_application()
    variant = cloud.add_cv_variant(app["id"])
    drafted = cli_cloud("--json", "--yes", "email", "draft", app["id"], "--to", "hr@acme.com")
    record = drafted.json["data"]["email_application"]
    db = StateDB(home / "data" / "state.db")
    try:  # forget everything this device knew about the draft
        db.execute("DELETE FROM kv WHERE key LIKE 'email_%'")
        db.execute("DELETE FROM entity_cache WHERE entity = 'email'")
    finally:
        db.close()
    reads = cloud.email_reads
    shown = cli_cloud("--json", "email", "show", record["id"])
    assert shown.code == 0, shown.stdout
    data = shown.json["data"]
    assert cloud.email_reads == reads + 1
    assert data["email"]["id"] == record["id"]
    assert data["attachments"][0]["file_id"] == variant["file_id"]
    assert data["payload_hash"] == email_payload_hash(
        to="hr@acme.com",
        subject=record["subject"],
        body_text=record["body_text"],
        attachment_sha256=[sha(PDF)],
    )
    assert cli_cloud("--json", "email", "show", "eml_01JA6V8M3W8Z1T6Q4Y2B7K9C99").code == 5
