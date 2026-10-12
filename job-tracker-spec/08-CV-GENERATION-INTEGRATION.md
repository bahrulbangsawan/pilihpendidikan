# 08 — CV Generation Integration

This document specifies how the Job Tracker produces a **job-specific CV** with
the existing `apps/cv` engine without duplicating it (mandatory decision 7). It
covers extracting the engine into `packages/cv-engine`, the constrained AI
tailoring pipeline (no fabrication), creating the tailored CV document, PDF
rendering in a browser runtime, approval, R2 storage, secure download to the
CLI, and the privacy consequences of today's public-by-id CV documents.

Legend: `00-README.md` §2. Tables: `cv_variants`, `files` (04 §2.5).
Endpoints: 05 §7. Decision: **D-14**.

---

## 1. Verified current state of the CV engine

| Fact | Evidence |
|---|---|
| **[VERIFIED]** The canonical CV type `CVData` lives inside the 2,078-line form component, with entry types `PersonalInfo`, `ExperienceEntry`, `EducationEntry`, `SkillCategory`, `AwardEntry`, `CertificateEntry`, `LanguageEntry`, `ProjectEntry`, `VolunteerEntry`, and `CVStyle = "basic" \| "harvard" \| "simple" \| "standard"` | `apps/cv/src/components/cv-form.tsx:65-254` (`CVData` at `:226-254`, `CVStyle` at `:207`) |
| **[VERIFIED]** A second, hand-maintained copy of the type exists in the API, with different default section titles; nothing enforces parity | `apps/api/src/types.ts:1-152` |
| **[VERIFIED]** There is no whole-document schema. REST validation only checks `personalInfo` is an object and `sectionOrder` an array. Per-entry Zod schemas exist only for MCP tool inputs. | `apps/api/src/documents/kinds.ts:52-57`, `apps/api/src/schemas.ts:42-164` |
| **[VERIFIED]** Four `@react-pdf` templates, each with an HTML preview twin kept in sync by hand | `apps/cv/src/components/templates/{basic,harvard,simple,standard}-{pdf,preview}.tsx` |
| **[VERIFIED]** The PDF dispatcher `CVDocument({data, style})` defaults to basic | `apps/cv/src/components/cv-pdf.tsx:7-18` |
| **[VERIFIED]** "Download PDF" renders **client-side only**: it returns under SSR, then dynamic-imports `@react-pdf/renderer` and calls `pdf(<CVDocument …/>).toBlob()`. A comment says the renderer "must not enter the Workers SSR module graph". | `apps/cv/src/components/cv-generator.tsx:326-351` |
| **[VERIFIED]** `/cv/:slug.pdf` is **not** a PDF renderer. It 302s to `?cv=<slug>&print=1`, which renders the HTML preview and calls `window.print()` | `apps/api/src/documents/handlers.ts:161-177`, `apps/cv/src/components/cv-generator.tsx:664-700` |
| **[VERIFIED]** Templates use built-in Helvetica (no `Font.register`). The photo is a data URL produced in the browser. | apps/cv audit (`basic-pdf.tsx`, `lib/preprocess-image.ts:33-77`) |
| **[VERIFIED]** `formatCvMarkdown(data)` is a pure Markdown export | `apps/cv/src/lib/cv-markdown.ts:109` |
| **[VERIFIED]** CV documents are stored in `CV_KV` as `cv:{id}`, owner stamp `owner:cv:{id}`. **Public read by id** with no auth (`GET /api/cv/:id`). | `apps/api/src/documents/handlers.ts:67-94` |
| **[VERIFIED]** **No REST create**: `PUT` on a missing id returns 404. Creation only through MCP `cv_create` (id defaults to `"default"`, refuses duplicates, writes the owner stamp). | `apps/api/src/documents/handlers.ts:96-113`, `apps/api/src/tools/cv-management.ts:75-101` |
| **[VERIFIED]** No copy/clone operation and no AI tailoring anywhere in code | apps/cv audit §4 |
| **[LIMITATION]** `@react-pdf/renderer` 4.9 depends on `yoga-layout` 3.2.1, which compiles WASM from a base64 blob at runtime. Workers forbid runtime WASM compilation, so it does not run in a Worker as shipped. | apps/cv audit §2 |

---

## 2. Decision D-14 and rejected alternatives

**[DECISION D-14]** Tailored CVs are produced by the **existing engine**,
extracted into `packages/cv-engine`. PDFs are rendered **in a browser runtime**:
either the `apps/jobs` page in the user's browser, or the CLI's headless
Playwright Chromium loading the same page. They are stored in R2 with a SHA-256.

| Alternative | Why rejected |
|---|---|
| Render `@react-pdf` inside the `apps/api` Worker | Runtime WASM compile blocked (§1). It would need a patched yoga import and a bundle-size review, and still risks the 128 MB memory limit. Can be revisited later as an optimization. |
| Cloudflare Browser Rendering | New paid product binding. It would render the **HTML print view**, which is a different output from the "Download PDF" button users already get. |
| `bun build --compile` sidecar shipped with the CLI | A second runtime and binary to sign and distribute per OS (22). The CLI already ships Chromium (D-22), which can run the same browser code. |
| Re-implement templates in Python (WeasyPrint/ReportLab) | Duplicates the engine. Forbidden by mandatory decision 7. |
| Use the print view (`window.print()`) via `page.pdf()` | Output differs from "Download PDF" and depends on web fonts and print CSS. The `@react-pdf` output is the user-facing artifact today. |

---

## 3. `packages/cv-engine` extraction

**[NEW]** OpenSpec change `cv-extract-cv-engine` (13 §2). It is a pure
refactor: **no visual or data change** in `apps/cv`.

### 3.1 What moves

| From | To | Notes |
|---|---|---|
| Types in `apps/cv/src/components/cv-form.tsx:65-254` | `packages/cv-engine/src/types.ts` | `cv-form.tsx` re-imports them. `apps/api/src/types.ts:1-152` is **deleted** and replaced by an import (closes the duplication drift). |
| — | `packages/cv-engine/src/schema.ts` | **[NEW]** Zod v4 `CVDataSchema` for the whole document. Entry schemas are moved from `apps/api/src/schemas.ts:42-164` and composed. Used by tailoring validation and by `/api/cv` PUT (tightening `kinds.ts:52-57` behind a flag first). |
| `apps/cv/src/components/templates/*-pdf.tsx`, `template-utils.ts` | `packages/cv-engine/src/pdf/` | Only `@react-pdf/renderer` primitives plus `ensureUrl` / `formatPhoneDisplay`. Those two helpers move into `packages/cv-engine/src/format.ts`, and `@rulisme/ui/lib/utils` re-exports them to avoid a dependency cycle. |
| `apps/cv/src/components/cv-pdf.tsx` | `packages/cv-engine/src/pdf/cv-document.tsx` | `CVDocument({data, style})` unchanged |
| `apps/cv/src/lib/cv-markdown.ts` | `packages/cv-engine/src/markdown.ts` | `formatCvMarkdown` unchanged |
| `*-preview.tsx` HTML previews | **stay in `apps/cv`** | They use Tailwind / `@rulisme/ui` chrome. `apps/jobs` shows the PDF itself (iframe of the rendered blob) rather than re-using the HTML previews. |

### 3.2 Exports

```ts
// packages/cv-engine (ESM, built with tsc; React 19 + @react-pdf/renderer as peerDependencies)
export type { CVData, CVStyle, CVSectionId, PersonalInfo, ExperienceEntry, /* … */ } from "./types";
export { CVDataSchema, DEFAULT_SECTION_ORDER, createEmptyCV } from "./schema";
export { CVDocument } from "./pdf/cv-document";         // "@pilihpendidikan/cv-engine/pdf" subpath (browser-only)
export { renderCvPdfBlob } from "./pdf/render";          // async (data, style) => Blob  (dynamic-imports @react-pdf)
export { formatCvMarkdown } from "./markdown";
export { flattenCvBullets, type CvBullet } from "./bullets"; // §4.2 provenance ids
```

- Subpath exports separate the Worker-safe core (`types`, `schema`,
  `markdown`, `bullets`) from the browser-only `pdf` subpath. `apps/api`
  imports **only** the core. A unit test asserts that the `apps/api` bundle
  contains no `@react-pdf` / `yoga-layout` module (prevents §1 limitation
  regressions).
- **Parity rule (kept):** `apps/cv/CLAUDE.md`'s rule that each `*-pdf.tsx` and
  its `*-preview.tsx` change together now spans two packages. The rule text and
  the PR checklist are updated, and a CI check fails if a commit touches
  `packages/cv-engine/src/pdf/<t>-pdf.tsx` without touching
  `apps/cv/src/components/templates/<t>-preview.tsx` (override label for
  intentional PDF-only fixes).

### 3.3 Consumers

| Consumer | Uses |
|---|---|
| `apps/cv` | types, schema, `CVDocument`, markdown (no behaviour change) |
| `apps/api` | types, schema, `flattenCvBullets`, markdown (tailoring prompt context, validation) |
| `apps/jobs` | types, `renderCvPdfBlob` on `/render/cv/$cvvId` and in the review UI |
| `apps/jobs-cli` | **nothing directly** (Python). It drives `apps/jobs` `/render/cv/$cvvId` in headless Chromium (§6.3). |

---

## 4. Tailoring pipeline

### 4.1 Flow

```text
user / rule: "Tailor CV for this application"
  │ POST /api/v1/applications/{app}/cv-variants {base_cv_id, template, tailor:true}   (cv:write + ai:invoke)
  ▼
apps/api: insert cv_variants(status='generating'); application stage saved→preparing (03 §5.1, system);
          enqueue JobsAiMessage{type:'tailor_cv'}  (14 §6)   (cv_variant_attached is written only on approval)
  ▼
jobs-ai consumer (07 §7.2):
  1. load base CVData (CV_KV cv:{base_cv_id}) — verify owner stamp == caller email (users.email)
  2. flattenCvBullets(base) → numbered source bullets  [b1..bn] with stable ids
  3. load posting (title, requirements, description ≤ 12 KB fenced as untrusted)
  4. Responses API Structured Outputs → CvTailoringPatch (§4.3), store:false
  5. validate patch (§4.4); on violation: one repair attempt with violation list; else status='failed'
  6. applyPatch(base, patch) → tailored CVData; CVDataSchema.parse
  7. create tailored CV doc in CV_KV (§5) ; cv_variants.tailored_cv_id, diff, model; status stays 'generating'
  8. create render need: if a web session is open → page renders (§6.2); else enqueue automation_tasks kind='render_cv' (target any device with 'render_cv')
  ▼
render (browser runtime) → POST /api/v1/files (kind cv_pdf, sha256) → cv_variants.file_id, status='draft'
  ▼
approval: approvals(kind='cv_variant') → user approves in web/CLI → status='approved', application.cv_variant_id set,
          event cv_variant_attached, stage preparing→ready when the rule says so (06 §3)
```

### 4.2 Bullet provenance

`flattenCvBullets(cv)` produces the only units the model may select or rephrase:

```ts
interface CvBullet {
  id: string;            // `${section}:${entryId}:${lineIndex}` e.g. "experience:exp-1:2"; summary → "summary:0:<sentenceIdx>"
  section: "summary"|"experience"|"projects"|"volunteer"|"awards"|"certificates";
  entry_id: string;      // existing entry id (ExperienceEntry.id …)
  text: string;          // one line of the entry description (split exactly like getDescriptionLines,
                         // apps/cv/src/components/templates/template-utils.ts:3-20)
}
```

Entries (companies, titles, dates, institutions, degrees, skills, languages,
certificates) are **not** bullets. They can be included, excluded or reordered,
never edited.

### 4.3 Structured Outputs schema (`CvTailoringPatch`)

**[VERIFIED]** Responses API Structured Outputs:
`text: { format: { type: "json_schema", name, schema, strict: true } }`, every
object `additionalProperties: false` with all fields `required`
(https://developers.openai.com/api/docs/guides/structured-outputs). Default
model `gpt-6.1-sol` ($2/$10 per M), configurable (`TAILOR_MODEL`).
`store: false` always.

```jsonc
{
  "name": "cv_tailoring_patch",
  "strict": true,
  "schema": {
    "type": "object", "additionalProperties": false,
    "required": ["section_order", "include_entries", "bullets", "summary", "skills_order", "notes_for_user"],
    "properties": {
      "section_order": { "type": "array", "items": { "enum": ["summary","experience","education","skills","awards","certificates","languages","projects","volunteer"] } },
      "include_entries": {                       // which existing entries to keep, in display order
        "type": "array",
        "items": { "type": "object", "additionalProperties": false, "required": ["section","entry_id"],
                   "properties": { "section": { "type": "string" }, "entry_id": { "type": "string" } } } },
      "bullets": {                               // per included entry: chosen bullets, each derived from ≥ 1 source bullet
        "type": "array",
        "items": { "type": "object", "additionalProperties": false,
                   "required": ["entry_id","text","source_bullet_ids","operation"],
                   "properties": {
                     "entry_id": { "type": "string" },
                     "text": { "type": "string", "maxLength": 300 },
                     "source_bullet_ids": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
                     "operation": { "enum": ["keep","reorder","rephrase","merge"] } } } },
      "summary": {
        "type": "object", "additionalProperties": false, "required": ["text","source_bullet_ids","source_fact_keys"],
        "properties": { "text": { "type": "string", "maxLength": 700 },
                        "source_bullet_ids": { "type": "array", "items": { "type": "string" } },
                        "source_fact_keys": { "type": "array", "items": { "type": "string" } } } },
      "skills_order": { "type": "array", "items": { "type": "string" } },   // existing skill items only
      "notes_for_user": { "type": "array", "items": { "type": "string", "maxLength": 200 } }  // e.g. "Posting asks for Kubernetes; not in your CV"
    }
  }
}
```

The system prompt (versioned, `tailor-prompt-v1`) states the rules from §4.4 and
fences the posting as untrusted data. The model sees the base CV only as
numbered bullets + entry headers (via `formatCvMarkdown`-style rendering with
ids). It never sees the photo or contact details.

### 4.4 Validator (no fabrication)

**[NEW]** `apps/api/src/jobs/services/cv-tailoring/validate.ts`. Every rule is
hard. A violation rejects the patch (one repair round-trip with the violation
list, then `failed`).

| # | Rule |
|---|---|
| V1 | Every `entry_id` in `include_entries` / `bullets` exists in the base CV in the named section |
| V2 | Every `source_bullet_ids` id exists and belongs to the same `entry_id` (summary may cite any bullet) |
| V3 | `keep`/`reorder` text equals the source bullet text exactly (whitespace-normalized) |
| V4 | `rephrase`/`merge` text introduces **no new tokens of these classes** compared with the union of its sources: numbers/percentages/currency amounts, dates/years, proper nouns (capitalized tokens not at sentence start), and technology/skill terms from the skills dictionary (07 §3) not present in the base CV |
| V5 | Length ratio: rephrased text ≤ 1.3 × combined source length |
| V6 | `summary.text` passes V4 against the union of its cited bullets, cited facts (`applicant_facts` values for `source_fact_keys`) and the existing summary |
| V7 | `skills_order` is a permutation of a subset of existing skill items (no new skills) |
| V8 | Entry-level fields (company, title, dates, institution, degree, GPA, certificate names, languages) are copied from the base CV, never taken from model output (the patch format cannot express them) |
| V9 | At least one experience or education entry remains; `personalInfo` is copied verbatim (except `photoUrl`, see §9) |
| V10 | `notes_for_user` never becomes CV content; it is shown in the review UI only |

**[DECISION]** V4 is conservative and may reject legitimate rephrasing (e.g. a
capitalized word mid-sentence). False rejections cost a retry. False acceptance
would be a fabricated claim on a job application. Rejected rephrases fall back
to `keep` for that bullet. The whole patch fails only if V1–V3 or V7–V9 fail.

### 4.5 Diff

`cv_variants.diff` stores:

```json
{ "prompt_version": "tailor-prompt-v1", "model": "gpt-6.1-sol",
  "section_order": { "from": [...], "to": [...] },
  "excluded_entries": [{ "section": "projects", "entry_id": "p-3", "label": "Old portfolio site" }],
  "bullets": [{ "entry_id": "exp-1", "operation": "rephrase", "text": "…", "sources": [{ "id": "experience:exp-1:2", "text": "…" }] }],
  "summary": { "from": "…", "to": "…", "sources": ["…"] },
  "notes_for_user": ["…"],
  "validator": { "fallbacks_to_keep": 2 } }
```

---

## 5. Creating the tailored CV document

**[DECISION]** The tailored CV is a **normal `apps/cv` document**. The user can
open it in the CV builder and edit it by hand, and the owner-facing surfaces
(CV builder load, MCP `cv_*` tools) work unchanged. Because tailored variants
are **private** (D-25, §9), the public JSON route answers `404` and the
`.pdf` print redirect is refused for anyone but the owner; the render page
reads the document through its render ticket (§6.4).

- Created through a new internal service `createCvDocument(caller, id, data)` in
  `apps/api/src/documents/cv-create.ts`. It is the **same function** MCP
  `cv_create` will call after a small refactor of
  `apps/api/src/tools/cv-management.ts:75-101` (KV `put` of `cv:{id}` +
  `owner:cv:{id}` stamp with the caller's email, duplicate refusal).
- **Slug:** `<base_cv_id>-t-<10 chars Crockford base32 random>`, e.g.
  `rahma-cv-t-7k2m9q4x1d`. It is unguessable (50 bits) as defence in depth:
  tailored variants are private (D-25), but ordinary CV documents are publicly
  readable by id (§9).
- `style` is set to the variant `template`. Section titles are copied from the
  base.
- The tailored document is **immutable from the Job Tracker's point of view**.
  If the user edits it in `apps/cv`, the variant shows "edited after approval"
  (detected by comparing a stored `sha256(canonical JSON)` with the current
  document), and the attached PDF stays the approved one until the user
  re-renders and re-approves.

---

## 6. Rendering

### 6.1 Render page

**[NEW]** `apps/jobs` route `/render/cv/$cvvId` (file
`apps/jobs/src/routes/render.cv.$cvvId.tsx`). It is a chrome-free client-only
page that:
1. authenticates with a **render ticket** (§6.4) from `?ticket=` or the BFF
   session,
2. fetches the tailored `CVData` and `template` through the BFF,
3. calls `renderCvPdfBlob(data, style)` from `packages/cv-engine`,
4. computes SHA-256 with `crypto.subtle.digest`,
5. uploads with `POST /api/v1/files` (`kind = cv_pdf`,
   `links.cv_variant_id`) through the BFF,
6. sets `window.__PILIH_RENDER__ = {status: "done", file_id, sha256}` (or
   `{status: "error", message}`) for headless callers, and shows "Rendered"
   for humans.

### 6.2 In-browser rendering (primary)

When the user is on the application detail page while a variant is
`generating` and `tailored_cv_id` is set, the page renders it inline (same
module as §6.1, no navigation) and uploads it. This is the common path in
`approval` / `assisted` flows, because the user is about to review it anyway.

### 6.3 Headless rendering by the CLI (fallback)

For unattended flows (`auto` mode, or approval via CLI only), the server creates
`automation_tasks(kind='render_cv', cv_variant_id)` (03 §7.1). A CLI device
with capability `render_cv` claims it (21) and:

```text
1. POST /api/v1/cv-variants/{cvv}/render-ticket  (automation:execute, lease-bound) → {ticket, url, expires_in: 120}
2. Playwright (headless, managed profile "render" — never a user's logged-in profile):
     page.goto("https://jobs.pilihpendidikan.com/render/cv/{cvv}?ticket=…")
     page.wait_for_function("window.__PILIH_RENDER__?.status", timeout=60_000)
3. read {status, file_id, sha256}; report task result succeeded / failed(error_class='render_failed')
```

The upload happens **inside the page** with the ticket's authority, so the PDF
bytes never pass through the CLI and the CLI needs no `files:write` for
rendering.

### 6.4 Render ticket

**[NEW]** Endpoint `POST /api/v1/cv-variants/{cvv_id}/render-ticket` (05 §7).
- Issued to the BFF (web) or to a device holding a live lease on the
  `render_cv` task.
- Opaque 256-bit value, stored hashed in `AUTH_KV`
  (`jobs:render-ticket:<sha256>` → `{user_id, cvv_id}`), TTL 120 s, **single
  use**.
- Authorizes exactly: read that variant's CVData and upload one `cv_pdf` file
  linked to that variant.
- `/render/cv/*` responses carry `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, a strict CSP and `X-Robots-Tag: noindex`.
  After the first request, `history.replaceState` removes the ticket from the
  URL.

### 6.5 Server-side checks on upload

`POST /api/v1/files` (05 §7) for `kind = cv_pdf`:
- magic bytes `%PDF-` and size ≤ 5 MB;
- `sha256` recomputed while streaming to R2;
- the linked variant is `generating` (or `draft` for a re-render) and belongs
  to the user.

On success: `files.status = 'ready'`, `cv_variants.file_id`,
`status = 'draft'`, an `approvals(kind='cv_variant')` row (unless the rule
auto-approves, §7), and `change_log` entries.

R2 key: `u/{user_id}/cv_pdf/{fil_id}.pdf` (04 §2.5). **[DECISION D-05]** All
access goes through `GET /api/v1/files/{id}/content`, never public R2 URLs.

---

## 7. Approval

- **Web:** application detail → "CV for this application" panel. It shows the
  PDF (object URL from `/files/{id}/content` via the BFF), a **diff view**
  (§4.5 rendered as side-by-side bullets with the source on hover, excluded
  entries struck through), `notes_for_user` as warnings, and **Approve** /
  **Reject** / **Open in CV builder**.
- **CLI:** `pilih-jobs cv review <app_id>` prints the diff in the terminal
  (Rich) and the PDF path after download (§8). `--approve` / `--reject`
  requires `cv:write` (05 §7), which the CLI requests as a step-up on first
  use (17 §5.1).
- **Auto-approve:** only when the application's rule is `mode = auto` **and**
  `cv_policy.require_cv_approval = false` **and** the validator reported zero
  `rephrase`/`merge` operations (pure selection/reordering). Otherwise approval
  is always required. **[DECISION]** Model-written sentences never reach an
  employer without a human having seen them.
- Approval binds `payload_hash = sha256(file.sha256 + diff canonical JSON)`
  (03 §8). Re-rendering invalidates the approval.

---

## 8. Download to the CLI

`pilih-jobs cv download <app_id|cvv_id> [--out PATH]` and, implicitly, the apply
executor (18 §8):

1. `GET /api/v1/cv-variants/{cvv}` → `{status, file_id, sha256}`. It must be
   `approved` for apply tasks. `cv download` also allows `draft`, with a
   warning.
2. `GET /api/v1/files/{file_id}/content` (`files:read`), streamed to
   `<data>/runs/<attempt_id>/staging/cv-<cvv>.pdf` (the apply staging dir,
   18 §8) or `--out`.
3. Verify SHA-256 equals `files.sha256` **and** the `ETag`. On mismatch, delete
   the file and fail with `error_class = 'artifact_integrity'`.
4. The file name presented to the employer is
   `<Full Name> - CV - <Company>.pdf`, sanitized to `[A-Za-z0-9 ._-]`. The
   staging copy is renamed; the bytes are unchanged.
5. Staging files are deleted when the attempt ends (success or failure).
   `--out` copies are the user's responsibility.

---

## 9. Privacy

- **[VERIFIED]** CV documents are **publicly readable by id**
  (`GET /api/cv/:id`, `apps/api/src/documents/handlers.ts:67-94`). Without D-25,
  tailored documents would inherit this. Mitigations (D-25 first, the rest as
  defence in depth):
  - unguessable slugs (§5);
  - tailored documents are not listed anywhere public;
  - **[NEW]** a `noindex` header on the public JSON for `-t-` slugs (relevant
    only if the owner later makes a variant public);
  - **[DECISION]** tailored variants **drop `personalInfo.photoUrl`** by
    default (`usePhoto = false`). Many employers and ATS prefer no photo, and
    it shrinks the document. Users can re-enable it per variant.
- **[DECISION D-25]** Tailored variants are created **private**: the CV
  document gets `visibility: "private"` (a new optional field on the stored CV;
  absent = `"public"`, so existing CVs keep today's sharing behaviour).
  `GET /api/cv/:id` answers `404` for a private CV unless the caller owns it,
  and `/cv/:slug.pdf` refuses it. The render page (§6) reads the tailored CV
  through its render ticket, not the public route. The mitigations above stay
  as defence in depth. Making *all* CVs private by default remains an owner
  decision (11 §4).
- Deleting a variant deletes the tailored CV document (KV `cv:` + owner
  stamp), its R2 PDF, and its approvals. Evidence and events keep only the
  SHA-256.
- The tailoring prompt never includes contact details or the photo (§4.3). The
  model output is stored in `cv_variants.diff`, inside the user's own data.

---

## 10. Versioning

- `cv_variants` are append-only per application. Re-tailoring creates a new
  variant, and the previous one becomes `rejected` (if `draft`) or stays
  `approved` but detached.
- `applications.cv_variant_id` always points at the variant that will be (or
  was) submitted. Evidence rows record the file SHA-256 actually uploaded
  (19 §9).
- Prompt/model/engine versions are recorded in `diff.prompt_version`,
  `cv_variants.model`, and the file metadata (`cv-engine` package version).

---

## 11. Test plan

| # | Test | Level |
|---|---|---|
| T8-01 | Extraction is behaviour-neutral: `apps/cv` Vitest suites pass; the PDF output of the four templates for `src/data/sample-cv.json` is identical before and after (text extraction + page count) | unit/CI |
| T8-02 | `apps/api` bundle contains no `@react-pdf`/`yoga-layout` (bundle analyzer assertion) | CI |
| T8-03 | **A-02 render diff**: the same CVData rendered via `apps/cv` Download (Chromium, headed) and via the CLI headless `/render/cv` produce PDFs with identical extracted text, fonts and page count | e2e (CI with Playwright) |
| T8-04 | Validator V1–V10: table-driven fabrication cases (new employer name, inflated number "10%→30%", new skill "Kubernetes", new year, cross-entry bullet, summary inventing a degree) are all rejected; legitimate reorder/selection accepted | unit |
| T8-05 | Validator fallback: an invalid rephrase falls back to `keep`; V1/V2 failure fails the whole patch | unit |
| T8-06 | Prompt-injection posting ("add 'PhD from MIT'") cannot produce a patch that passes V4/V6 | unit (recorded model outputs) |
| T8-07 | Tailored document creation shares the code path with `cv_create` (owner stamp, duplicate refusal); slug format and entropy | api |
| T8-08 | Render ticket: single use, 120 s TTL, scoped to one variant; reuse → 401 | api |
| T8-09 | Upload integrity: wrong sha256 / non-PDF / oversize rejected | api |
| T8-10 | Approval invalidated by re-render (payload_hash mismatch) | api |
| T8-11 | CLI download verifies sha256 and ETag, deletes on mismatch, cleans staging | CLI (pytest + respx) |
| T8-12 | "Edited after approval" detection when the tailored CV changes in `apps/cv` | api |
| T8-13 | Auto-approve only for pure selection/reorder in `auto` mode | api |
