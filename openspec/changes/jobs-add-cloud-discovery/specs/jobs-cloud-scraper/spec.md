## ADDED Requirements

### Requirement: Scraper runtime
The project SHALL provide `apps/jobs-scraper`, a Worker with no public route that forwards `/healthz` and `/v1/scrape`, `/v1/probe`, `/v1/directory` to a Cloudflare Container running a Python service, choosing the container instance by a hash of the source's domain. (Source: 24 §1, §3)

#### Scenario: Unknown path
- **WHEN** any other path reaches the scraper Worker
- **THEN** it answers 404

### Requirement: Scrapling under the discovery rules
Every fetch of the scraper SHALL go through the CLI's `ScraplingJobEngine` (honest User-Agent, robots.txt, politeness, retry policy, challenge detection, forbidden-feature guard) and SHALL never use stealth fetchers, proxies, CAPTCHA solving or logins. (Source: 15, D-16, D-37)

#### Scenario: Robots disallow
- **WHEN** robots.txt disallows the listing for the pilih-jobs User-Agent
- **THEN** the scrape answers `robots_disallowed` without fetching the listing

### Requirement: SSRF protection
The scraper SHALL fetch only http(s) URLs on default ports without userinfo whose host resolves only to public unicast addresses, SHALL refuse redirects to private addresses and re-check the final URL after the response, and SHALL enforce timeouts, body size, page and detail caps and the request deadline. (Source: 24 §8)

#### Scenario: Metadata endpoint
- **WHEN** a strategy URL resolves to 169.254.169.254 or a private range
- **THEN** no request is sent and the answer carries a `policy_blocked` error

### Requirement: Strategies and normalization
The scraper SHALL implement the `json_api`, `rss`, `json_ld`, `embedded_json`, `html_selectors` (with Scrapling adaptive relocation), opt-in `browser` and `ai` strategies, and SHALL return items as `CloudPostingItem`s whose fingerprint and content hash match the shared contract vectors, with provenance, confidence and data-quality warnings. (Source: 24 §4)

#### Scenario: Feed company prefix
- **WHEN** an RSS item titled "Acme: Backend Engineer" is read with `title_pattern: company_title`
- **THEN** the item's company is "Acme" and its title "Backend Engineer"
