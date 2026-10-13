## Context

`jobs-add-browser-agent` delivers assisted and approval modes with leases, the
synchronous submit-intent checkpoint (D-28) and verification. Auto mode reuses
all of it and only removes the per-application submit approval, so every
safety property must move into the rule (consented once, explicitly) and into
hard server-side caps.

## Goals / Non-Goals

- Goals: auto submission only for postings a user-approved rule covers, on
  ATS forms the manifest marks `auto_ok`, within D-35 caps, with an
  immediate kill switch; more discovery sources without weakening D-16/D-17.
- Non-Goals: auto on Workday, career pages, generic listings or custom URLs;
  auto through a connected (CDP) browser; generated text in auto mode; any
  identity change, stealth fetcher or proxy rotation for any adapter.

## Decisions

- **Rule activation is an approval (19 §8.3, 03 §8).** The activation binds
  the rule's effective fields; changing them voids it; renaming does not.
  Disabling is always allowed without step-up so stopping is never harder
  than starting. MCP cannot decide activations (05 §14).
- **Caps counted from `submit_intent` events** (not from results), so a
  submission whose outcome is unknown still counts. Checked three times: at
  rule evaluation, at claim and at submit-intent (the authoritative check).
- **The global 40/day cap applies to every submit-intent**, any mode
  (`assertGlobalCap` in `services/automation/intent.ts`).
- **Auto stops, it never waits for a human it does not have** (19 §8.1); a
  failed per-application precondition converts to the approval flow only when
  the device is headed (a human is reachable).
- **Adapters are data (15 §14.1).** Per-adapter enablement, ATS hosts,
  confirmation patterns and the `auto_ok` / `headless_ok` flags live in
  `adapters.json`; there is no per-adapter feature flag (13 §9).
- **Workday is opt-in and stops on the first denial (C-11, D-17)**: one
  request at a time, ≥ 3 s apart, tenant disabled with `disabled_reason`.

## Divergences from the spec (code wins)

- 19 §8.3 phrases the 40/day cap as "across all rules"; the code applies it
  to every submit-intent including approval mode (stricter).
- 19 §8.3 allows a rule activation "from the web or the interactive CLI";
  the CLI's `rules enable` refuses auto rules with `mode_not_allowed`
  (`apps/jobs-cli/src/pilih_jobs/cli/rules.py`), so activation is web-only
  today. The server side accepts an activation from any `automation:manage`
  caller.
- 13 §2 lists Homebrew / Scoop / winget under M7; they are packaging owned by
  leaf 5.3 and recorded with `jobs-add-cli`, not here.

## Risks / Trade-offs

- Wrongful submissions → caps, allowlisted domains, auto-only adapters with
  deterministic form recognizers, two-signal verification, kill switch,
  4-week ≤ 20-user beta (owner).
- Platform complaints → adapter manifest change takes effect without a deploy
  of the CLI (next `meta` refresh) and immediately on the server.
- Legal exposure (A-07) → flag stays dark until the review closes (G7).

## Migration Plan

No schema change: `automation_rules.activated_approval_id`, `limits` and the
`rule_activation` approval kind are in `migrations-jobs/0001_jobs_core.sql`.
Enable order (owner): close A-07 → turn on `JOBS_AUTO_MODE_ENABLED` for the
owner → beta cohort → opt-in for all. Rollback: turn the flag off (auto tasks
stop being claimed; auto intents are refused).

Archive order: the MODIFIED `jobs-automation` requirements target the base
written by `jobs-add-browser-agent`, so that change must be archived first
(the validator reports this as an info until then); the `jobs-discovery`
additions need `jobs-add-cli` archived first.

## Open Questions

- A-07: per-platform legal approval of auto-submission (blocking for G7).
- A-10: Workers pricing used for the auto-mode volume estimate.
