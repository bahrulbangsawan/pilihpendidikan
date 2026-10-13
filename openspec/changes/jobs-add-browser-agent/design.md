## Context

The CLI (`apps/jobs-cli`, Python, D-07) runs Playwright on the user's machine;
`apps/api` (D-01) is the single source of truth in `JOBS_DB`. The dashboard
(`apps/jobs`) creates tasks and decides approvals; the CLI worker claims and
executes them. Applications to real employers are irreversible, so the design
optimises for "never submit twice, never submit without consent, never claim
a submission that is not evidenced" (D-18, D-19) over latency.

## Goals / Non-Goals

- Goals: assisted and approval mode for Greenhouse, Lever and Ashby hosted
  forms; exactly-once claims; a durable checkpoint before every submit click;
  approvals from any surface (web, CLI, MCP for `answer` / `cv_variant`);
  AI that cannot emit free-form actions or invent values; local browser
  profiles that never leave the machine.
- Non-Goals: `auto` mode (separate change `jobs-add-auto-apply`); solving or
  evading CAPTCHAs, logins or MFA (18 §8); attaching to the user's everyday
  Chrome profile (D-23); WebSocket push (D-11 keeps it as an M8 option);
  sending email (09).

## Decisions

- **Polling + D1 leases (D-11).** Claims are one atomic
  `UPDATE … WHERE state = 'queued' … RETURNING` plus the attempt row, the
  `automation_task_claimed` event and `change_log` in one batch; D1 serializes
  writes, so concurrent claims have one winner (T21-01). Leases last 120 s,
  heartbeats every 30 s; the CLI pauses at 90 s and treats the lease as lost at
  110 s on a monotonic clock (21 §5.3–§5.4).
- **`lease_id` is a fencing token.** Every lease-scoped write re-checks
  `lease_id`, `lease_device_id`, expiry and a live state inside the write batch
  (`repo/automation/lease.ts`, hardened by the driver for the D-19 race:
  T11-LEASE). A stale holder gets `409 lease_lost` and must stop; `401
  revoked_token` is handled the same way.
- **Synchronous `submit-intent` (D-28, D-19).** The final click happens only
  after a 200 from `POST …/submit-intent`, which checks the approval's
  `payload_hash` (approval mode), the application state and the global
  40/day cap, and records `submit_intent_at`. After it, nothing re-runs the
  task automatically: lease loss means `outcome_unknown`.
- **Evidence over inference (D-18).** `submitted_verified` needs a
  deterministic and an AI positive signal (19 §9.1); one positive gives
  `submitted_unverified`; errors give `negative`.
- **Closed action space (D-13).** The executor enumerates candidate actions
  deterministically; the Decisions API only chooses among their ids plus
  `pause` / `stop`; Structured Outputs only propose field values that the
  server validator (and the client `PlanValidator`) check against the fact
  sheet and answer bank (19 §6.4). There is no `goto` and no `evaluate`
  action.
- **AI only through `apps/api` (D-12).** Proxy calls must reference the
  device's live lease (`lease_ref`), pass `AI_DISABLED`, the AI consent
  setting and the D-34 budget; usage is written in the same batch as the
  idempotency row.
- **Browser modes (D-22, D-23, D-32).** Mode A: managed persistent context
  under the CLI data dir; Mode B: CDP to a user-launched Chrome on a dedicated
  profile, loopback only, assisted/approval only; Mode C: named prepared
  profiles. Discovery and apply profiles are never shared.
- **One worker per device (D-31)** with a lock file and local IPC; one apply
  task at a time per device, plus one discover and one render (21 §3, TA-CAPS).

## Divergences from the spec (code wins, recorded here)

- 12 §6.3 says "heartbeat age > 60 s" shows "Device not responding"; the
  monitor implements exactly that (TW-MONITOR) while the reaper still uses the
  120 s lease (21 §7) — consistent, noted because 21 §7.2 mentions 90 s.
- The global 40 submissions/day cap (D-35) is enforced for every
  `submit-intent`, not only for rule tasks (`services/automation/intent.ts`
  `assertGlobalCap`), which is stricter than 19 §8.3's wording.
- `release` with `reason = needs_headed` re-queues with `headed_browser`
  added to `required_capabilities` (21 §6.2) and `user_quit` re-queues with
  the retry backoff (TA-RELEASE); a release after `submit_intent` answers
  `409 too_late`.

## Risks / Trade-offs

- ATS DOM changes → adapter confirmation patterns + AI fallback + pause; the
  real-ATS smoke tests (18 §13.3) are owner-run and not executed here.
- Evidence false positives → the two-signal rule and decoy-confirmation
  fixtures (S-23).
- Prompt injection → untrusted delimiting, closed choices, fact-equality
  validation, navigation allowlist, ≥ 30-page injection corpus (S-18).
- Users' legal authority per platform (A-07) → approval mode by default; the
  legal review is an owner action that must start in M5.

## Migration Plan

All tables already exist in `migrations-jobs/0001_jobs_core.sql`
(`api-add-user-ids-and-jobs-db`). The `*/5 * * * *` cron trigger is declared
in `apps/api/wrangler.jsonc`. Rollout is behind `JOBS_AUTOMATION_ENABLED`
(D-33, dark by default); turning it on in production is an owner action.
Rollback: switch the flag off — claims answer 204 and tasks stay queued
(TA-FLAGS).

## Open Questions

- A-01: the Decisions API shape stays as documented (contract test against the
  live endpoint is an owner-run nightly job).
- A-07: per-platform legal review of user-directed browser automation
  (Greenhouse, Lever, Ashby) — must start before a public M5 release (gate G5
  needs the injection corpus green and an evidence audit).
