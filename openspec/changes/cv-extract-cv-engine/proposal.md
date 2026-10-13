# Change: Extract the CV engine into `packages/cv-engine`

## Why

The Job Tracker produces tailored CVs with the existing CV engine (D-14), but
the engine is locked inside `apps/cv`: the `CVData` type lives in a 2,000-line
form component and is hand-copied into `apps/api/src/types.ts`, there is no
whole-document schema, and the four `@react-pdf` templates and the Markdown
export can only be imported by the CV builder (`job-tracker-spec/08` §1,
C-06). `apps/api`, `apps/jobs` and the CLI's headless render all need one
shared definition, and the Worker must never pull in `@react-pdf`, whose
yoga-layout compiles WASM at runtime.

## What Changes

- New package `packages/cv-engine` (`@pilihpendidikan/cv-engine`), TypeScript
  source exports: a Worker-safe core (`types`, `document`, `schema`,
  `markdown`, `bullets`, `format`, `template-utils`) and the browser-only
  `./pdf` subpath (`CVDocument`, the four templates, `renderCvPdfBlob`,
  `registerCvPrintText`).
- New whole-document Zod v4 `CVDataSchema`, composed from the entry schemas
  that moved out of `apps/api/src/schemas.ts`; the MCP input schemas keep
  their stricter formats.
- New `flattenCvBullets` with stable bullet ids for tailoring provenance.
- `CVData` gains an optional `visibility` field (absent = public) as a type
  and schema member only; its behaviour belongs to `jobs-add-cv-variants`.
- `apps/cv` and `apps/api` import from the package with no behaviour change;
  `ensureUrl` / `formatPhoneDisplay` move into the engine and
  `@rulisme/ui/lib/utils` re-exports them (no dependency cycle).
- Guards: a PDF baseline test (T8-01), a Worker bundle boundary test (T8-02)
  and `scripts/check-cv-template-parity.ts` for the PDF ↔ preview rule.

Implemented in the working tree (uncommitted, undeployed). A pure refactor:
no visual or data change in `apps/cv`.

## Impact

- Affected specs: `cv-engine` (new), `cv-generator` (ADDED: the builder
  takes its document model, PDF templates and Markdown export from the
  engine).
- Affected code: `packages/cv-engine/**`; `apps/cv/src/components/cv-form.tsx`,
  `cv-generator.tsx`, `cv-preview.tsx`, `templates/*-preview.tsx`,
  `lib/pdf-fonts.ts`, `lib/blank-cv.ts` (deleted: `cv-pdf.tsx`,
  `templates/*-pdf.tsx`, `template-utils.ts`, `lib/cv-markdown.ts`);
  `apps/api/src/types.ts`, `apps/api/src/schemas.ts`,
  `apps/api/src/cv-engine-boundary.test.ts`; `packages/ui/src/lib/utils.ts`;
  `scripts/check-cv-template-parity.ts`.
- Sources: `job-tracker-spec/08` §1–§3, §4.2, §10, §11 (T8-01, T8-02);
  `13` §2 M0 deliverable ③; decisions D-14, D-20, D-25 (type only).
- Interaction with pending changes: the print documents keep the Zedative
  rules of `update-zedative-design-system` (Inter via `@rulisme/ui/print/*`);
  their `*-pdf.tsx` files now live in `packages/cv-engine/src/pdf/`.
