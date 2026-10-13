"""T8-11 and TCMD-CV: verified CV downloads (SHA-256 + ETag, delete on mismatch, staging
naming and cleanup, offline cache) and the `cv` command group (08)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.api.client import ApiClient
from pilih_jobs.cv.download import (
    cleanup_staging,
    download_verified,
    etag_digest,
    presentable_cv_name,
    staging_dir,
)
from pilih_jobs.runtime import Runtime
from pilih_jobs.tasks.errors import ArtifactIntegrityError
from tests.support.fake_api import FakeApi
from tests.support.helpers import CliResult
from tests.tasks.fakes import PDF, CloudFake, sha

Cli = Callable[..., CliResult]


async def test_T8_11_download_verifies_sha256_and_etag(
    runtime: Runtime, api: ApiClient, cloud: CloudFake, tmp_path: Path
) -> None:
    view = cloud.add_file()
    result = await download_verified(
        api, view["id"], tmp_path / "cv.pdf", view["sha256"], paths=runtime.paths
    )
    assert result.sha256 == sha(PDF)
    assert result.path.read_bytes() == PDF
    assert result.etag == f'"{view["sha256"]}"'
    assert oct(result.path.stat().st_mode)[-3:] == "600"
    assert not list(tmp_path.glob(".*.part"))


async def test_T8_11_sha256_mismatch_deletes_the_file(
    runtime: Runtime, api: ApiClient, cloud: CloudFake, tmp_path: Path
) -> None:
    view = cloud.add_file()
    cloud.content_override[view["id"]] = PDF + b"tampered"
    cloud.etag_override[view["id"]] = ""  # no ETag: the files.sha256 check alone must catch it
    target = tmp_path / "dl" / "cv.pdf"
    target.parent.mkdir()
    target.write_bytes(b"old copy")
    with pytest.raises(ArtifactIntegrityError) as caught:
        await download_verified(api, view["id"], target, view["sha256"])
    assert caught.value.details["error_class"] == "artifact_integrity"
    assert not target.exists()
    assert not list(target.parent.iterdir())


async def test_T8_11_etag_mismatch_deletes_the_file(
    api: ApiClient, cloud: CloudFake, tmp_path: Path
) -> None:
    view = cloud.add_file()
    cloud.etag_override[view["id"]] = f'"{"a" * 64}"'
    with pytest.raises(ArtifactIntegrityError):
        await download_verified(api, view["id"], tmp_path / "cv.pdf", view["sha256"])
    cloud.etag_override[view["id"]] = '"abc"'  # an ETag that is not a SHA-256 is refused too
    with pytest.raises(ArtifactIntegrityError):
        await download_verified(api, view["id"], tmp_path / "cv.pdf", view["sha256"])
    assert not (tmp_path / "cv.pdf").exists()


def test_T8_11_etag_parsing_and_presentable_names() -> None:
    digest = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    assert etag_digest(f'"{digest}"') == digest
    assert etag_digest(f'W/"{digest.upper()}"') == digest
    assert etag_digest(f'"sha256:{digest}"') == digest
    assert etag_digest('"d41d8cd98f00b204e9800998ecf8427e"') is None
    assert presentable_cv_name("Rahma Putri", "Acme, Inc.") == "Rahma_Putri_CV_Acme_Inc.pdf"
    hostile = presentable_cv_name("Rahmå/../x", None)
    assert "/" not in hostile
    assert hostile.startswith("Rahm_")
    assert hostile.endswith("_CV.pdf")
    long = presentable_cv_name("A" * 100, "B" * 100)
    assert len(long) <= 80
    assert long.endswith(".pdf")


def test_T8_11_staging_is_private_and_cleaned_up(runtime: Runtime) -> None:
    directory = staging_dir(runtime.paths, "att_01JA6V8M3W8Z1T6Q4Y2B7K9C00")
    assert oct(directory.stat().st_mode)[-3:] == "700"
    (directory / "cv.pdf").write_bytes(PDF)
    assert cleanup_staging(runtime.paths, "att_01JA6V8M3W8Z1T6Q4Y2B7K9C00") is True
    assert not directory.exists()
    assert cleanup_staging(runtime.paths, "att_01JA6V8M3W8Z1T6Q4Y2B7K9C00") is False


def test_T8_11_cv_download_command_stages_and_works_offline_from_the_cache(
    cli_cloud: Cli, cloud: CloudFake, fake_api: FakeApi, home: Path
) -> None:
    app = cloud.add_application()
    variant = cloud.add_cv_variant(app["id"])
    online = cli_cloud("--json", "cv", "download", variant["id"])
    assert online.code == 0, online.stdout
    data = online.json["data"]
    path = Path(data["path"])
    assert path.name == "Rahma_Putri_CV_Acme.pdf"
    assert path.parent == home / "data" / "runs" / variant["id"] / "staging"
    assert data["sha256"] == sha(PDF)
    assert path.read_bytes() == PDF
    by_app = cli_cloud("--json", "cv", "download", app["id"], "--out", str(home / "mine.pdf"))
    assert Path(by_app.json["data"]["path"]) == home / "mine.pdf"
    fake_api.offline = True
    offline = cli_cloud(
        "--json", "cv", "download", variant["id"], "--out", str(home / "offline.pdf")
    )
    fake_api.offline = False
    assert offline.code == 0
    assert offline.json["data"]["offline"] is True
    assert (home / "offline.pdf").read_bytes() == PDF


def test_T8_11_cv_download_refuses_unrendered_and_tampered(
    cli_cloud: Cli, cloud: CloudFake, home: Path
) -> None:
    app = cloud.add_application()
    pending = cloud.add_cv_variant(app["id"], status="generating", with_file=False)
    assert (
        cli_cloud("--json", "cv", "download", pending["id"]).json["error"]["code"] == "cv_not_ready"
    )
    variant = cloud.add_cv_variant(None)
    cloud.content_override[variant["file_id"]] = b"%PDF evil"
    bad = cli_cloud("--json", "cv", "download", variant["id"])
    assert bad.code == 1
    assert bad.json["error"]["code"] == "artifact_integrity"
    assert not list((home / "data" / "runs" / variant["id"] / "staging").glob("*.pdf"))


def test_TCMD_CV_list_show_and_diff(cli_cloud: Cli, cloud: CloudFake) -> None:
    listed = cli_cloud("--json", "cv", "list").json["data"]["items"]
    assert listed
    assert "id" in listed[0]
    variant = cloud.add_cv_variant(None)
    shown = cli_cloud("--json", "cv", "show", variant["id"], "--diff").json["data"]
    assert shown["cv_variant"]["id"] == variant["id"]
    summary = shown["diff_summary"]
    assert summary["operations"] == {"rephrase": 1}
    assert summary["section_order_changed"] is True
    assert summary["excluded_entries"] == 1
    human = cli_cloud("cv", "show", variant["id"], "--diff")
    assert "Built payment APIs in Go" in human.stdout
    assert "excluded: projects" in human.stdout


def test_TCMD_CV_generate_needs_the_cv_write_step_up(cli_base: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application()
    refused = cli_base("--json", "cv", "generate", app["id"])
    assert refused.code == 4
    assert refused.json["error"]["hint"] == "pilih-jobs login --scope cv:write"


def test_TCMD_CV_generate_with_wait(
    cli_cloud: Cli, cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = cloud.add_application(base_cv_id="rahma-cv")

    monkeypatch.setattr("pilih_jobs.cv.variants.GENERATE_POLL_S", 0.01)
    cloud.finish_generation = True
    result = cli_cloud(
        "--json", "cv", "generate", app["id"], "--template", "harvard", "--no-tailor", "--wait"
    )
    assert result.code == 0, result.stdout
    variant = result.json["data"]["cv_variant"]
    assert variant["status"] == "draft"
    assert variant["template"] == "harvard"
    assert cli_cloud("--json", "cv", "generate", app["id"], "--template", "fancy").code == 2


def test_TCMD_CV_review_approves_with_base_revision(cli_cloud: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application()
    variant = cloud.add_cv_variant(app["id"], status="draft")
    needs = cli_cloud("--json", "cv", "review", variant["id"])
    assert needs.code == 8
    assert needs.json["error"]["code"] == "input_required"
    result = cli_cloud("--json", "cv", "review", variant["id"], "--approve")
    assert result.code == 0, result.stdout
    data = result.json["data"]
    assert data["decided"] is True
    assert data["cv_variant"]["status"] == "approved"
    assert Path(data["pdf"]).read_bytes() == PDF
    other = cloud.add_cv_variant(app["id"], status="draft")
    rejected = cli_cloud("--json", "cv", "review", other["id"], "--reject", "--reason", "too long")
    assert rejected.json["data"]["cv_variant"]["status"] == "rejected"


def test_TCMD_CV_render_uses_a_ticket(
    cli_cloud: Cli, cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    variant = cloud.add_cv_variant(None, status="generating", with_file=False)
    urls: list[str] = []

    async def render(url: str, *, timeout_s: float = 60) -> dict[str, Any]:
        urls.append(url)
        return {"status": "done", "file_id": "fil_01JA6V8M3W8Z1T6Q4Y2B7K9C09", "sha256": "0" * 64}

    monkeypatch.setattr("pilih_jobs.browser.headless.render_cv_page", render)
    result = cli_cloud("--json", "cv", "render", variant["id"])
    assert result.code == 0, result.stdout
    assert result.json["data"]["file_id"] == "fil_01JA6V8M3W8Z1T6Q4Y2B7K9C09"
    assert cloud.render_tickets
    assert cloud.render_tickets[0] in urls[0]
