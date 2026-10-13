## ADDED Requirements

### Requirement: Email application routes
The api Worker SHALL expose email applications under `/api/v1`: `POST /api/v1/applications/{app_id}/emails` (scope `jobs:write`, rate-limited as `task-create`, 201 `{email, approval, review}`), `GET /api/v1/emails/{eml_id}` (scope `jobs:read`, 200 `{email, approval, payload_hash}`), `POST /api/v1/emails/{eml_id}/approve` (scope `automation:manage`) and `POST /api/v1/emails/{eml_id}/handed-off` (scope `jobs:write`); an email or application of another user MUST answer 404, for admins too. (Source: 05 §13; 09 §8; 11 §6.1; D-26)

#### Scenario: Draft created
- **WHEN** the owner posts a valid draft for their application
- **THEN** the response is 201 with the `draft` email, its pending `submit` approval and `review.payload_hash`

#### Scenario: Another user's email
- **WHEN** a different user (or an admin) calls any email route with the owner's `eml_` id
- **THEN** the response is 404 and nothing of the owner's email is returned

#### Scenario: Read-only token shows an email
- **WHEN** a read-scoped personal token calls `GET /api/v1/emails/{eml_id}` for its own email
- **THEN** the response is 200 with the current `payload_hash`

### Requirement: Recipient validation
A draft's recipient MUST be exactly one plain address of at most 254 characters (no display name, list, whitespace or control characters); the recipient SHALL count as the employer's only when its domain equals or is a subdomain of the posting's `company_domain` or `apply_domain`, and free-mail domains SHALL always require the user's confirmation tick ("this address belongs to the employer"), which is recorded as `recipient_confirmed` in the approval payload. (Source: 09 §1; T9-01)

#### Scenario: Invalid address
- **WHEN** a draft names `Hiring <hr@acme.com>` or `a@b@c.com` as `to`
- **THEN** the response is 400 `invalid_request` on `to`

#### Scenario: Employer subdomain
- **WHEN** the posting's company domain is `acme.co.id` and the recipient is `hr@careers.acme.co.id`
- **THEN** the recipient matches the employer and no tick is required

#### Scenario: Free-mail without the tick
- **WHEN** the recipient is a `gmail.com` address and the user approves without confirming it
- **THEN** the approval is refused with 422 `policy_violation` (`details.reason = "recipient_unconfirmed"`) and the review carries the `free_mail_recipient` warning

### Requirement: Draft content from templates
When `subject` or `body_text` is omitted, the draft SHALL be rendered from the contracts templates (`email-templates/{en,id}.txt`) in the requested locale, else the posting's detected language, else the user's locale, with plain interpolation of the posting and the user's facts; a posting `mailto:` link SHALL supply the default recipient and subject; missing optional facts MUST NOT leave `undefined` text or dangling separators. (Source: 09 §5.1; T9-10)

#### Scenario: Indonesian template from a mailto link
- **WHEN** a draft for a posting whose apply link is `mailto:hr@acme.co.id?subject=…` is created with `locale: "id"` and no `to`
- **THEN** the email is addressed to `hr@acme.co.id`, uses the mailto subject and the Indonesian body

#### Scenario: Missing optional facts
- **WHEN** the user has no phone or LinkedIn fact
- **THEN** the rendered body contains neither those lines nor the text `undefined`

### Requirement: Content limits
An email body MUST be non-empty plain text of at most 20 KB of UTF-8 with no control characters and a one-line subject; attachments MUST be the user's own `ready` files of kind `cv_pdf`, `cover_letter` or `attachment`, PDF or DOCX only, at most 5 and at most 10 MB in total, without duplicates; by default the draft SHALL attach the approved CV variant's PDF of the application. (Source: 09 §5.3, §8)

#### Scenario: Body too large
- **WHEN** `body_text` exceeds 20,480 bytes of UTF-8
- **THEN** the response is 400 `invalid_request` on `body_text`

#### Scenario: Six attachments
- **WHEN** a draft lists six attachment file ids
- **THEN** the response is 400 `invalid_request` on `attachment_file_ids`

#### Scenario: Foreign or non-PDF attachment
- **WHEN** a draft lists another user's file, a file over the 10 MB total, or a PNG
- **THEN** the response is 422 `policy_violation` with `attachment_unavailable`, `attachments_too_large` or `attachment_type`

### Requirement: Optional AI paragraph without fabrication
When the user asks for `draft_paragraph` on a templated body, the api SHALL request `{paragraph ≤ 600, source_bullet_ids, source_fact_keys}` from the Responses API through the `AiProvider` with `store: false`, and the paragraph MUST pass the no-fabrication validator against the cited CV bullets and facts; on any failure the draft SHALL contain no paragraph and the review SHALL say so; the approval payload SHALL record `ai_drafted`, and AI spend SHALL be recorded in the same batch as the draft. (Source: 09 §5.2; 08 §4.4; D-12; D-34; T9-09)

#### Scenario: Fabricated number
- **WHEN** the model's paragraph names a number, employer or skill that no cited bullet or fact contains
- **THEN** the draft is created without the paragraph and the review reports the validation failure

#### Scenario: Paragraph with a hand-written body
- **WHEN** a draft sets both `draft_paragraph` and `body_text`
- **THEN** the response is 400 `invalid_request`

### Requirement: Approval bound to the exact content
Every email application SHALL need one `submit` approval whose `payload_hash` is the SHA-256 of the canonical `{to, cc, subject, body_text, attachments[sha256]}`; the approve call MUST echo the reviewed `payload_hash`, a mismatch MUST be refused with 409 `revision_conflict` (`details.reason = "payload_hash_mismatch"`), any change after approval MUST invalidate it, and a newer draft SHALL expire the pending approvals of the application's earlier drafts. (Source: 09 §4; 03 §8; T9-02)

#### Scenario: Stale hash
- **WHEN** the approve request carries a hash computed before the subject was edited
- **THEN** the response is 409 `revision_conflict` with the current `payload_hash`

#### Scenario: Superseded draft
- **WHEN** a second draft is created for the same application
- **THEN** the first draft's pending approval becomes `expired`

### Requirement: Only the user approves
Approving an email MUST require `automation:manage` (web BFF session or interactive CLI step-up); MCP clients SHALL be able to draft with `jobs:write` but MUST NOT approve, and an MCP draft records no recipient tick; an approval MUST be refused with 422 `invalid_transition` (`submission_in_flight`) while a browser submission for the same application is past `submit_intent`. (Source: 09 §4; 05 §1.2; 06 §11; D-28; T9-03)

#### Scenario: MCP approve attempt
- **WHEN** an MCP OAuth token (or a write personal token) calls `POST /api/v1/emails/{eml_id}/approve`
- **THEN** the response is 403 `insufficient_scope` with `scope: "automation:manage"` and the email stays `draft`

#### Scenario: MCP decision from the approval queue
- **WHEN** an MCP client decides an email's approval with `approve`
- **THEN** it is refused with 422 `policy_violation` (`mcp_cannot_approve_email`), while a `reject` decision is accepted

#### Scenario: Browser submission in flight
- **WHEN** the application has a live apply task past `submit_intent`
- **THEN** approving its email is refused with 422 `invalid_transition`

### Requirement: Local hand-off delivery
`local_handoff` SHALL be the default delivery: approving it SHALL set the email to `approved` and the application's submission to `in_progress`; the user then sends from their own mail client, and `POST /api/v1/emails/{eml_id}/handed-off` with `sent_confirmed: true` SHALL in one batch set the email `handed_off` (final), store evidence `email_sent` with verdict `unverified`, set the submission to `submitted_unverified` and move the stage to `applied` with actor `user`; `sent_confirmed: false` SHALL keep the email `approved` and set the submission to `failed`. (Source: 09 §2, §6.1, §9; 03 §5.1–§5.2; D-18; S-25)

#### Scenario: User confirms sending
- **WHEN** the CLI or web reports `sent_confirmed: true` for an approved hand-off
- **THEN** the email is `handed_off`, the evidence verdict is `unverified`, the application is `submitted_unverified` and `applied`

#### Scenario: Not approved yet
- **WHEN** `handed-off` is called for a draft without a valid approval of its current content
- **THEN** the response is 409 `revision_conflict` (`not_approved` or `approval_invalidated`)

#### Scenario: User says not sent
- **WHEN** `sent_confirmed: false` is reported
- **THEN** the email stays `approved` (re-sendable) and the submission becomes `failed`

### Requirement: Web .eml download and mailto fallback
For an approved or handed-off `local_handoff` draft the `apps/jobs` BFF SHALL serve `GET /download/applications/{app}/emails/{eml}.eml`: an RFC 5322 message (CRLF, `X-Unsent: 1`, RFC 2047 subjects, multipart/mixed with base64 parts) whose `From` is the user's `contact.email` fact else the session email, with every attachment fetched server-side and checked against its SHA-256; it SHALL also offer a `mailto:` link that pre-fills recipient, subject and body and tells the user to add attachments by hand. (Source: 09 §6.1; D-15)

#### Scenario: Attachment hash mismatch
- **WHEN** an attachment's bytes do not match its stored SHA-256
- **THEN** the `.eml` download is refused

#### Scenario: Draft not approved
- **WHEN** the `.eml` of an unapproved draft is requested
- **THEN** no message is built

### Requirement: CLI email commands
The CLI SHALL provide `pilih-jobs email draft <app_id> [--to] [--locale en|id] [--attach FILE_ID…]`, `email show <eml_id>`, `email approve <eml_id>` (shows the full content and attachment SHA-256 values before confirming), `email send <eml_id>` and `email confirm <eml_id> --sent|--not-sent`; `send` SHALL download each attachment with integrity checks into the run directory, abort on a SHA-256 mismatch, write an RFC 5322 `.eml` with `X-Unsent: 1`, open it with the OS handler (`open`, `os.startfile`, `xdg-open`) and ask "Did you send it?", leaving the email `approved` and printing instructions when not interactive. (Source: 09 §6.1, §10; 16 §3.3; T9-04, T9-05, T9-06)

#### Scenario: Integrity failure
- **WHEN** a downloaded attachment's SHA-256 differs from the draft
- **THEN** `pilih-jobs email send` aborts without opening the mail client or reporting a hand-off

#### Scenario: Non-interactive send
- **WHEN** `email send` runs without a terminal
- **THEN** the `.eml` is written, nothing is reported to the api and the recipient, subject and attachment paths are printed

### Requirement: Web email composer
The Apply tab of `apps/jobs` SHALL offer an email composer that shows recipient hints (employer domain, free-mail scam warning, other domain) and requires the tick where the api does, renders the en / id template from the user's facts, limits attachments to 5 approved files and the body to 20 KB, approves a draft only after showing its exact content and sending the pending approval's `payload_hash`, and for an approved hand-off offers the `.eml` download, the `mailto:` fallback and "I sent it" / "Not sent". (Source: 09 §1, §6.1; 12 Apply tab)

#### Scenario: Free-mail recipient in the composer
- **WHEN** the user enters a free-mail address
- **THEN** a scam warning appears and the draft cannot be saved or approved until the tick is given

### Requirement: Server send behind a flag
`server_send` MUST be available only while `JOBS_EMAIL_SERVER_SEND_ENABLED` is on in `DB.feature_flags` (drafting or approving it otherwise is 422 `policy_violation`, `server_send_disabled`); a `server_send` draft SHALL be approved and sent in one `POST …/approve` request (not from the approval queue), and after the provider returns the email status, approval, evidence `email_sent` (`verified` = provider accepted), submission `submitted_verified`, stage `applied` and events SHALL be written in one batch, while a provider failure SHALL record `failed` without a stage change. (Source: 09 §2, §3, §6.2; D-33; A-03; T9-07)

#### Scenario: Flag off
- **WHEN** a draft asks for `delivery: "server_send"` while the flag is dark
- **THEN** the response is 422 `policy_violation` with `reason: "server_send_disabled"`

#### Scenario: Provider failure
- **WHEN** the `EMAIL` binding rejects the message
- **THEN** the email is `failed`, the submission is `failed` and the stage is unchanged

#### Scenario: Approve from the queue
- **WHEN** a `server_send` draft's approval is decided through `POST /api/v1/approvals/{id}/decide`
- **THEN** the response is 422 with `reason: "approve_on_email"` and the approval stays pending

### Requirement: Server send sender identity
A server-sent application MUST come `From` `applications@pilihpendidikan.com` with the display name "<Full Name> via pilihpendidikan" (cleaned so it can never contain an address, "An applicant" when no name), MUST NOT put the user's address in `From`, SHALL set `Reply-To` and `Cc` to the verified `users.email` (never a typed fact), SHALL send to one recipient with no BCC in plain text without tracking, SHALL refuse pilihpendidikan's own domain as recipient, and SHALL re-hash every attachment read from R2 against `files.sha256` before sending. (Source: 09 §5.3, §6.2, §7; T9-07)

#### Scenario: Sender headers
- **WHEN** a flagged-on server send is approved
- **THEN** the provider receives `From: <Name> via pilihpendidikan <applications@pilihpendidikan.com>` and `Reply-To` / `Cc` equal to the account email

#### Scenario: Corrupted attachment
- **WHEN** an R2 object's SHA-256 differs from its file row
- **THEN** nothing is sent

### Requirement: Server send abuse limits
Before sending, the api MUST refuse with 422 `policy_violation` when the user already has 10 sent emails in the last 24 hours (`daily_limit`), 50 in the last 30 days (`monthly_limit`), 3 to the same recipient registrable domain in 30 days (`domain_limit`), or when the account is younger than 7 days (`new_account`). (Source: 09 §8; S-26)

#### Scenario: Eleventh email in a day
- **WHEN** a user with 10 server-sent emails in the last 24 hours approves another
- **THEN** the response is 422 `policy_violation` with `reason: "daily_limit"` and nothing is sent

#### Scenario: New account
- **WHEN** an account created 3 days ago approves a server send
- **THEN** the response is 422 with `reason: "new_account"` and `available_at`
