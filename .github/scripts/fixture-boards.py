"""Serve the recorded Greenhouse / Lever / Ashby board responses on loopback.

CI-only helper for `.github/workflows/cli-matrix.yml` and `release-cli.yml`
(22 §9 "discover against fixture server"). It serves the fixtures the CLI's
adapter tests use (`apps/jobs-cli/tests/fixtures/discovery`), with the same
routes as `e2e/harness/boards.ts`, so an *installed* `pilih-jobs` wheel can run
`discover --dry-run` without touching the internet:

    python .github/scripts/fixture-boards.py --port-file port.txt &
    PILIH_JOBS_ENV=test \
    PILIH_JOBS_TEST_BASE_URLS='{"greenhouse":"http://127.0.0.1:<port>", …}' \
    pilih-jobs --json discover --source greenhouse:acme --dry-run

Standard library only; binds 127.0.0.1 on an OS-assigned port (written to
`--port-file`) unless `--port` is given.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "apps" / "jobs-cli" / "tests" / "fixtures" / "discovery"

GREENHOUSE_BOARD = "acme"
LEVER_SITE = "acme"
ASHBY_BOARD = "ramp-id"


def _load(name: str) -> object:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


GREENHOUSE = _load("greenhouse/board.json")
LEVER = [*_load("lever/page1.json"), *_load("lever/page2.json")]  # type: ignore[misc]
ASHBY = _load("ashby/board.json")

GH_LIST = f"/v1/boards/{GREENHOUSE_BOARD}/jobs"
GH_DETAIL = re.compile(rf"^/v1/boards/{GREENHOUSE_BOARD}/jobs/(\d+)$")
LEVER_LIST = f"/v0/postings/{LEVER_SITE}"
LEVER_DETAIL = re.compile(rf"^/v0/postings/{LEVER_SITE}/([\w-]+)$")
ASHBY_LIST = f"/posting-api/job-board/{ASHBY_BOARD}"


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data: object) -> None:
        self._send(200, json.dumps(data).encode("utf-8"), "application/json")

    def _not_found(self) -> None:
        self._send(404, b"not found", "text/plain")

    def _detail(self, job: object | None) -> None:
        if job is None:
            self._not_found()
        else:
            self._json(job)

    def do_GET(self) -> None:
        url = urlsplit(self.path)
        path = url.path
        if path == "/robots.txt":
            self._send(200, b"User-agent: *\nAllow: /\n", "text/plain")
            return
        if path == GH_LIST:
            self._json(GREENHOUSE)
            return
        if match := GH_DETAIL.match(path):
            jobs = GREENHOUSE["jobs"]  # type: ignore[index]
            self._detail(next((j for j in jobs if str(j["id"]) == match[1]), None))
            return
        if path == LEVER_LIST:
            query = parse_qs(url.query)
            skip = int(query.get("skip", ["0"])[0])
            limit = int(query.get("limit", ["100"])[0])
            self._json(LEVER[skip : skip + limit])
            return
        if match := LEVER_DETAIL.match(path):
            self._detail(next((j for j in LEVER if j["id"] == match[1]), None))
            return
        if path == ASHBY_LIST:
            self._json(ASHBY)
            return
        self._not_found()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        sys.stderr.write(f"fixture-boards: {format % args}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--port-file", type=Path)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    port = server.server_address[1]
    if args.port_file:
        args.port_file.write_text(str(port), encoding="utf-8")
    sys.stderr.write(f"fixture-boards: serving on http://127.0.0.1:{port}\n")
    server.serve_forever()


if __name__ == "__main__":
    main()
