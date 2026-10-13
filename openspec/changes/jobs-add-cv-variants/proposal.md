# Change: Add job-specific CV variants, R2 files and private tailored CVs

## Why

An application needs a CV fitted to the job, produced by the existing CV
engine rather than a second one, reviewed by a human before an employer sees
model-written text, rendered to the same PDF the CV builder's "Download PDF"
button produces, and stored where only its owner can reach it. Today the CV
engine renders client-side only, there is no copy or tailoring operation, no
file storage, and every CV document is publicly readable by id
(`job-tracker-spec/08` §1, §9).

## What Changes

- **CV variants** (`/api/v1/applications/{app_id}/cv-variants`,
  `/api/v1/cv-variants/*`, `/api/v1/cvs`): a variant is created from one of the
  user's base CVs either as a plain copy (milestone M3, no AI) or tailored by
  AI (`tailor: true`, needs `ai:invoke`, AI consent and budget). Creation
  moves the application `saved → preparing` and supersedes older in-flight
  variants (08 §4.1, §10).
- **Tailoring consumer** (`tailor_cv` on the `jobs-ai` queue): bullet
  provenance (`flattenCvBullets`), Responses API Structured Outputs into a
  strict `CvTailoringPatch` (`store: false`), the no-fabrication validator
  V1–V10 with one repair round and keep-fallbacks, `applyPatch` +
  `CVDataSchema`, a deterministic HMAC slug `<base>-t-<10 base32>`, the
  stored diff (08 §4.5) and a delayed render check that creates a
  `render_cv` task when no browser rendered within 2 minutes (08 §4).
- **Rendering in a browser runtime** (D-14): the chrome-free `apps/jobs` route
  `/render/cv/$cvvId` renders with `@pilihpendidikan/cv-engine/pdf`, hashes
  and uploads the PDF with a single-use 120 s render ticket (08 §6, PLAN C8);
  the application detail CV tab renders `generating` variants in place
  (08 §6.2); the CLI renders headless through the same page for `render_cv`
  tasks (08 §6.3).
- **Approval**: approve / reject bound to
  `payload_hash = sha256(file.sha256 + canonical diff)`; a re-render
  invalidates it; auto-approve only for pure selection in an activated `auto`
  rule with `require_cv_approval = false` (08 §7). "Edited after approval"
  detection (08 §5).
- **Files on R2** (D-05, `JOBS_FILES`): multipart upload streamed to R2 with
  an incremental SHA-256, per-kind content-type, size and magic-byte checks,
  the `u/{user_id}/{kind}/{fil_id}{ext}` key layout, owner-only download with
  `ETag` = sha256 and `Cache-Control: private, no-store`, delete, and the
  daily retention cron (14 §5).
- **Private CVs** (D-25): tailored documents are written
  `visibility: "private"`; the public JSON route and the `.pdf` print redirect
  answer 404 to everyone but the owner (no admin bypass); `-t-` slugs carry
  `X-Robots-Tag: noindex`; existing CVs keep today's public behaviour.
- **Web and CLI surfaces**: the application detail CV tab (variant picker,
  side-by-side diff with sources, approve `Y` / reject / regenerate /
  download); CLI `pilih-jobs cv list|generate|show|review|download|render`
  with SHA-256 + ETag verification and staging cleanup (08 §8).

The work is implemented in the working tree of this repository. It is not
committed, not deployed, and no Cloudflare resource (R2 bucket, queue) has
been created.

## Impact

- Affected specs: `jobs-cv-variants` (new), `jobs-files` (new), `cv-engine`
  (ADDED: private visibility, D-25; the base `cv-engine` capability is added
  by `cv-extract-cv-engine`).
- Affected code:
  - `apps/api/src/jobs/{routes,services,repo}/cv/**`,
    `apps/api/src/jobs/services/cv/tailoring/**`,
    `apps/api/src/jobs/queue/handlers/tailor-cv.ts`
  - `apps/api/src/jobs/{routes,services,repo}/files/**`,
    `apps/api/src/jobs/cron/handlers/file-retention.ts`
  - `apps/api/src/documents/{cv-create.ts,handlers.ts,kinds.ts}`,
    `apps/api/src/routes/documents.ts`, `apps/api/src/tools/cv-management.ts`
  - `packages/jobs-contracts/src/{cv-tailoring.ts,api/cv.ts,api/files.ts}`
  - `apps/jobs/src/routes/render.cv.$cvvId.tsx`,
    `apps/jobs/src/components/application/cv-*.tsx`,
    `apps/jobs/src/lib/{render-cv,render-bff,cv-diff}.ts`,
    `apps/jobs/src/hooks/use-cv-variant.ts`
  - `apps/jobs-cli/src/pilih_jobs/cv/**`, `apps/jobs-cli/src/pilih_jobs/cli/cv.py`,
    `apps/jobs-cli/src/pilih_jobs/browser/headless.py`,
    `apps/jobs-cli/src/pilih_jobs/tasks/` (the `render_cv` task)
  - `apps/api/wrangler.jsonc` (`JOBS_FILES` binding)
- Sources: `job-tracker-spec/08` (all), `05` §7, `14` §5–§6, `11` §4.3, §9,
  `21` §4 (render_cv tasks), `12` (CV tab); decisions D-05, D-14, D-25, D-06,
  D-12, D-34; assumption A-02.
- Owner actions not taken: creating the R2 bucket
  `pilihpendidikan-jobs-files`, deploying `apps/api` / `apps/jobs`, the A-02
  render-equivalence check on real headless Chromium (13 §2 M3 exit
  criterion).
