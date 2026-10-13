"""The source adapter registry (15 §14).

Registration is static — the `ADAPTERS` dict below; there is no third-party plugin
loading in v1. The registry is the single place that maps `source_kind` (04
`job_postings.source_kind`) to adapter ids, and it refuses the excluded sources (LinkedIn,
Indeed; D-17) and adapters whose `min_cli_version` exceeds this CLI — before any request.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Final

from pilih_jobs.adapters.ashby import AshbyAdapter
from pilih_jobs.adapters.base import AdapterContext, SourceAdapter
from pilih_jobs.adapters.career_page import CareerPageAdapter
from pilih_jobs.adapters.custom_url import CustomUrlAdapter
from pilih_jobs.adapters.generic_listing import GenericListingAdapter
from pilih_jobs.adapters.greenhouse import GreenhouseAdapter
from pilih_jobs.adapters.lever import LeverAdapter
from pilih_jobs.adapters.smartrecruiters import SmartRecruitersAdapter
from pilih_jobs.adapters.workable import WorkableAdapter
from pilih_jobs.adapters.workday import WorkdayAdapter
from pilih_jobs.contracts.adapters import excluded_sources, usable_adapter
from pilih_jobs.discovery.errors import ExcludedSourceError, PolicyViolation
from pilih_jobs.errors import UsageError
from pilih_jobs.version import __version__

ADAPTERS: Final[dict[str, Callable[[], SourceAdapter]]] = {
    "greenhouse": GreenhouseAdapter,
    "lever": LeverAdapter,
    "ashby": AshbyAdapter,
    "smartrecruiters": SmartRecruitersAdapter,
    "workable": WorkableAdapter,
    "workday": WorkdayAdapter,
    "career_page": CareerPageAdapter,
    "generic_listing": GenericListingAdapter,
    "custom_url": CustomUrlAdapter,
}

__all__ = ["ADAPTERS", "AdapterContext", "SourceAdapter", "get_adapter", "refuse_excluded"]


def refuse_excluded(adapter_id: str) -> None:
    """Raise `ExcludedSourceError` for LinkedIn / Indeed (D-17)."""
    for excluded in excluded_sources():
        if str(excluded.id) == adapter_id.lower():
            raise ExcludedSourceError(
                f"{excluded.display_name} is excluded from discovery (D-17): {excluded.reason}",
                details={"source": adapter_id.lower()},
                hint="Track the job manually by title and company instead.",
            )


def get_adapter(adapter_id: str) -> SourceAdapter:
    """The adapter for `adapter_id`; refuses excluded, unknown and too-new adapters."""
    refuse_excluded(adapter_id)
    factory = ADAPTERS.get(adapter_id)
    if factory is None:
        raise UsageError(
            f"Unknown adapter {adapter_id!r}; known adapters: {', '.join(sorted(ADAPTERS))}."
        )
    if usable_adapter(adapter_id, __version__) is None:
        raise PolicyViolation(
            f"The {adapter_id} adapter needs a newer pilih-jobs; run `pilih-jobs update`.",
            details={"adapter": adapter_id},
        )
    return factory()
