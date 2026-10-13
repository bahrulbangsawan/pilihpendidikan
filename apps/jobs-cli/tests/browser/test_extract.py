"""`extract_form.v1.js` over ≥ 40 static fixture forms in real Chromium (18 §13.1)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from pilih_jobs.browser.controller import BrowserController
from pilih_jobs.browser.observer import PageObserver
from pilih_jobs.contracts._generated.agent import PageObservation
from pilih_jobs.contracts.ids import new_id
from pilih_jobs.policy.domains import DomainAllowlist
from tests.fixtures.ats_server import HOST_RESOLVER_RULES, FixtureServer
from tests.fixtures.ats_server.extract_cases import CASES, ExtractCase

pytestmark = pytest.mark.browser


@pytest.fixture
async def observer_for(tmp_path: Path, fixture_ats: FixtureServer) -> AsyncIterator[object]:
    controller = BrowserController(
        data_dir=tmp_path / "data", host_resolver_rules=HOST_RESOLVER_RULES
    )
    await controller.start("managed", "apply-default", None, True, None)

    async def open_case(path: str) -> PageObserver:
        session = await controller.new_session(
            "tsk", DomainAllowlist(["acme-ats.test"]), fixture_ats.url(path)
        )
        await session.page.goto(fixture_ats.url(path))
        await session.settle()
        return PageObserver(session, attempt_id=new_id("att"))

    yield open_case
    await controller.stop("test")


@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
async def test_T18_U_EXTRACT(case: ExtractCase, observer_for: object) -> None:
    observer = await observer_for(f"/extract/{case.name}")  # type: ignore[operator]
    obs = await observer.observe(step=0)
    got = [(f.label, f.kind, f.required) for f in obs.fields]
    assert got == case.fields
    for label, expected in case.options.items():
        field = next(f for f in obs.fields if f.label == label)
        assert [o["label"] for o in field.options] == expected
    controls = {(c.text, c.role_hint) for c in obs.controls}
    for pair in case.controls:
        assert pair in controls, (pair, controls)
    assert len(obs.opaque_regions) == case.opaque
    # Every observation satisfies the contract (19 §3.1).
    PageObservation.model_validate(obs.to_contract())
    for f in obs.fields:
        assert len(f.signature) == 16
        assert f.ref.startswith(("f", "fr"))


async def test_T18_U_EXTRACT_options_capped_at_200(observer_for: object) -> None:
    observer = await observer_for("/extract/many_options")  # type: ignore[operator]
    obs = await observer.observe(step=0)
    assert len(obs.fields[0].options) == 200
    assert len(obs.to_contract()["fields"][0]["options"]) == 200


async def test_T18_U_EXTRACT_ref_stability_across_rerender(observer_for: object) -> None:
    observer = await observer_for("/extract/label_for")  # type: ignore[operator]
    first = await observer.observe(step=0)
    second = await observer.observe(step=1)
    assert [f.ref for f in first.fields] == [f.ref for f in second.fields]
    page = observer.session.page
    # Re-render: replace the element; the old ref vanishes, the signature re-resolves.
    await page.evaluate(
        "() => { const i = document.getElementById('x'); const c = i.cloneNode();"
        " c.removeAttribute('data-pj-ref'); i.replaceWith(c); }"
    )
    new_ref, locator = await observer.resolve(first.fields[0].ref)
    assert new_ref != first.fields[0].ref
    assert await locator.count() == 1


async def test_T18_U_EXTRACT_signature_stable_across_reload(observer_for: object) -> None:
    observer = await observer_for("/extract/select_options")  # type: ignore[operator]
    before = await observer.observe(step=0)
    await observer.session.page.reload()
    after = await observer.observe(step=1)
    assert [f.signature for f in before.fields] == [f.signature for f in after.fields]
    assert before.form_hash == after.form_hash
    # refs are never reused within a page-session
    assert {f.ref for f in before.fields}.isdisjoint({f.ref for f in after.fields})


async def test_T18_U_EXTRACT_spoofed_refs_are_reassigned(observer_for: object) -> None:
    observer = await observer_for("/inj/spoofed_refs/apply")  # type: ignore[operator]
    obs = await observer.observe(step=0)
    refs = [f.ref for f in obs.fields] + [c.ref for c in obs.controls]
    assert len(refs) == len(set(refs))
    withdraw = next(c for c in obs.controls if "Withdraw" in c.text)
    assert withdraw.role_hint == "other"


async def test_T18_U_EXTRACT_aria_snapshot_capped(observer_for: object) -> None:
    observer = await observer_for("/inj/long_label/apply")  # type: ignore[operator]
    obs = await observer.observe(step=0)
    assert len(obs.aria_snapshot) <= 24_576
    assert "<<" not in obs.aria_snapshot
    assert "<<" not in obs.raw_text
