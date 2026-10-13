## ADDED Requirements

### Requirement: Base CV listing
The API SHALL list the caller's own base CV documents at `GET /api/v1/cvs` with the `cv:read` scope, and SHALL only accept a base CV owned by the caller (owner stamp equal to the caller's email) when a variant is created. (Source: 05 §7; 08 §4.1)

#### Scenario: Another user's CV as base
- **WHEN** a user creates a variant with a `base_cv_id` owned by someone else
- **THEN** the response is `404 not_found` and no variant row is written

#### Scenario: Own CVs listed
- **WHEN** a signed-in user calls `GET /api/v1/cvs`
- **THEN** only CV documents stamped with that user's email are returned

### Requirement: CV variant creation
The API SHALL create a CV variant with `POST /api/v1/applications/{app_id}/cv-variants` (`cv:write`; `ai:invoke` as well when `tailor` is true) as a `generating` row answered with `202`, SHALL move the application `saved → preparing` as a system change, SHALL supersede the application's earlier in-flight variants, and SHALL support a copy-only mode (`tailor: false`, model `copy`) that uses no AI. (Source: 05 §7; 08 §4.1, §10; 13 §2 M3)

#### Scenario: Copy-only variant
- **WHEN** a user creates a variant with `tailor: false` and template `harvard`
- **THEN** the variant is `generating` with model `copy`, and the queued `tailor_cv` message copies the base CV into a private tailored document without calling an AI provider

#### Scenario: Tailoring without ai:invoke
- **WHEN** a token without `ai:invoke` creates a variant with `tailor: true`
- **THEN** the response is `403 insufficient_scope`

#### Scenario: Tailoring without AI consent or with AI disabled
- **WHEN** the user has not turned on AI features, or the `AI_DISABLED` flag is on
- **THEN** the request fails with `422 policy_violation` (`reason: ai_consent_required`) or `503 upstream_unavailable` respectively, and nothing is enqueued

### Requirement: Tailoring pipeline
The `tailor_cv` queue consumer SHALL load the base CV with an owner check, present the model only numbered bullets from `flattenCvBullets` plus entry headers without contact details or photo, fence the posting (≤ 12 KB) as untrusted data, request a strict `CvTailoringPatch` through Responses API Structured Outputs with `store: false`, and SHALL record the AI usage in the same batch as the result so a redelivered message never counts twice. (Source: 08 §4.1–§4.3; 14 §6; D-12)

#### Scenario: Budget exhausted at tailoring time
- **WHEN** the user's D-34 AI budget is exhausted when the message is processed
- **THEN** the variant becomes `failed` and the message is acked without an AI call

#### Scenario: Redelivered message
- **WHEN** the same `tailor_cv` message is delivered twice
- **THEN** the completion update applies once (`generating` with no tailored document yet) and the usage counters increase once

### Requirement: No-fabrication validator
The tailoring consumer MUST validate every patch with rules V1–V10: entries and source bullets must exist and belong to their entry (V1, V2), kept text must equal its source (V3), rephrased or merged text must add no new number, date, proper noun or dictionary skill term (V4) and stay within 1.3 × the source length (V5), the summary must pass V4 against its cited bullets, facts and the existing summary (V6), skills may only be reordered or dropped (V7), entry-level fields and `personalInfo` are copied from the base (V8, V9) with at least one experience or education entry kept, and `notes_for_user` never becomes CV content (V10). V1–V3 and V7–V9 failures SHALL reject the patch after one repair round-trip with the violation list; a bullet failing V4/V5 SHALL fall back to `keep`, and a summary failing V6 SHALL keep the existing summary. (Source: 08 §4.4; T8-04, T8-05, T8-06)

#### Scenario: Inflated number
- **WHEN** the model rephrases "Cut costs by 10%" as "Cut costs by 30%"
- **THEN** the bullet falls back to the source text and the diff counts one fallback

#### Scenario: Invented entry
- **WHEN** the patch names an `entry_id` that does not exist in the base CV, and the repair round repeats the error
- **THEN** the variant becomes `failed` and no tailored document is kept

#### Scenario: Injection posting
- **WHEN** the posting text instructs the model to add "PhD from MIT"
- **THEN** no patch introducing that degree passes V4/V6

### Requirement: Tailored CV document
The tailored CV SHALL be an ordinary CV document created through the shared `createCvDocument` code path (the same one MCP `cv_create` uses), stored private (D-25) without the photo, in the variant's template, under the slug `<base_cv_id>-t-<10 lowercase Crockford base32>` derived from an HMAC of the variant id under a server key, so a retried message rewrites the same document. (Source: 08 §5, §9; 14 §6; T8-07)

#### Scenario: Retry rewrites the same slug
- **WHEN** a `tailor_cv` message is retried after the document was saved
- **THEN** the same `-t-` slug is overwritten and no second document is created

#### Scenario: Edited after approval
- **WHEN** the owner edits an approved tailored CV in the CV builder
- **THEN** the variant detail reports `edited_after_approval: true` and the approved PDF stays attached until a re-render and re-approval (T8-12)

### Requirement: Tailoring diff
Each tailored variant SHALL store a diff with the prompt version, model, section order from/to, excluded entries, every bullet with its operation and source bullets, the summary from/to with sources, `notes_for_user` and the validator fallback count, and SHALL record a canonical SHA-256 of the tailored document. (Source: 08 §4.5, §10)

#### Scenario: Diff shown for review
- **WHEN** a variant reaches `draft`
- **THEN** `GET /api/v1/cv-variants/{cvv_id}` returns the diff with each bullet's sources

### Requirement: Render tickets
The API SHALL issue a single-use render ticket with `POST /api/v1/cv-variants/{cvv_id}/render-ticket` to the web session (`cv:write`) or to a device holding a live lease on that variant's `render_cv` task, store only its SHA-256 in `AUTH_KV` for 120 s, and SHALL accept it as `X-Render-Ticket` (without a bearer) only once for reading that variant with `?include=cv_data` and once for uploading one `cv_pdf` linked to that variant; any other use SHALL be `401 invalid_token`. (Source: 08 §6.4; 05 §7; PLAN C8; T8-08)

#### Scenario: Ticket reuse
- **WHEN** the render page reads the variant twice with the same ticket
- **THEN** the second read is `401 invalid_token`

#### Scenario: Ticket for another variant
- **WHEN** a ticket issued for variant A is used to upload a PDF linked to variant B
- **THEN** the upload is refused with `401 invalid_token`

### Requirement: Browser-runtime rendering
PDFs of CV variants SHALL be rendered only in a browser runtime with `@pilihpendidikan/cv-engine/pdf`: the application detail CV tab SHALL render a `generating` variant that has a tailored document and no file in place, and the chrome-free `apps/jobs` route `/render/cv/$cvvId` SHALL read the variant with its ticket, render, compute the SHA-256, upload, remove the ticket from the URL and set `window.__PILIH_RENDER__` to `{status: "done", file_id, sha256}` or `{status: "error", message}`, serving `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and a strict CSP. (Source: 08 §6.1, §6.2; D-14; TW-RENDER)

#### Scenario: Headless caller waits for the result
- **WHEN** the render page finishes uploading
- **THEN** `window.__PILIH_RENDER__.status` is `done` with the uploaded file id and SHA-256

#### Scenario: Ticket scrubbed
- **WHEN** the page loads with `?ticket=`
- **THEN** the ticket is removed from the address with `history.replaceState` before any other work

### Requirement: Render fallback task
When no browser has rendered a tailored variant two minutes after tailoring, the API SHALL create one `render_cv` automation task for any device with the `render_cv` capability, and the CLI worker SHALL execute it by obtaining a render ticket and loading `/render/cv/{cvv_id}?ticket=…` in headless Chromium with an ephemeral profile, waiting up to 60 s for `window.__PILIH_RENDER__`, and reporting `render_failed` on error or timeout. (Source: 08 §4.1 step 8, §6.3; 21 §4; TWK-RENDER)

#### Scenario: Unattended render
- **WHEN** a variant has a tailored document but no PDF two minutes after tailoring
- **THEN** exactly one queued `render_cv` task exists for it

#### Scenario: Render page error
- **WHEN** the render page reports `{status: "error"}`
- **THEN** the CLI reports the task as failed with `error_class = render_failed`

### Requirement: Variant approval
Approving or rejecting a variant (`POST /api/v1/cv-variants/{cvv_id}/approve|reject`, `cv:write`) SHALL be bound to `payload_hash = sha256(file.sha256 + canonical diff)`; approval SHALL require a `draft` variant with a `ready` `cv_pdf` file, SHALL set `applications.cv_variant_id`, record `cv_variant_attached`, and move `preparing → ready` when the rule says so; a hash that no longer matches SHALL be refused with `422 policy_violation` (`payload_hash_mismatch`), and a re-render SHALL invalidate the previous approval. (Source: 08 §7, §10; 03 §8; T8-10)

#### Scenario: Re-render invalidates approval
- **WHEN** the PDF is re-rendered after the user opened the approval
- **THEN** approving with the old `payload_hash` is refused and a new pending approval exists

#### Scenario: Approve before render
- **WHEN** the user approves a variant that has no ready PDF
- **THEN** the response is `422 invalid_transition` with `reason: pdf_not_ready`

### Requirement: Auto-approval limits
A rendered variant SHALL be approved without a human only when its application's rule is an enabled, activated `auto` rule with `cv_policy.require_cv_approval = false`, the `JOBS_AUTO_MODE_ENABLED` flag is on, and the diff contains no `rephrase` or `merge` operation; otherwise a `cv_variant` approval SHALL be required. (Source: 08 §7; T8-13)

#### Scenario: Rephrased bullets need a human
- **WHEN** an auto-mode variant's diff contains one `rephrase`
- **THEN** a pending `cv_variant` approval is created instead of auto-approval

### Requirement: Web CV tab
The application detail CV tab in `apps/jobs` SHALL let the user pick a base CV and template, create, regenerate, approve (`Y`, with confirmation) or reject (with a reason) a variant, show a side-by-side diff with each bullet's sources, excluded entries struck through and `notes_for_user` as warnings, and preview the PDF through the BFF download route. (Source: 08 §7; 12 (CV tab); TW-CVDIFF)

#### Scenario: Reviewing a draft
- **WHEN** a `draft` variant is open in the CV tab
- **THEN** the diff, the warnings and the PDF preview are shown and Approve sends the pending approval's `payload_hash`

### Requirement: CLI CV commands
The CLI SHALL provide `pilih-jobs cv list|generate|show|review|download|render`; `cv download` SHALL stream the file to staging or `--out`, verify the SHA-256 against `files.sha256` and the `ETag`, delete the file on a mismatch with `error_class = artifact_integrity`, present it as `<Full Name> - CV - <Company>.pdf` sanitized to `[A-Za-z0-9 ._-]`, and clean staging when the attempt ends; `generate` and `review --approve|--reject` SHALL require the `cv:write` step-up. (Source: 08 §7, §8; 16 §3.3; T8-11)

#### Scenario: Tampered download
- **WHEN** the downloaded bytes do not match the recorded SHA-256
- **THEN** the file is deleted and the command fails with `artifact_integrity`
