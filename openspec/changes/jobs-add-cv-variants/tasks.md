## 1. Contracts

- [x] 1.1 `CvTailoringPatch` + its strict JSON schema, `CvBullet`, the 08 §4.5 diff shape and `TAILOR_PROMPT_VERSION` in `packages/jobs-contracts/src/cv-tailoring.ts`; CV / files route schemas in `packages/jobs-contracts/src/api/` (`CV_PDF_MAX_BYTES`, `FILE_UPLOAD_MAX_BYTES`) — TC-TAILOR-SCHEMA (leaf-1.1 G1 verified)

## 2. Files on R2 (`apps/api`)

- [x] 2.1 Kind rules, key layout, magic bytes and retention defaults: `apps/api/src/jobs/services/files/policy.ts`
- [x] 2.2 Streamed multipart upload with SHA-256 / size / magic inspection and one-batch ready transition: `apps/api/src/jobs/routes/files/upload.ts`, `services/files/{multipart,inspect,sha256}.ts`, `repo/files/index.ts` — TF-UPLOAD, T8-09
- [x] 2.3 Metadata, content download (ETag, no-store, attachment, nosniff, 304, screenshot ranges) and delete: `routes/files/index.ts`, `services/files/download.ts` — TF-DOWNLOAD, TF-DELETE
- [x] 2.4 Daily retention cron: `services/files/retention.ts`, `cron/handlers/file-retention.ts` — TF-RETENTION (`repo/files/retention.test.ts`)
- [x] 2.5 `JOBS_FILES` binding in `apps/api/wrangler.jsonc` and the in-memory R2 fake in `apps/api/test/fakes.ts`

## 3. CV variants and tailoring (`apps/api`)

- [x] 3.1 `GET /api/v1/cvs`, variant create (copy-only and tailored), detail (`?include=cv_data` under a ticket), approve, reject: `apps/api/src/jobs/routes/cv/index.ts`, `services/cv/{variants,base-cvs}.ts`, `repo/cv/index.ts` — TCV-LIST, TCV-APPROVE
- [x] 3.2 `tailor_cv` consumer (bullets, fenced posting, Structured Outputs `store: false`, repair round, usage in the same batch, delayed render check): `queue/handlers/tailor-cv.ts`, `services/cv/tailoring/{run,prompt,apply,tokens}.ts` — S-10 (component test in `routes/cv/cv.test.ts`)
- [x] 3.3 Validator V1–V10 with keep-fallbacks: `services/cv/tailoring/validate.ts` — T8-04, T8-05, T8-06 (`validate.test.ts`)
- [x] 3.4 Deterministic HMAC slug and canonical document hash: `services/cv/{slug,canonical}.ts` — T8-07
- [x] 3.5 Render tickets (KV hash, 120 s, single read + single upload): `services/cv/ticket.ts` — T8-08
- [x] 3.6 Approval `payload_hash`, re-render invalidation, auto-approve rule, edited-after-approval: `services/cv/variants.ts` — T8-10, T8-12, T8-13
- [x] 3.7 `render_cv` fallback task after 2 minutes: `ensureRenderFallbackTask` in `services/cv/variants.ts` — TCV-RENDER-TASK
- [x] 3.8 All of section 3 verified by the leaf-2.6 gate (`api-cv` suite, ≥ 60 tests incl. T8-04…T8-13 and S-10; status.log "leaf-2.6 VERIFIED")

## 4. Private CVs (D-25)

- [x] 4.1 Shared `createCvDocument` (also used by MCP `cv_create`) and visibility helpers: `apps/api/src/documents/cv-create.ts`, `apps/api/src/tools/cv-management.ts`
- [x] 4.2 Owner-only reads, refused print redirect, privacy kept on save, `noindex` for `-t-` slugs: `apps/api/src/documents/handlers.ts`, `apps/api/src/routes/documents.ts` — TCV-PRIVATE (`documents/cv-private.test.ts`)
- [x] 4.3 Optional `visibility` field on the CV type and schema: `packages/cv-engine/src/{types,schema}.ts` (leaf-1.2 G1 verified)

## 5. Web (`apps/jobs`)

- [x] 5.1 Chrome-free render route with ticket mode, SHA-256, upload, `window.__PILIH_RENDER__` and no-store / no-referrer / noindex / strict CSP: `apps/jobs/src/routes/render.cv.$cvvId.tsx`, `src/lib/{render-cv,render-bff}.ts`, `src/functions/render.functions.ts`, `src/lib/edge-policy.ts` — TW-RENDER
- [x] 5.2 CV tab: variant panel, side-by-side diff with sources, approve `Y` / reject / regenerate / download, in-browser render of `generating` variants: `src/components/application/{cv-tab,cv-variant-panel,cv-diff-view}.tsx`, `src/hooks/use-cv-variant.ts`, `src/lib/cv-diff.ts` — TW-CVDIFF (leaf-3.2 G1 verified)

## 6. CLI (`apps/jobs-cli`)

- [x] 6.1 `cv list|generate|show|review|download|render` with the `cv:write` step-up: `src/pilih_jobs/cli/cv.py`, `src/pilih_jobs/cv/{variants,download}.py` — TCMD-CV
- [x] 6.2 Download verification (SHA-256 + ETag, delete on mismatch, presentable name, staging cleanup): `src/pilih_jobs/cv/download.py` — T8-11
- [x] 6.3 `render_cv` task execution through `render_cv_page` (ephemeral headless profile, 60 s wait for `__PILIH_RENDER__`): `src/pilih_jobs/browser/headless.py`, `src/pilih_jobs/tasks/` — TWK-RENDER (leaf-4.4 G1 verified; the headless browser path itself is exercised by leaf-4.3's browser tests)

## 7. Owner handoffs and open verification

- [x] 7.1 Handoff recorded (NOT executed — owner action): create the R2 bucket `pilihpendidikan-jobs-files` and its abort-incomplete-multipart lifecycle rule (14 §5.4, §8); nothing was created
- [x] 7.2 Handoff recorded (NOT executed — owner action): deploy `apps/api` and `apps/jobs` with these routes; no deploy happened
- [x] 7.3 Handoff recorded (NOT executed — leaf-5.1 / owner): S-09 and T8-03 (A-02 render equivalence of headless CLI render vs browser render vs `apps/cv` Download on real Chromium) are full-stack e2e items; the `e2e/` suite does not exist yet, so A-02 is unproven
- [x] 7.4 Handoff recorded (NOT executed — owner decision): whether every CV should be private by default (11 §4); this change keeps existing CVs public
