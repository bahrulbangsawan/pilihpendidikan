# Change: Add email applications to the Job Tracker

## Why

Some employers take applications by email instead of a web form ("send your
CV to …", `mailto:` apply links, or an apply page the browser agent classifies
as `email_instructions`). The Job Tracker needs a safe way to apply there:
the exact content approved by the user, sent from the user's own mailbox by
default, with honest evidence and the same stage / submission bookkeeping as
browser applications (`job-tracker-spec/09`, milestone M6 in 13 §2).

## What Changes

- New `/api/v1` routes (05 §13): `POST /api/v1/applications/{app_id}/emails`
  (draft, `jobs:write`, counts toward the `task-create` limit),
  `GET /api/v1/emails/{eml_id}` (`jobs:read`, returns the current
  `payload_hash`), `POST /api/v1/emails/{eml_id}/approve`
  (`automation:manage`) and `POST /api/v1/emails/{eml_id}/handed-off`
  (`jobs:write`).
- Recipient validation (09 §1): one plain address ≤ 254 characters; the
  domain must match the posting's company / apply domain or the user ticks
  "this address belongs to the employer"; free-mail domains always need the
  tick.
- Content (09 §5): the `en` / `id` templates in
  `packages/jobs-contracts/email-templates/`, an optional AI paragraph
  (Responses Structured Outputs, `store: false`) that must pass the
  no-fabrication validator, plain text ≤ 20 KB, at most 5 PDF/DOCX
  attachments ≤ 10 MB in total, default attachment = the approved CV
  variant's PDF.
- Approval (09 §4): one `submit` approval bound to
  `sha256(canonical{to, cc, subject, body_text, attachments})`; any edit
  invalidates it; MCP clients may draft but never approve.
- `local_handoff` (default, 09 §6.1): the web BFF builds an RFC 5322 `.eml`
  (`X-Unsent: 1`) plus a `mailto:` fallback; the CLI (`pilih-jobs email
  draft|show|approve|send|confirm`) writes the `.eml`, verifies every
  attachment's SHA-256 and opens the OS mail client; the user's confirmation
  records `handed_off`, evidence `email_sent` (`unverified`), submission
  `submitted_unverified` and stage `applied`.
- `server_send` (09 §6.2, §7, §8), only behind the `JOBS_EMAIL_SERVER_SEND_ENABLED`
  flag (D-33, off by default, pending A-03): sender
  `applications@pilihpendidikan.com` named "<Full Name> via pilihpendidikan",
  `Reply-To` and `Cc` = `users.email`, limits 10 / 24 h, 50 / 30 days,
  3 per recipient domain per 30 days, no sending in the first 7 days of an
  account, attachments re-hashed from R2.

The work is implemented in the working tree (uncommitted, undeployed); this
record documents it after the fact for review.

## Impact

- Affected specs: `jobs-email-applications` (new capability).
- Affected code: `apps/api/src/jobs/{routes,services,repo}/email/**`,
  `packages/jobs-contracts/src/email.ts` and `email-templates/{en,id}.txt`,
  `apps/jobs/src/components/application/{email-apply,email-drafts}.tsx`,
  `apps/jobs/src/lib/{eml,eml-download,email-recipient}.ts`,
  `apps/jobs-cli/src/pilih_jobs/email/**`, `apps/jobs-cli/src/pilih_jobs/cli/email.py`.
- Data: table `email_applications` (04 §2.5, already in
  `apps/api/migrations-jobs/0001_jobs_core.sql`), `approvals`,
  `submission_evidence`, `application_events`.
- Sources: `job-tracker-spec/09` §1–§11, 05 §13, 03 §5.2 / §6 / §8, 06 §3,
  12 (Apply tab); decisions D-12, D-15, D-21, D-33; assumption A-03.
- Owner actions not performed here: the A-03 entitlement check and live send
  (T9-08), confirming SPF/DKIM/DMARC for `applications@pilihpendidikan.com`
  (already listed in `allowed_sender_addresses` in `apps/api/wrangler.jsonc`,
  not deployed), turning the flag on, deploys.
