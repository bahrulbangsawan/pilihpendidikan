# ruff: noqa
# A deliberately forbidden module: the positive control of the T15-POLICY AST scan.
# It is never imported; `tests/discovery/test_policy.py` parses it and expects every
# construct below to be reported (D-16, 15 §13).
import importlib

import patchright
from scrapling.fetchers import StealthyFetcher
from scrapling.fetchers.stealth_chrome import AsyncStealthySession
from scrapling.engines.toolbelt import ProxyRotator
import scrapling.cli


def fetch(fetchers, url):
    session = getattr(fetchers, "StealthySession")
    mcp = importlib.import_module("scrapling.mcp")
    rotator = fetchers.ProxyRotator(["http://proxy:8080"])
    return StealthyFetcher.fetch(url, solve_cloudflare=True, hide_canvas=True, block_webrtc=True)
