"""`pilih-scraper serve` — run the service (container: 0.0.0.0:8080; dev: 127.0.0.1:8791)."""

from __future__ import annotations

import argparse
import logging

import uvicorn

from pilih_scraper import __version__, logs
from pilih_scraper.app import create_app


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="pilih-scraper", description=__doc__)
    parser.add_argument("--version", action="version", version=f"pilih-scraper {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Run the HTTP service")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8791)
    serve.add_argument("--log-level", default="info", choices=["debug", "info", "warning"])
    args = parser.parse_args(argv)
    level = getattr(logging, str(args.log_level).upper())
    logs.configure(level)
    uvicorn.run(
        create_app(),
        host=str(args.host),
        port=int(args.port),
        log_config=None,
        access_log=False,
        timeout_graceful_shutdown=10,
    )


if __name__ == "__main__":
    main()
