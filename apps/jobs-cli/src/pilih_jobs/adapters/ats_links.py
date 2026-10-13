"""Known ATS board URLs → the ATS adapter and its config (15 §14.3 career_page redirect).

`https://boards.greenhouse.io/acme` becomes `greenhouse{board_token: acme}`; the same for
Lever, Ashby, SmartRecruiters and Workable boards (and Greenhouse embeds). Workday hosts
are recognised but never redirected to: a tenant needs its own opt-in (D-17, 15 §14.3).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlsplit

_GREENHOUSE_HOSTS = (
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "job-boards.eu.greenhouse.io",
)
_RESERVED_SEGMENTS = frozenset({"embed", "v1", "api", "jobs", "j", "careers", "widget"})


@dataclass(frozen=True)
class AtsTarget:
    adapter_id: str
    config: dict[str, Any]
    opt_in_required: bool = False


def _first_segment(path: str) -> str | None:
    for segment in path.split("/"):
        if segment:
            return segment
    return None


def ats_target(url: str) -> AtsTarget | None:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    first = _first_segment(parts.path)
    if host in _GREENHOUSE_HOSTS:
        if first == "embed":
            token = (parse_qs(parts.query).get("for") or [None])[0]
            return AtsTarget("greenhouse", {"board_token": token}) if token else None
        return AtsTarget("greenhouse", {"board_token": first}) if first else None
    if host in ("jobs.lever.co", "jobs.eu.lever.co") and first:
        config: dict[str, Any] = {"site": first}
        if host == "jobs.eu.lever.co":
            config["region"] = "eu"
        return AtsTarget("lever", config)
    if host == "jobs.ashbyhq.com" and first:
        return AtsTarget("ashby", {"job_board_name": first})
    if host in ("jobs.smartrecruiters.com", "careers.smartrecruiters.com") and first:
        return AtsTarget("smartrecruiters", {"company_identifier": first})
    if host == "apply.workable.com" and first and first not in _RESERVED_SEGMENTS:
        return AtsTarget("workable", {"subdomain": first})
    if host.endswith(".workable.com") and host not in ("apply.workable.com", "www.workable.com"):
        return AtsTarget("workable", {"subdomain": host.split(".", 1)[0]})
    if host.endswith((".myworkdayjobs.com", ".myworkdaysite.com")):
        return AtsTarget("workday", {}, opt_in_required=True)
    return None
