## Context

`apps/cv` renders PDFs client-side with `@react-pdf/renderer` (dynamic
import, never in the Workers SSR graph). `apps/api` keeps a hand-copied
`CVData`. The Job Tracker will tailor CVs in the api Worker (types, schema,
bullets, Markdown) and render them in a browser runtime — the `apps/jobs`
page or the CLI's headless Chromium loading the same page (D-14).

## Goals / Non-Goals

- Goals: one `CVData` definition; a whole-document schema; Worker-safe
  imports for the api; byte-for-byte the same PDF text, fonts and page count
  from `apps/cv` after the move; the preview ↔ PDF parity rule kept across
  two packages.
- Non-Goals: server-side PDF rendering; moving the HTML previews (they stay
  in `apps/cv` with its chrome); tailoring itself; private CV behaviour.

## Decisions

- Decision: split the package into a Worker-safe core and a browser-only
  `./pdf` subpath. Nothing outside `src/pdf/` imports React, `@react-pdf`,
  `tailwind-merge` or `@rulisme/ui`; T8-02 bundles the api Worker and fails
  if any of them (or yoga-layout) enters the bundle.
- Decision: no dependency on `@rulisme/ui`. The UI library re-exports
  `./format`, so the engine cannot depend on it; the shared print module
  (`@rulisme/ui/print/*`: fonts, line-break policy, text normaliser) reaches
  the PDF through the caller — `renderCvPdfBlob(data, style, {registerFonts})`
  and `registerCvPrintText(...)`. A render without the text helpers throws.
- Decision: TypeScript source exports, no build step, like the other
  workspace packages; `bun test` for the package tests.
- Decision: `CVDataSchema` accepts what the builder saves (a month not yet
  picked, a link without its scheme, free-text proficiency), rejects
  malformed structure (wrong types, unknown section, template or visibility,
  duplicated sections, entries without or with repeated ids), fills defaults
  for older documents and drops unknown keys, so its output type equals
  `CVData` (asserted by a test).
- Decision: bullet provenance ids `experience:<entryId>:<line>` and
  `summary:0:<sentence>` (08 §4.2) are produced by `flattenCvBullets`.
- Decision: parity is a script (`scripts/check-cv-template-parity.ts`
  `--base <ref>` or `--files`), exit 1 when a `packages/cv-engine/src/pdf/<t>-pdf.tsx`
  changes without `apps/cv/src/components/templates/<t>-preview.tsx`;
  `CV_PARITY_OVERRIDE=1` accepts an intentional PDF-only fix.
- Alternatives considered: server-side `@react-pdf` in the Worker (runtime
  WASM compile blocked), Browser Rendering (different output from Download
  PDF), re-implementing the templates elsewhere (duplication) — all rejected
  in 08 §2.

## Divergences from the spec text (code is authoritative)

- 08 §3.2 sketches a `tsc`-built package with peer dependencies; the
  package ships TypeScript source like the rest of the workspace.
- 08 §3.1 says `apps/api/src/types.ts:1-152` is deleted; it now re-exports
  the engine's types (`createEmptyCV`, `DEFAULT_SECTION_ORDER`) so existing
  imports in the tools keep compiling — the duplicated definitions are gone.
- 08 §3.1 plans to use `CVDataSchema` for `/api/cv` PUT behind a flag; that
  tightening is not done — `PUT` validation is unchanged.
- 08 §1 / A-02 assume built-in Helvetica; since
  `update-zedative-design-system` the templates embed Inter through the
  shared print module, which the baseline test also checks.
- 08 §11 T8-01 names `src/data/sample-cv.json`; the frozen copy lives at
  `packages/cv-engine/test/fixtures/sample-cv.json`, with a second, wider
  document.

## Risks / Trade-offs

- Templates and previews now sit in two packages → the parity script; the
  root `check` wiring is done by leaf-5.3 (`parity:cv-templates`).
- An intentional visual change needs the baseline refreshed
  (`CV_PDF_BASELINE=update`) and reviewed.

## Migration Plan

Code-only refactor in one change; rollback is reverting the files. No data
or deploy step.

## Open Questions

- A-02 (headless CLI render equals the Download PDF output) is validated by
  T8-03 in the full-stack suite (leaf-5.1), not by this change.
