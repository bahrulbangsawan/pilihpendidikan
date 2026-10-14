"""`pilih_jobs.discovery.engine` — the ONLY package that imports Scrapling (15 §3, D-36).

Importing it installs the forbidden-feature import guard (15 §13 layer 2) before
Scrapling is loaded; `ScraplingJobEngine` then imports Scrapling through the policy's
controlled window and builds every Scrapling call from the kwargs allow-list (layer 3).
"""

from __future__ import annotations

from pilih_jobs.discovery.engine import policy
from pilih_jobs.discovery.engine.engine import RequestRecord, ScraplingJobEngine
from pilih_jobs.discovery.engine.guard import NetworkGuard

policy.install_guard()

__all__ = ["NetworkGuard", "RequestRecord", "ScraplingJobEngine", "policy"]
