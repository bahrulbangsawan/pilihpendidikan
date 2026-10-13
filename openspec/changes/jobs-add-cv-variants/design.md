## Context

The CV engine (`packages/cv-engine`, change `cv-extract-cv-engine`) is
Worker-safe in its core and browser-only in `./pdf`, because `@react-pdf`
compiles yoga-layout's WASM at runtime, which Workers forbid (08 §1). CV
documents live in `CV_KV` and were publicly readable by id. Milestone M3
(13 §2) adds variants, R2 and rendering; AI tailoring arrives with M4
(`jobs-add-matching` provides the provider, budget and consent it uses).

## Goals / Non-Goals

- Goals: one CV engine for builder, API and Job Tracker; no fabricated claim
  on an application; owner-only storage of tailored CVs and their PDFs; the
  same PDF bytes path for web and CLI rendering; every file integrity-checked
  end to end (SHA-256 at upload, ETag at download).
- Non-Goals: server-side PDF rendering; making every CV private by default
  (owner decision, 11 §4); presigned R2 URLs; editing entry-level CV fields
  through AI.

## Decisions

- **D-14 browser rendering.** PDFs are rendered by `renderCvPdfBlob` in a
  browser: in place on the CV tab (08 §6.2) or in the chrome-free
  `/render/cv/$cvvId` page, which the CLI opens headless for `render_cv`
  tasks (08 §6.3). The upload happens inside the page with the ticket's
  authority, so the CLI never handles the bytes or needs `files:write`.
- **Render tickets (PLAN C8).** 256-bit opaque values, SHA-256 stored in
  `AUTH_KV` `jobs:render-ticket:<sha256>` for 120 s, presented as
  `X-Render-Ticket` (no bearer) on exactly two calls, each once: the variant
  read with `?include=cv_data` and one `cv_pdf` upload linked to that
  variant. Anything else is `401 invalid_token`. KV is not transactional;
  the race window is accepted (blast radius: one variant).
- **D-05 Worker-mediated R2.** `POST /api/v1/files` streams multipart to R2
  through an inspector (DigestStream SHA-256, byte count, first 8 bytes);
  R2 also verifies the declared sha256. Key `u/{user_id}/{kind}/{fil_id}{ext}`
  makes account deletion one prefix sweep.
- **Deterministic tailored slug.** `<base>-t-<10 Crockford base32>` from
  HMAC-SHA256 of the variant id under a random server key kept in
  `AUTH_KV` `jobs:cv-slug-key`: unguessable (50 bits) and stable across
  queue retries (14 §6 idempotency).
- **D-25 privacy.** `visibility: "private"` on the stored CV; absent = public.
  A builder save that omits `visibility` keeps a private document private.
  No admin bypass for private CVs.
- **Fabrication validator (08 §4.4).** V1–V3 and V7–V9 failures reject the
  whole patch (one repair round with the violation list, then `failed`);
  V4/V5 failures fall back to `keep` for that bullet; a V6 summary failure
  keeps the existing summary. Tailored documents drop `photoUrl` (08 §9).
- **Approval binding (03 §8, 08 §7).** `payload_hash = sha256(file.sha256 +
  canonical diff JSON)`; approving or rejecting against another hash is
  `422 policy_violation` (`reason: payload_hash_mismatch`); a re-render
  creates a new pending approval. Approving needs a `draft` variant with a
  `ready` `cv_pdf` file (`422 invalid_transition`, `pdf_not_ready`); an
  expired approval is `410 approval_expired`. MCP decisions need the
  `allow_mcp_approvals` setting.

### Divergences from the spec text (code is authoritative)

- Validator path is `apps/api/src/jobs/services/cv/tailoring/validate.ts`
  (spec: `services/cv-tailoring/validate.ts`).
- Copy-only variants (`tailor: false`, model `copy`, prompt `copy-v1`) exist
  as the M3 "no AI" mode; `ai:invoke` is required only when `tailor: true`
  (05 §7 lists `cv:write + ai:invoke` for the AI case).
- Tailoring without AI consent is `422 policy_violation`
  (`reason: ai_consent_required`); with `AI_DISABLED` it is `503
  upstream_unavailable`.
- The render fallback is a delayed `tailor_cv` message (2 min) that creates
  the `render_cv` task if no PDF arrived, rather than a check for an open web
  session at tailoring time.
- `cv_pdf` uploads are capped at 5 MB (08 §6.5), other kinds at 25 MB (05 §7).

## Risks / Trade-offs

- `@react-pdf` in headless Chromium: memory/time → 60 s page timeout in
  `render_cv_page`; `render_failed` on timeout.
- V4 rejects some legitimate rephrasing → keep-fallback; cost is a weaker
  tailoring, never a false claim.
- Private CVs break public sharing of tailored documents by design; base CVs
  keep their behaviour.

## Migration Plan

No data migration: `visibility` is optional and absent on existing CVs. Owner
steps (not executed): create the R2 bucket `pilihpendidikan-jobs-files`
(14 §8), deploy `apps/api` then `apps/jobs`. Rollback: the variant routes sit
behind `JOBS_V1_ENABLED`; the private-CV read rule only affects documents
that carry `visibility: "private"`.

## Open Questions

- A-02: equivalence of the headless CLI render, the browser render and the
  `apps/cv` Download output on real Chromium (T8-03, a leaf-5.1 e2e item) is
  not yet proven.
- Whether all CVs should become private by default (11 §4, owner).
