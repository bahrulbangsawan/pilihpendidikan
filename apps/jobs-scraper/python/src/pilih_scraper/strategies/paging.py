"""Listing pagination with a checkpoint (24 §6.4): `resume_url` / `resume_page`.

A run stops paging at `max_pages`, at the deadline or when `max_items` is reached and
stores the next page in the cursor; the next run starts there. Only a run that read
every page from the first one is `complete` (absences count only then, 15 §9).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from pilih_jobs.discovery.types import FetchMode, FetchResult

from pilih_scraper import fetching
from pilih_scraper.strategies.base import ScrapeJob


class Paging:
    def __init__(
        self,
        job: ScrapeJob,
        start_url: str,
        mode: FetchMode,
        *,
        next_css: str | None,
        wait_selector: str | None = None,
    ) -> None:
        self.job = job
        self.start_url = start_url
        self.mode = mode
        self.next_css = next_css
        self.wait_selector = wait_selector
        resume = job.cursor_in.get("resume_url")
        self.resumed = isinstance(resume, str) and resume != start_url and job.same_site(resume)
        self.first_url: str = resume if self.resumed and isinstance(resume, str) else start_url
        page = job.cursor_in.get("resume_page")
        self.page_no = int(page) if self.resumed and isinstance(page, int) else 0
        self.finished = False

    @property
    def complete(self) -> bool:
        return self.finished and not self.resumed

    def _next_url(self, result: FetchResult) -> str | None:
        if not self.next_css:
            return None
        page = fetching.as_page(result)
        if page is None:
            return None
        links = page.links(fetching.split_pseudo(self.next_css)[0])
        for link in links:
            if link != result.url and self.job.same_site(link):
                return link
        return None

    async def pages(self) -> AsyncIterator[tuple[str, FetchResult]]:
        job = self.job
        if self.resumed:
            job.ctx.add_log(
                "info",
                "checkpoint_resume",
                f"Resuming at listing page {self.page_no + 1}",
                url=self.first_url,
            )
        url = self.first_url
        fetched = 0
        while True:
            result = await job.engine.fetch_listing(
                fetching.request(url, self.mode, wait_selector=self.wait_selector),
                source=job.ref,
                first_page=fetched == 0 and not self.resumed,
            )
            job.note_page(result)
            yield url, result
            fetched += 1
            self.page_no += 1
            following = self._next_url(result)
            if following is None:
                self.finished = True
                job.cursor_out["resume_url"] = None
                job.cursor_out["resume_page"] = 0
                return
            if fetched >= job.limits.max_pages or job.ctx.out_of_time() or job.full():
                job.cursor_out["resume_url"] = following
                job.cursor_out["resume_page"] = min(self.page_no, 100)
                job.ctx.add_log(
                    "info",
                    "checkpoint_saved",
                    f"Stopped after {fetched} page(s); the next run resumes at page "
                    f"{self.page_no + 1}",
                    url=following,
                )
                return
            url = following


class RenderedPage:
    """The one listing page the scraper Worker rendered (24 §4.4).

    It goes through `engine.accept_rendered` (robots, SSRF guard, challenge and
    login-wall classification, parser). A rendered listing only shows the newest
    jobs, so the run is never `complete`: absences must not close postings that
    merely scrolled off the first screen (their JSON-LD `validThrough` does).
    """

    complete = False

    def __init__(self, job: ScrapeJob, prefetched: dict[str, object]) -> None:
        self.job = job
        self.prefetched = prefetched

    async def pages(self) -> AsyncIterator[tuple[str, FetchResult]]:
        job = self.job
        pre = self.prefetched
        url = str(pre["url"])
        status = pre["status"]
        blocked = pre.get("blocked_requests", 0)
        result = await job.engine.accept_rendered(
            fetching.request(url, FetchMode.STATIC_HTML),
            final_url=str(pre["final_url"]),
            status=status if isinstance(status, int) else 200,
            html=str(pre["html"]),
            source=job.ref,
        )
        job.note_page(result)
        job.ctx.add_log(
            "info",
            "page_rendered",
            f"Listing rendered by Cloudflare Browser Rendering ({blocked} robots-disallowed, "
            "tracker or media requests blocked)",
            url=result.url,
            http_status=result.status,
        )
        job.cursor_out["resume_url"] = None
        job.cursor_out["resume_page"] = 0
        yield url, result
