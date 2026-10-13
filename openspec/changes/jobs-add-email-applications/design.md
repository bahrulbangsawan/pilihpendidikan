## Context

Email applications (09) add a second submission channel next to the browser
agent. They touch the api (routes, D1 batches, R2, the `EMAIL` binding and
the AI provider), the contracts (templates, limits, approval payload), the
web BFF (`.eml` builder) and the CLI (`.eml` writer, OS opener). The server
send path depends on an unverified platform capability (A-03) and on a new
sender address, so it is shipped dark.

## Goals / Non-Goals

- Goals: explicit, content-bound approval for every email; `local_handoff` as
  the default with honest `unverified` evidence; the same stage / submission
  bookkeeping as browser applications (one D1 batch per effect); a
  `server_send` path that is safe to switch on once A-03 holds.
- Non-Goals: email in `auto` mode (never in v1, 09 §1); HTML mail; reading
  the user's mailbox (no Gmail / Graph scopes); bounce processing beyond
  recording a provider failure.

## Decisions

- Decision: `local_handoff` is the default and needs no flag; `server_send`
  is gated by `JOBS_EMAIL_SERVER_SEND_ENABLED` in `DB.feature_flags` (D-33),
  checked both at draft and at approval. Alternatives: a wrangler var
  (rejected by D-33), shipping only hand-off (kept possible by leaving the
  flag dark).
- Decision: the approval is a `submit` row in `approvals` whose
  `payload_hash` covers `{to, cc, subject, body_text, attachments[sha256]}`
  (03 §8); clients must echo the hash they reviewed. This reuses the approval
  queue of the browser agent and makes "edited after approval" detectable
  without extra columns.
- Decision: approving needs `automation:manage` (05 §1.2, D-29); MCP drafts
  (`jobs:write`) but never approves, and an MCP-recorded recipient tick is
  ignored. A `server_send` approval is only possible on the email route
  (`approve_on_email`), because approval and send are one request.
- Decision: `server_send` claims the email row (`approved`, guarded revision)
  before calling the provider, then records the outcome with a final batch
  retried on guard failures, so two concurrent approvals cannot both send
  and a provider success is never lost to a race.
- Decision: the sender is always `applications@pilihpendidikan.com` with a
  sanitised "<Full Name> via pilihpendidikan" display name; `Reply-To` / `Cc`
  come from `users.email` (the magic-link-verified address) — never from
  facts (09 §7).
- Decision: the AI paragraph goes through `AiProvider.structured` with
  `store: false` (D-12) and the CV no-fabrication validator; budget checks
  and usage recording follow D-34 in the draft's batch.
- Decision: the web `.eml` is built by the BFF (D-15) so attachments are
  fetched with the bearer server-side and verified by SHA-256; the CLI builds
  its own `.eml` with the same rules.

## Divergences from the spec text (code is authoritative)

- 09 §8 lists the limits as "per day / per month"; the code uses rolling
  windows: 24 hours and 30 days. Exceeding a limit is 422 `policy_violation`
  with `daily_limit` / `monthly_limit` / `domain_limit` / `new_account`
  (13 S-26 says "rate limit"; it is not a 429).
- The global 500 / day cap and the "three consecutive hard bounces → suspend"
  rule of 09 §8 are not implemented; the kill switch is the flag.
- A provider failure sets the submission to `failed` and the email to
  `failed`; a retry with unchanged content reuses the existing approval.
- The draft request accepts additive conveniences beyond 05 §13 (`to` from a
  `mailto:` link, templated subject/body, default CV attachment,
  `draft_paragraph`, `recipient_name`, `locale`) for the CLI's
  `email draft` command.

## Risks / Trade-offs

- Wrong recipient cannot be undone → employer-domain check, free-mail tick,
  exact-content approval, no `auto`.
- Sender reputation / abuse for `pilihpendidikan.com` → flag dark by default,
  rolling limits, 7-day account age, one recipient, plain text.
- `X-Unsent: 1` is honoured only by some clients → the CLI prints recipient,
  subject and attachment paths as a fallback; per-client behaviour is an M6
  check.
- `unverified` evidence for hand-offs → the card shows "Unconfirmed" until the
  user attests (06 §1.3).

## Migration Plan

No schema migration beyond `email_applications` in
`migrations-jobs/0001_jobs_core.sql`. Rollout: ship with the flag dark; the
owner verifies A-03 (T9-08), confirms SPF/DKIM/DMARC for the sender, then
flips `JOBS_EMAIL_SERVER_SEND_ENABLED`. Rollback: turn the flag off;
hand-off keeps working.

## Open Questions

- A-03: can Cloudflare Email Sending deliver to arbitrary external recipients
  with attachments, `Reply-To` and `Cc`? Until confirmed, `server_send` stays
  off.
- Should bounce tracking and the global cap be added before the flag is
  turned on for anyone but the owner?
