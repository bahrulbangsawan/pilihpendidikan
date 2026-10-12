## ADDED Requirements

### Requirement: Service status config
The hub SHALL derive every status-dependent output (service cards, the MCP
item, JSON-LD and `llms.txt`) from one typed config that maps each of `cv`,
`invoice`, `portfolio` and `api` to `{ status: "soon" | "live", url }`.

#### Scenario: Going live is one line
- **WHEN** `SERVICES.cv.status` changes from `"soon"` to `"live"` and the hub is rebuilt
- **THEN** the CV card, JSON-LD and `llms.txt` all show the CV builder as available, and nothing else in the source needed to change

### Requirement: No links to undeployed services
The hub SHALL render a service whose status is `soon` with a "Coming soon"
label and no link to its URL, and SHALL render a service whose status is
`live` with an "Open" link to its URL (its `/id` page on the Indonesian
hub page).

#### Scenario: Soon service
- **WHEN** a service's status is `soon`
- **THEN** its card shows "Coming soon" (or the Indonesian equivalent) and the page contains no `href` pointing at that service's URL

#### Scenario: Live service
- **WHEN** a service's status is `live`
- **THEN** the page contains exactly one link to that service's host, whose `href` is the service URL on `/` and the service URL plus `/id` on `/id`

#### Scenario: Test guard
- **WHEN** a change makes a `soon` service render a link, or a `live` service render none
- **THEN** the Vitest suite for `apps/home` fails

### Requirement: MCP mention gated on the api
The hub SHALL describe using the tools from an AI assistant over MCP, and
SHALL show the MCP endpoint and a link to the token page only while
`SERVICES.api.status` is `live`.

#### Scenario: Api not deployed
- **WHEN** `SERVICES.api.status` is `soon`
- **THEN** the MCP item shows "Coming soon" and neither the `/mcp` endpoint nor a link to `api.pilihpendidikan.com` appears on the page

#### Scenario: Api live
- **WHEN** `SERVICES.api.status` is `live`
- **THEN** the MCP item shows `https://api.pilihpendidikan.com/mcp` and links to `https://api.pilihpendidikan.com/connect`

### Requirement: Honest, form-free content
The hub SHALL explain Pilih Pendidikan in one or two sentences that state only
facts true of the code, SHALL mark owner-only copy as `[PLACEHOLDER: …]` and
not ship it, and SHALL contain no forms, inputs or email capture.

#### Scenario: Placeholder left in the copy
- **WHEN** a locale file contains `[PLACEHOLDER`
- **THEN** the Vitest suite for `apps/home` fails

#### Scenario: No forms
- **WHEN** either locale of the page is rendered
- **THEN** the HTML contains no `<form>`, `<input>` or `mailto:` capture

### Requirement: Bilingual pages
The hub SHALL serve English at `/` and Indonesian at `/id`, each with its own
title, description, canonical URL, hreflang alternates (`en`, `id`,
`x-default` → `/`) and a link to the other language.

#### Scenario: Indonesian page
- **WHEN** a visitor opens `https://pilihpendidikan.com/id`
- **THEN** the copy is Indonesian, `<html lang="id">` is set and the canonical URL is `https://pilihpendidikan.com/id`

### Requirement: Apex host and www redirect
The hub Worker SHALL serve `pilihpendidikan.com` and SHALL answer requests to
`www.pilihpendidikan.com` with a 301 to the same path and query on the apex.

#### Scenario: www request
- **WHEN** a client requests `https://www.pilihpendidikan.com/id?x=1`
- **THEN** the response is `301` with `Location: https://pilihpendidikan.com/id?x=1`

### Requirement: Crawler and agent discovery files
The hub SHALL serve `robots.txt` and `sitemap.xml` naming only apex URLs, and
`llms.txt` that lists only services whose status is `live`.

#### Scenario: llms.txt before launch
- **WHEN** every service is `soon`
- **THEN** `/llms.txt` describes the hub and names no subdomain URL

#### Scenario: llms.txt after one launch
- **WHEN** only `cv` is `live`
- **THEN** `/llms.txt` links `https://cv.pilihpendidikan.com` and names no other subdomain URL

### Requirement: Security headers
Every hub response SHALL carry `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
a `Content-Security-Policy` containing `frame-ancestors 'none'`,
`Permissions-Policy` and `Strict-Transport-Security: max-age=31536000`.

#### Scenario: Page response
- **WHEN** `GET /` is served
- **THEN** the response carries all six headers

### Requirement: Design system and typography gates
The hub SHALL use the shared Zedative theme (`@rulisme/ui/styles/theme.css`)
and `@rulisme/ui`, and SHALL be covered by `lint:typography`,
`parity:typography` and `parity:twmerge` (see `update-zedative-design-system`).

#### Scenario: Token drift
- **WHEN** `apps/home/src/styles.css` declares a token of its own or stops importing the shared theme
- **THEN** `bun run parity:typography` fails
