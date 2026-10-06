# Design: apps/api

## Decisions

- **Hand-written router, no framework.** `src/app.ts` dispatches in a fixed
  order (preflight → health → OAuth → MCP → /connect → tokens → auth →
  documents → 404). It takes the MCP handlers as arguments so the full HTTP
  surface runs under `bun test` with fake bindings; `src/index.ts` adds the
  Durable Object.
- **Same document keys as before.** `cv:{id}`, `invoice:{id}`,
  `portfolio:{id}`, `job:{id}` plus owner stamps `owner:cv:`, `owner:inv:`,
  `owner:portfolio:`, `owner:job:`. Lists are scoped from the stamps (the old
  backend used its request log for cv / invoice / portfolio; that log does not
  move). One module (`src/ownership.ts`) answers "who owns this" for REST and
  MCP.
- **Credentials.** Every bearer is 256-bit and stored only as SHA-256.
  Browser sessions: KV (7-day TTL) + a D1 `session` row with the same expiry,
  written before the KV record so sign-out always finds it. OAuth access
  tokens: D1 `session` rows that expire after 90 days (no refresh grant).
  Personal tokens: D1 `personal` rows with `scope` write | read, no expiry
  until revoked.
- **Status codes.** 401 without a valid credential (with `WWW-Authenticate`);
  403 `insufficient_scope` for a read token on a write; 404 unknown id; 403
  non-owner on cv / invoice / portfolio writes; not-found for non-owned jobs
  and in MCP tools (no existence oracle).
- **CORS.** Credentialed, allowlist only: the three `*.pilihpendidikan.com`
  app origins, plus `http://localhost:4003-4005` only while the Worker itself
  runs on localhost. OAuth endpoints use `*` without credentials.
- **Cookies.** `__Host-session` (HttpOnly, Secure, SameSite=Lax, Path=/) in
  production; `session` without Secure on http localhost.
- **/connect.** Server-rendered HTML with a strict CSP (nonce script for the
  Copy buttons, `form-action 'self'`, no framing). Every POST must carry a
  same-origin `Origin` (or `Sec-Fetch-Site: same-origin`).
- **OAuth.** DCR accepts https redirect URIs (http only on loopback, no
  fragments); confidential and public (`none`) clients; PKCE S256 required;
  codes single-use for 5 minutes; `iss` in the redirect (RFC 9207). Pending
  authorizations are keyed by the hashed email-link token, not by `state`.
- **MCP.** `registerAllTools()` composes scope filter → request logger →
  ownership guard → tools, so `tool-surface.test.ts` checks exactly what a
  client receives. The Durable Object refuses a session id presented with a
  different account or scope (the agents SDK applies props only at start).
- **Email.** `EMAIL` send_email binding from `noreply@pilihpendidikan.com`,
  plain HTML + text; local dev simulates delivery and prints the link.
- **Data scripts** talk to Cloudflare through small `KvStore` / `SqlStore`
  interfaces (REST API with an API token), so tests prove a dry run writes
  nothing. They never delete source data.

## Risks

- KV is eventually consistent: a single-use link or code can, in a narrow
  window, be redeemed twice from different locations. Same as the old backend.
- Rebound namespaces are written by both Workers until the old backend is
  retired; both use the same keys and shapes.
