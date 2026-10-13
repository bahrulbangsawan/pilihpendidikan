"""Browser-test fixtures: the fixture ATS server (session) and a fresh state per test."""

from tests.browser.support import ats, fixture_ats

__all__ = ["ats", "fixture_ats"]
