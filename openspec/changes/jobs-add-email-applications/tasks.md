## 1. Contracts

- [x] 1.1 `EMAIL_LIMITS` (20 KB body, 5 attachments, 10 MB, 254-char recipient, 600-char paragraph), `EmailParagraphDraftSchema`, `renderEmailTemplate` and `email-templates/{en,id}.txt` in `packages/jobs-contracts/src/email.ts` — tests `T9-10` in `packages/jobs-contracts/test/email.test.ts` (ledger leaf-1.1 G1 verified)
- [x] 1.2 Draft / show / approve / handed-off request and response schemas in `packages/jobs-contracts/src/api/` (`API_ROUTE_SCHEMAS`, 05 §13), `email_submit` approval payload in `records.ts`

## 2. API (`apps/api/src/jobs`)

- [x] 2.1 Routes `routes/email/index.ts` (draft with `task-create` rate limit, show, approve, handed-off) via `fromContract`
- [x] 2.2 Recipient validation `services/email/recipient.ts` (free-mail list, employer domain/subdomain match, own-domain refusal) — `T9-01` in `services/email/recipient.test.ts`
- [x] 2.3 Content checks and payload hash `services/email/content.ts` (body, subject, attachments, `emailPayloadHash`) — `TE-LIMITS`, `TE-ATTACHMENTS` in `services/email/content.test.ts`
- [x] 2.4 Drafts `services/email/drafts.ts` (template rendering, `mailto:` defaults, default CV attachment, superseding earlier pending approvals, MCP tick ignored) and repo `repo/email/index.ts`
- [x] 2.5 Optional AI paragraph `services/email/paragraph.ts` (Structured Outputs via `AiProvider`, no-fabrication validator, budget + usage in the draft batch) — `T9-09` in `services/email/paragraph.test.ts`
- [x] 2.6 Approve `services/email/approve.ts` (payload-hash binding, recipient tick, in-flight browser submission refusal, local hand-off effects, queue decisions with `approve_on_email` / `mcp_cannot_approve_email`) — `T9-02`, `T9-03` in `routes/email/email.test.ts`
- [x] 2.7 Hand-off `services/email/handoff.ts` (handed_off + evidence `email_sent` unverified + `submitted_unverified` + `applied`; not-sent → `failed`) — `S-25` component tests in `routes/email/email.test.ts`
- [x] 2.8 Server send `services/email/send.ts` (flag gate, rolling limits, 7-day account age, sender identity, R2 re-hash, claim-then-record batches) — `T9-07`, `S-26`, `TE-LIMITS`, `TE-ATTACHMENTS` in `routes/email/server-send.test.ts`
- [x] 2.9 Show route `services/email/show.ts` (current `payload_hash`, null when an attachment is gone) — `routes/email/show.test.ts`
- [x] 2.10 `applications@pilihpendidikan.com` listed in `allowed_sender_addresses` of `apps/api/wrangler.jsonc` (local configuration only)
- [x] 2.11 Cross-user isolation of the email routes covered by the S-31 sweep (`src/jobs/isolation-sweep.test.ts`, ledger leaf-2.11 G1 verified) and the per-route 404 test in `routes/email/email.test.ts`
- [x] 2.12 Evidence: ledger leaf-2.9 G1 (`TESTS OK api-analytics-email`, ids T9-01, T9-02, T9-03, T9-07, T9-09, S-25, S-26, TE-LIMITS, TE-ATTACHMENTS) and `leaf-2.9 VERIFIED` in `.unlazy/jobs/status.log`

## 3. Web (`apps/jobs`)

- [x] 3.1 Email composer and drafts list `src/components/application/{email-apply,email-drafts}.tsx` (recipient hints and tick, template, ≤ 5 attachments, 20 KB body, approve with `payload_hash`, "I sent it" / "Not sent") — `TW-EML` in `email-apply.test.tsx`
- [x] 3.2 Recipient hints `src/lib/email-recipient.ts` — `TW-EML` in `email-recipient.test.ts`
- [x] 3.3 RFC 5322 builder and `mailto:` fallback `src/lib/eml.ts`; BFF download `src/lib/eml-download.ts` behind `/download/applications/{app}/emails/{eml}.eml` (server-side SHA-256 checks, approved drafts only) — `TW-EML` in `eml.test.ts`, `eml-download.test.ts` (ledger leaf-3.2 G1 verified)

## 4. CLI (`apps/jobs-cli`)

- [x] 4.1 `pilih-jobs email draft|show|approve|send|confirm` in `src/pilih_jobs/cli/email.py`
- [x] 4.2 `.eml` writer, hand-off, OS opener and templates in `src/pilih_jobs/email/{eml,handoff,opener,templates}.py` — `T9-04`, `T9-05`, `T9-06` in `tests/email/test_email.py` (ledger leaf-4.4 G1 verified)

## 5. Handoffs and owner actions

- [x] 5.1 Handoff recorded (NOT executed — owner action): A-03 check that Cloudflare Email Sending can reach external recipients with attachments, `Reply-To` and `Cc`, and the live test send T9-08 to an owner-controlled mailbox. Not done in this change.
- [x] 5.2 Handoff recorded (NOT executed — owner action): confirm SPF / DKIM / DMARC for `applications@pilihpendidikan.com` and deploy the `allowed_sender_addresses` change. No DNS or Cloudflare change was made.
- [x] 5.3 Handoff recorded (NOT executed — owner action): turning `JOBS_EMAIL_SERVER_SEND_ENABLED` on in the production `DB.feature_flags`; it stays dark (seeded off by `migrations/0002_users_devices_oauth.sql`).
- [x] 5.4 Handoff recorded (NOT executed — owner action): deploying `apps/api` and `apps/jobs` with this feature.
- [x] 5.5 Handoff recorded (NOT executed — leaf-5.1): the full-stack S-25 scenario (web + CLI + `wrangler dev`) belongs to the `e2e/` suite, which does not exist yet; only the api component test of S-25 has run.
- [x] 5.6 Handoff recorded (NOT executed — owner decision): per-client verification of `X-Unsent: 1` (Apple Mail, Outlook, Thunderbird, Gmail web, 09 §6.1), the global 500 / day cap and hard-bounce suspension of 09 §8, which the code does not implement (see design.md).
