"""The fixture ATS server of the CLI tests (`apps/jobs-cli/tests/fixtures/ats_server`, 13 §4.1)
for the e2e suite, plus a few e2e-only routes.

Started by `e2e/harness/ats.ts` with `uv run --project apps/jobs-cli python …`. Prints
`{"port": N}` once listening and serves until killed. Additions:

- `/e2e/<id>/apply` → POST `/e2e/<id>/submit` → `/e2e/<id>/confirmation`: one Greenhouse-like
  form per id (contact fields and country, no file input), so each task of a scenario has its
  own submission counter. `/cv/<id>/…` is the same form with a required PDF resume.
- Holds: while the flag `hold:<path>` is set, a request to `<path>` waits (the test kills the
  CLI "after the click, before the result" at a precise moment). `hits` are recorded before
  the handler runs, so a held submit is already visible.
- `/jobs/golden`: a careers page with a JSON-LD JobPosting pointing at `/cv/1/apply`.
- `/human/apply`: the same form; the page presses Submit itself once the `human_click` flag
  is set (the user of assisted mode).
- Control (any host): `POST /__e2e/flags` merges JSON into the flags (`GET` reads them),
  `GET /__e2e/hits` lists the recorded requests (control routes excluded), `POST
  /__e2e/reset` clears both.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
import time
from pathlib import Path

CLI_DIR = Path(__file__).resolve().parents[2] / "apps" / "jobs-cli"
sys.path.insert(0, str(CLI_DIR))

from starlette.responses import JSONResponse, RedirectResponse, Response  # noqa: E402
from tests.fixtures.ats_server.app_handlers import all_handlers  # noqa: E402
from tests.fixtures.ats_server.pages import (  # noqa: E402
    confirmation,
    contact_fields,
    country_field,
    missing,
    resume_field,
)
from tests.fixtures.ats_server.server import (  # noqa: E402
    FixtureServer,
    Handler,
    PageCtx,
    html,
)

HOLD_POLL_S = 0.05


async def hold(ctx: PageCtx) -> None:
    key = f"hold:{ctx.request.url.path}"
    # The flag is set and cleared by another request (`/__e2e/flags`): poll it.
    while ctx.state.flags.get(key):  # noqa: ASYNC110 - flags are plain shared state
        await asyncio.sleep(HOLD_POLL_S)


def form_page(prefix: str, *, resume_required: bool, title: str) -> str:
    resume = resume_field(required=True) if resume_required else ""
    return f"""
<main>
<h1>{title}</h1>
<form id="application_form" action="/{prefix}/submit" method="post" enctype="multipart/form-data">
<h2>Contact information</h2>
{contact_fields()}
{resume}
{country_field()}
<button type="submit" id="submit_app">Submit application</button>
</form>
</main>
"""


def e2e_flow(prefix: str, *, resume_required: bool) -> dict[str, Handler]:
    title = "Software Engineer — Acme"

    async def apply(ctx: PageCtx) -> Response:
        await hold(ctx)
        return html(form_page(prefix, resume_required=resume_required, title=title))

    async def submit(ctx: PageCtx) -> Response:
        await hold(ctx)
        files = ("resume",) if resume_required else ()
        if missing(ctx, files=files):
            return html(form_page(prefix, resume_required=resume_required, title=title), status=422)
        return RedirectResponse(f"/{prefix}/confirmation", status_code=303)

    async def done(ctx: PageCtx) -> Response:
        await hold(ctx)
        return html(confirmation(), title="Application submitted")

    return {
        f"/{prefix}/apply": apply,
        f"/{prefix}/submit": submit,
        f"/{prefix}/confirmation": done,
    }


ASSIST_SCRIPT = """
<script>
setInterval(async () => {
  const r = await fetch('/__e2e/flags'); const j = await r.json();
  if (j.flags && j.flags.human_click && !window.__clicked) {
    window.__clicked = true; document.getElementById('submit_app').click();
  }
}, 150);
</script>"""


def assisted_flow() -> dict[str, Handler]:
    """`/human/apply`: the form of `e2e_flow` whose page presses Submit itself once the test
    sets the `human_click` flag — the human in assisted mode (13 §5 S-13)."""
    handlers = e2e_flow("human", resume_required=False)
    form = handlers["/human/apply"]

    async def apply(ctx: PageCtx) -> Response:
        page = await form(ctx)
        body = bytes(page.body).decode("utf-8").replace("</body>", ASSIST_SCRIPT + "</body>")
        return html_raw(body)

    handlers["/human/apply"] = apply
    return handlers


def html_raw(page: str) -> Response:
    from starlette.responses import HTMLResponse

    return HTMLResponse(page)


def job_page_flow() -> dict[str, Handler]:
    """`/jobs/golden`: a careers page with a schema.org JobPosting (JSON-LD) whose `url` is the
    fixture's Greenhouse-like form with a required resume (`/cv/1/apply`) — what
    `pilih-jobs discover --url` reads in the golden path (13 §5 S-12)."""

    async def page(ctx: PageCtx) -> Response:
        posting = {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "Senior Backend Engineer (Payments)",
            "description": (
                "<p>Build and run the payments platform at Acme. You design reliable services in "
                "TypeScript and Python, own their operations, and work with product on new "
                "payment methods across Southeast Asia.</p><ul><li>5+ years building backend "
                "services</li><li>TypeScript, Python, PostgreSQL</li><li>On-call experience"
                "</li></ul>"
            ),
            "datePosted": "2026-10-01",
            "employmentType": "FULL_TIME",
            "hiringOrganization": {
                "@type": "Organization",
                "name": "Acme",
                "sameAs": "https://www.acme-payments.test",
            },
            "jobLocation": {
                "@type": "Place",
                "address": {
                    "@type": "PostalAddress",
                    "addressLocality": "Jakarta",
                    "addressCountry": "ID",
                },
            },
            "url": f"http://127.0.0.1:{ctx.port}/cv/1/apply",
        }
        head = f'<script type="application/ld+json">{json.dumps(posting)}</script>'
        body = (
            "<main><h1>Senior Backend Engineer (Payments)</h1><p>Acme — Jakarta</p>"
            '<a href="/cv/1/apply">Apply now</a></main>'
        )
        return html(body, title="Senior Backend Engineer (Payments) — Acme", head=head)

    return {"/jobs/golden": page}


def control_handlers() -> dict[str, Handler]:
    async def flags(ctx: PageCtx) -> Response:
        if ctx.request.method == "GET":
            with ctx.state.lock:
                return JSONResponse({"flags": dict(ctx.state.flags)})
        body = json.loads(ctx.value("_body") or "{}")
        with ctx.state.lock:
            for key, value in body.items():
                if value is None:
                    ctx.state.flags.pop(key, None)
                else:
                    ctx.state.flags[key] = value
        return JSONResponse({"flags": dict(ctx.state.flags)})

    async def hits(ctx: PageCtx) -> Response:
        with ctx.state.lock:
            rows = [
                {
                    "method": h.method,
                    "host": h.host,
                    "path": h.path,
                    "query": h.query,
                    "form": h.form,
                    "files": h.files,
                    "at": h.at,
                }
                for h in ctx.state.hits
                if not h.path.startswith("/__e2e/")
            ]
        # `at` is the server's monotonic clock; `mono` / `wall` convert it to epoch time.
        return JSONResponse({"hits": rows, "mono": time.monotonic(), "wall": time.time()})

    async def reset(ctx: PageCtx) -> Response:
        ctx.state.reset()
        return JSONResponse({"ok": True})

    return {"/__e2e/flags": flags, "/__e2e/hits": hits, "/__e2e/reset": reset}


def main() -> None:
    handlers = all_handlers()
    for n in range(1, 81):
        handlers.update(e2e_flow(f"e2e/{n}", resume_required=False))
        handlers.update(e2e_flow(f"cv/{n}", resume_required=True))
    handlers.update(assisted_flow())
    handlers.update(job_page_flow())
    handlers.update(control_handlers())
    server = FixtureServer(handlers).start()
    sys.stdout.write(json.dumps({"port": server.port}) + "\n")
    sys.stdout.flush()
    stop = threading.Event()
    try:
        # Serve until the parent closes stdin or kills the process group.
        for _line in sys.stdin:
            pass
    finally:
        stop.set()
        server.stop()


if __name__ == "__main__":
    main()
