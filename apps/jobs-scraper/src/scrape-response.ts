// A contract-shaped failed `ScrapeResponse` built by the Worker when a
// Browser Rendering scrape stops before the container sees it (preflight
// refused, render failed, page too large), job-tracker-spec/24 §3.

export interface WorkerError {
  error_class: string;
  http_status?: number | null;
  message: string;
  url?: string | null;
}

export function failedScrape(
  body: unknown,
  error: WorkerError,
  elapsedMs: number,
  now: number = Date.now()
): Record<string, unknown> {
  const cursor =
    typeof body === "object" && body !== null
      ? ((body as { cursor_state?: unknown }).cursor_state ?? {})
      : {};
  return {
    v: 1,
    outcome: "failed",
    complete: false,
    items: [],
    ai_candidates: [],
    cursor_state: cursor,
    stats: {
      pages: 0,
      postings_found: 0,
      duplicates: 0,
      invalid: 0,
      relocated: 0,
      robots_skipped: error.error_class === "robots_disallowed" ? 1 : 0,
      details_fetched: 0,
      elapsed_ms: Math.max(0, Math.round(elapsedMs)),
      fetch_mode: "browser",
    },
    error: {
      error_class: error.error_class,
      message: error.message.slice(0, 500),
      http_status: error.http_status ?? null,
      url: error.url ?? null,
    },
    warnings: [],
    log: [
      {
        at: now,
        level: "error",
        event: "render_stopped",
        message: `Browser Rendering: ${error.message}`.slice(0, 500),
        ...(error.url ? { url: error.url.slice(0, 2048) } : {}),
      },
    ],
    engine: { scraper: "worker-browser-rendering" },
  };
}
