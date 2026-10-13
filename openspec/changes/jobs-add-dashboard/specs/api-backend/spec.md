## MODIFIED Requirements

### Requirement: Document storage and ownership
The api Worker SHALL store CV, invoice and portfolio documents under the
same keys the old backend used and SHALL let only the owner (or an
`ADMIN_EMAILS` admin) change or delete such a document. Job documents SHALL
be served through the legacy jobs facade from `JOBS_KV` or `JOBS_DB`
(selected by `JOBS_LEGACY_BACKEND`), every `/api/jobs` method MUST require
authentication, a missing or not-owned job MUST be answered 404, and admins
MUST get no bypass on jobs: `?mine=0` is ignored for `/api/jobs` (BREAKING
for admin tooling). (Source: 05 §14; 06 §12.6; 11 §6; D-04, D-26)

#### Scenario: Owner saves a CV
- **WHEN** the owner sends `PUT /api/cv/<id>` with a write-scoped token and a valid CV body
- **THEN** the response is 200 `{ok: true, id, data}` and `cv:<id>` holds the new document

#### Scenario: Someone else tries to save it
- **WHEN** another signed-in user sends the same `PUT`
- **THEN** the response is 403 and the document is unchanged

#### Scenario: No credential
- **WHEN** a `PUT`, `DELETE` or list request carries no valid token
- **THEN** the response is 401 with a `WWW-Authenticate: Bearer` header

#### Scenario: Read-only token
- **WHEN** a read-scoped token sends a write
- **THEN** the response is 403 `{"error": "insufficient_scope"}`

#### Scenario: Public read
- **WHEN** anyone requests `GET /api/cv/<id>` (or `.json`) for an existing public document
- **THEN** the document JSON is returned with `Cache-Control: no-store`

#### Scenario: Another user's job
- **WHEN** a signed-in user requests `GET /api/jobs/<id>` for a job owned by someone else
- **THEN** the response is 404, exactly as for a job that does not exist

#### Scenario: Admin lists jobs
- **WHEN** an `ADMIN_EMAILS` admin requests `GET /api/jobs?mine=0`
- **THEN** only the admin's own jobs are returned

### Requirement: MCP server
The api Worker SHALL serve MCP at `/mcp` and `/sse` to any signed-in caller
with every `cv_*`, `invoice_*`, `portfolio_*` and `jobs_*` tool and the
48 legacy aliases, scoped to the caller's own documents. The jobs family
SHALL comprise the 11 legacy tracker tools plus `jobs_board`, `jobs_move`,
`jobs_note_add`, `jobs_interview_add`, `jobs_offer_add`,
`jobs_approvals_list` and `jobs_approval_decide`; MCP MUST NOT expose any
purge, task-creation or rule tool, and `jobs_approval_decide` MUST work only
when `user_settings.allow_mcp_approvals = 1` and only for `answer` and
`cv_variant` approvals, never `submit` or `rule_activation`. (Source: 05 §14;
06 §11; 11 §5)

#### Scenario: Tool list
- **WHEN** a write-scoped caller lists tools
- **THEN** 89 tools are listed (cv 30, invoice 22, portfolio 19, jobs 18) and no legacy alias name appears

#### Scenario: Legacy name
- **WHEN** a client calls `get_cv`
- **THEN** it runs `cv_get`

#### Scenario: Read-only token
- **WHEN** a read-scoped caller lists tools
- **THEN** only the 18 read-only tools are listed, including `jobs_board` and `jobs_approvals_list`

#### Scenario: Unauthenticated
- **WHEN** `/mcp` is called without a credential
- **THEN** the response is 401 with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`

#### Scenario: Session replay with another account
- **WHEN** a live session id is presented with a different account's token
- **THEN** the request is refused with 404 "Session not found"

#### Scenario: MCP decides a submit approval
- **WHEN** an MCP client calls `jobs_approval_decide` for a `submit` approval
- **THEN** the tool refuses and the approval stays pending

### Requirement: CORS
The api Worker SHALL allow credentialed cross-origin requests only from the
four app origins (`cv.`, `invoice.`, `portfolio.` and
`jobs.pilihpendidikan.com`), and from their localhost ports (4003, 4004,
4005, 4007) only while it runs locally; the same origin table SHALL be the
magic-link `returnTo` allowlist. (Source: 05 §1.8; 12 §1.1)

#### Scenario: App preflight
- **WHEN** `https://cv.pilihpendidikan.com` sends a preflight
- **THEN** the response echoes that origin with `Access-Control-Allow-Credentials: true`

#### Scenario: Jobs dashboard sign-in
- **WHEN** a sign-in request names `returnTo` = `https://jobs.pilihpendidikan.com`
- **THEN** the return target is accepted

#### Scenario: Foreign origin
- **WHEN** any other origin sends a preflight to production
- **THEN** no `Access-Control-Allow-Origin` header is returned

#### Scenario: Local jobs port in production
- **WHEN** `http://localhost:4007` sends a preflight to the production Worker
- **THEN** no `Access-Control-Allow-Origin` header is returned

## ADDED Requirements

### Requirement: Legacy jobs facade over D1
The api Worker SHALL serve `/api/jobs[/:id]` and the MCP `jobs_*` tools with their legacy request and response shapes from either `JOBS_KV` or `JOBS_DB`, chosen per call by the `JOBS_LEGACY_BACKEND` flag (`kv` | `d1`, default `kv`); on `d1` it MUST map stages to legacy statuses (`preparing`/`ready` → `saved`, `withdrawn` → `rejected`), route status writes through the stage service so an illegal transition answers 422 `Invalid status`, reject a `PUT` with 409 when the application changed from another source in the last 5 s, list beyond 1,000 jobs, accept `follow_up_at` on `jobs_update`, fork a private copy instead of editing a shared public posting, and on a D1 miss for a legacy id fall back to a KV read that migrates that one job. (Source: 06 §12.5, §12.6; 05 §14; D-04, D-33)

#### Scenario: Cut-over without client changes
- **WHEN** `JOBS_LEGACY_BACKEND` is flipped from `kv` to `d1`
- **THEN** the existing `/api/jobs` and MCP `jobs_*` test suites pass unchanged against D1

#### Scenario: Illegal legacy status
- **WHEN** a legacy client changes a job's status from `accepted` to `saved`
- **THEN** the response is 422 with the text `Invalid status`

#### Scenario: Stale legacy write
- **WHEN** a legacy `PUT` arrives within 5 s of a change made from the dashboard
- **THEN** the response is 409 and the application is unchanged

#### Scenario: Grace-period fallback
- **WHEN** the backend is `d1` and a legacy id exists only in `JOBS_KV`
- **THEN** the job is read from KV, migrated to D1 and returned

