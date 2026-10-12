# 09 — Email Applications

Some employers accept applications by email instead of a web form. This
document specifies when the Job Tracker uses an email application, its two
delivery modes, the approval model, how content and attachments are produced,
sender identity rules, abuse limits, and how evidence and status are recorded.

Legend: `00-README.md` §2. Table: `email_applications` (04 §2.5). Endpoints:
05 §13. Related: 08 (CV PDF), 19 §9 (evidence), 11 (threat model).

---

## 1. When an email application applies

An application is **email-eligible** when any of these hold:

| Signal | Source |
|---|---|
| `job_postings.application_support = 'email'` | Set by the source adapter (15 §5) when the posting says "send your CV to …" or the apply link is `mailto:` |
| `apply_url` starts with `mailto:` | Adapter normalization keeps the address and the `subject` parameter |
| The browser agent classifies the apply page as `email_instructions` (19 §4) | The executor stops and proposes an email application instead |
| The user adds a recipient manually | Application detail → "Apply by email" |

**[DECISION]** An email application is always the user's explicit choice per
application. The system *proposes* it and never sends without the approval
step (§4). Automation rules (`auto` mode) **cannot** send emails in v1. Email is
excluded from `auto` because one wrong recipient cannot be undone, and email
lacks the structured confirmation evidence a web form provides.

Recipient validation:
- syntactically valid (same check as sign-in, ≤ 254 chars,
  [VERIFIED] `apps/api/src/sign-in.ts:23-28`);
- the domain must equal or be a subdomain of `job_postings.company_domain` or
  `apply_domain`, **or** the user ticks "I confirm this address belongs to the
  employer" (recorded in the approval payload);
- free-mail domains (gmail.com, yahoo.com, outlook.com, …) always require that
  tick, with a warning about recruiter impersonation scams.

---

## 2. Delivery modes

| Mode | Who sends | From address | Availability |
|---|---|---|---|
| `local_handoff` (default) | The **user's own mail client** on their machine | The user's own address | v1 (M6). Always available with the CLI. A web-only variant downloads the `.eml`. |
| `server_send` | `apps/api` through the Cloudflare `EMAIL` binding | A pilihpendidikan sender with `Reply-To` = user | v1 (M6) **only if [ASSUMPTION A-03] holds**; off by default |

**[DECISION]** `local_handoff` is the default because:
1. the employer receives mail **from the applicant's own mailbox**, which is
   what they expect, and replies thread naturally;
2. we store no SMTP or OAuth credentials for the user's mailbox (no Gmail or
   Microsoft Graph scopes in v1);
3. there is no sender-reputation or abuse exposure for `pilihpendidikan.com`.

---

## 3. Existing email infrastructure

**[VERIFIED]**
- `apps/api/wrangler.jsonc:40-45` declares a `send_email` binding `EMAIL`
  restricted by `allowed_sender_addresses: ["noreply@pilihpendidikan.com"]`.
- `apps/api/src/email.ts:40-62` sends with
  `env.EMAIL.send({ from: {email, name}, to, subject, html, text })` inside
  `ctx.waitUntil`, using `EMAIL_FROM` or the default `noreply@pilihpendidikan.com`
  (`:7`).
- It is used today only for sign-in and OAuth magic links. The repo history
  says email was migrated to "Cloudflare Email Sending" (commit 952f221).

**[LIMITATION]** The repo does not show that the binding can (a) send to
arbitrary external recipients, (b) carry **attachments**, or (c) set
`Reply-To` / `Cc`. **[ASSUMPTION A-03]** covers all three. If any fails,
`server_send` stays disabled and only `local_handoff` ships. If attachments are
unsupported but the rest works, `server_send` may send a message with a
**download link** to the CV (§5.3) only if the owner accepts that pattern,
which is not the default.

---

## 4. Authorization model

- Every email application needs **one explicit approval of the exact content**:
  recipient, subject, body and attachment SHA-256 values.
  `approvals(kind='submit')` with
  `payload_hash = sha256(canonical{to, cc, subject, body_text, attachments:[sha256…]})`
  (03 §8). Any edit after approval invalidates it.
- Approving needs scope `automation:manage` (05 §1.2): web BFF session or
  interactive CLI. MCP clients can **draft** (`jobs:write`) but cannot approve
  (06 §11).
- `server_send`: approval and send happen in one request
  (`POST /api/v1/emails/{id}/approve`). The approval, the send result and the
  event are written in one D1 `batch()` after the provider call returns.
- `local_handoff`: approval releases the draft to the CLI. Sending is the
  user's own act in their mail client.

---

## 5. Content

### 5.1 Templates

**[NEW]** Two built-in templates per locale (`en`, `id`), stored in
`packages/jobs-contracts/email-templates/` and rendered server-side with plain
string interpolation (escaped, no HTML in v1):

```text
[en] Subject: Application for {posting.title} — {facts.contact.full_name}
Dear {recipient_name|"Hiring Team"},

I am writing to apply for the {posting.title} position at {posting.company_name}{posting.source_ref_clause}.
Please find my CV attached.

{optional_paragraph}

Kind regards,
{facts.contact.full_name}
{facts.contact.phone}
{facts.links.linkedin|""}

[id] Subjek: Lamaran {posting.title} — {facts.contact.full_name}
Yth. {recipient_name|"Tim Rekrutmen"} {posting.company_name},

Dengan hormat, saya bermaksud melamar posisi {posting.title} …
Bersama email ini saya lampirkan CV saya.
…
Hormat saya,
{facts.contact.full_name}
```

Locale defaults to the posting's detected language (adapter field), and the
user can switch it. `{posting.source_ref_clause}` adds "(ref. {source_job_ref})"
when the posting has a reference number.

### 5.2 Optional AI draft (`optional_paragraph`)

- Off by default. When the user clicks "Draft a paragraph", `apps/api` calls the
  Responses API with Structured Outputs
  (`{paragraph: string ≤ 600, source_bullet_ids: string[], source_fact_keys: string[]}`,
  `store: false`).
- The paragraph passes the **same no-fabrication validator** as CV summaries
  (08 §4.4 V4/V6) against the cited bullets and facts. On failure there is no
  paragraph and the UI says so.
- The draft is always shown in an editable textarea. The user's edits are final
  and **not** validated (the user is the author). The approval records whether
  the text is AI-drafted (`payload.ai_drafted = true`).

### 5.3 Attachments

- Default: the approved CV variant's PDF (`applications.cv_variant_id` →
  `files`, kind `cv_pdf`). The user may add `cover_letter` / `attachment` files
  they uploaded (05 §7), at most 5 files and 10 MB total.
- `server_send`: the Worker streams each object from R2
  (`JOBS_FILES.get(r2_key)`), verifies the SHA-256 against `files.sha256`, and
  attaches it (if A-03 holds).
- `local_handoff`: the CLI downloads each file with the 08 §8 integrity checks
  into `<data>/runs/<eml_id>/`.

---

## 6. Flows

### 6.1 `local_handoff`

```text
web or CLI: create draft  POST /api/v1/applications/{app}/emails {to, subject, body_text, attachment_file_ids, delivery:'local_handoff'}
   │  (status draft)
   ▼
user reviews → Approve (web or `pilih-jobs email approve <eml_id>`)
   │  approvals(kind=submit) approved; email_applications.status='approved'
   ▼
CLI (`pilih-jobs email send <eml_id>`, or picked up as part of an apply task in assisted/approval mode):
   1. GET draft + files, verify sha256
   2. write RFC 5322 message <data>/runs/<eml_id>/application.eml
        From: <facts.contact.email>   To: <to>   Subject: …   Date: …
        MIME multipart/mixed: text/plain; charset=utf-8 + application/pdf attachments (base64)
        X-Unsent: 1        (Outlook/Apple Mail open it as an editable draft)
   3. open with the OS handler: macOS `open`, Windows `os.startfile`, Linux `xdg-open`
   4. prompt: "Did you send it? [y/N]"   (non-interactive: leave 'approved', print instructions)
   ▼
y → POST /api/v1/emails/{eml_id}/handed-off {sent_confirmed:true, sent_at}
     → email_applications.status='handed_off'; evidence(kind='email_sent', verdict='unverified', signals {method:'local_handoff', user_confirmed:true})
     → application submission_status = submitted_unverified, stage → applied (06 §3)
```

- **Web-only users** get "Download .eml" (same content, generated by the BFF)
  plus a `mailto:` fallback that pre-fills recipient, subject and body. They are
  told that **attachments must be added manually** (`mailto:` cannot carry
  attachments).
- **[DECISION]** The verdict is `unverified` because we cannot observe the
  user's mailbox. The user can later confirm (`submitted_verified`, evidence
  `user_attestation`) after seeing the message in their Sent folder. The card
  shows "Unconfirmed" until then (06 §1.3).
- **[LIMITATION]** `X-Unsent: 1` is honoured by Outlook and Apple Mail. Other
  clients may open the `.eml` read-only. The CLI then prints the recipient,
  subject and attachment paths for manual composition.
  **[ASSUMPTION]** Behaviour per client is verified in M6 (Apple Mail,
  Outlook desktop, Thunderbird, Gmail web — the last cannot open `.eml`
  drafts).

### 6.2 `server_send` (only if A-03 holds)

```text
draft (delivery:'server_send') → user Approve (web/CLI, automation:manage)
   ▼
apps/api:
   check limits (§8) → load attachments from R2, verify sha256
   EMAIL.send({ from: {email: "applications@pilihpendidikan.com", name: "<User Full Name> via pilihpendidikan"},
                to, cc: <user verified email (users.email)>, replyTo: <user verified email>,
                subject, text, attachments })
   ▼ success
   batch: email_applications(status='sent', provider_message_id, sent_at) + approvals(approved) +
          submission_evidence(kind='email_sent', verdict='verified', signals {provider_accepted:true, message_id})
          + application submission_status='submitted_verified', stage→applied + events + change_log
   ▼ failure
   email_applications.status='failed', error surfaced; no stage change; user may retry (new approval not required if payload unchanged)
```

- `verified` here means **the provider accepted the message**. It does not
  mean the employer received or read it. The UI wording is "Sent".
- A new sender address `applications@pilihpendidikan.com` must be added to
  `allowed_sender_addresses` and SPF/DKIM/DMARC confirmed (14 §3). This is a
  DNS/Cloudflare change and needs the owner's go-ahead (root `CLAUDE.md`).
- The `Reply-To` and `Cc` address is `users.email`, the address the user proved
  by magic link. It is **never** a free-text address typed into facts.

---

## 7. Sender identity rules

| Rule | Reason |
|---|---|
| Never put the user's address in `From:` when the server sends | Spoofing; fails DMARC for the user's domain |
| Display name "<Full Name> via pilihpendidikan" | Honest about the relay |
| `Reply-To` and `Cc` = `users.email` (verified) | Replies reach the applicant; the applicant keeps a copy |
| No tracking pixels, no link rewriting, no unsubscribe footer | It is a one-to-one personal message, not marketing |
| Plain text only in v1 | No HTML rendering pitfalls; employers' filters treat plain text better |
| One recipient (To) per message; no BCC | Prevents bulk use |

---

## 8. Deliverability and abuse limits (`server_send`)

| Limit | Value | Enforcement |
|---|---|---|
| Per user | 10 / day, 50 / month | D1 count on `email_applications(status='sent')` before sending |
| Per recipient domain per user | 3 / 30 days | Prevents spamming one employer |
| Global | 500 / day | Operator kill switch: flag `JOBS_EMAIL_SERVER_SEND_ENABLED` in `DB.feature_flags` (D-33). `local_handoff` needs no flag |
| New accounts | `server_send` unavailable for 7 days after `users.created_at` | Abuse damping |
| Content | Body ≤ 20 KB; attachments ≤ 5 and ≤ 10 MB total; PDF/DOCX only | Validated at draft and send |
| Bounces | Provider failure → `failed`. Three consecutive hard bounces for a user → `server_send` suspended for review. | Event + admin flag |

`local_handoff` has no server-side send limits (the user's own mailbox
applies its own), but draft creation counts toward the `task-create` limit
(05 §1.9).

---

## 9. Status and evidence summary

| Event | `email_applications.status` | Evidence | `applications.submission_status` / stage |
|---|---|---|---|
| Draft created | `draft` | — | unchanged (`preparing`/`ready` suggested) |
| Approved | `approved` | — | `in_progress` |
| `server_send` accepted | `sent` | `email_sent`, `verified` | `submitted_verified`, → `applied` |
| `server_send` failed | `failed` | — | `failed` (retryable) |
| Local hand-off confirmed by user | `handed_off` | `email_sent`, `unverified` | `submitted_unverified`, → `applied` |
| User confirms in Sent folder | — | `user_attestation`, `verified` | `submitted_verified` |
| User says not sent | `approved` (re-sendable) | — | `failed` (03 §5.2: a denial is `failed`; re-sending moves it back to `in_progress`) |

Each row writes `application_events` (`email_sent`, `submission_status_changed`,
`stage_changed`) (03 §6). The delivery event (`email_sent`) may have
`actor_kind = system`; the `→ applied` stage change is recorded with
`actor_kind = user`, because it follows the user's approval or confirmation
(03 §5.1 allows the system no `→ applied` transition).

---

## 10. CLI commands

```text
pilih-jobs email draft <app_id> [--to ADDR] [--locale en|id] [--attach FILE_ID…]
pilih-jobs email show <eml_id>
pilih-jobs email approve <eml_id>          # interactive confirmation shows full content + sha256s
pilih-jobs email send <eml_id>             # local_handoff: build .eml, open mail client, ask for confirmation
pilih-jobs email confirm <eml_id> --sent|--not-sent
```

---

## 11. Test plan

| # | Test | Level |
|---|---|---|
| T9-01 | Recipient validation: domain match, free-mail tick required, invalid addresses rejected | unit |
| T9-02 | Approval binding: any change to to/subject/body/attachments after approval → `409`/new approval required | api |
| T9-03 | MCP can draft but not approve | api |
| T9-04 | `.eml` generation: RFC 5322 headers, UTF-8 subject encoding (RFC 2047) for Indonesian text, multipart with PDF, `X-Unsent: 1`; parsed back with Python `email` and compared | CLI |
| T9-05 | Attachment sha256 mismatch aborts the hand-off | CLI |
| T9-06 | OS opener per platform (mocked) and the non-interactive path | CLI |
| T9-07 | `server_send` (behind flag, fake EMAIL binding): `From` is never the user, `Reply-To`/`Cc` = `users.email`, limits enforced, evidence + stage written in one batch | api |
| T9-08 | A-03 live check: send with attachment + Reply-To to an owner-controlled external mailbox (manual, M6 gate) | manual |
| T9-09 | AI paragraph passes the fabrication validator; failures yield no paragraph | unit |
| T9-10 | Templates `en`/`id` render with missing optional facts and no `undefined` text | unit |
