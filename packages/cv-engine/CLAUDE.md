# packages/cv-engine — CV engine (@pilihpendidikan/cv-engine)

The CV document and everything that renders it outside the editor, extracted
from `apps/cv` (D-14, `job-tracker-spec/08-CV-GENERATION-INTEGRATION.md` §3)
so the CV builder, the api Worker and the Job Tracker share one definition.
TypeScript source exports, no build step; `bun test` for the tests.

## Subpaths

| Import | What | Runs in |
|---|---|---|
| `.` | everything below except `./pdf` | Worker, browser, Bun |
| `./types` | `CVData`, `CVStyle`, `CVSectionId`, the entry types, `CVVisibility` (D-25: optional, absent = public) | types only |
| `./document` | `DEFAULT_SECTION_ORDER`, `CV_STYLES` and the other closed lists, `DEFAULT_SECTION_TITLES`, `createEmptyCV(titles?)` | anywhere, no zod |
| `./schema` | `CVDataSchema` (the whole stored document, zod v4), the entry schemas it is composed from, the MCP `cv_*` input schemas and field formats | anywhere |
| `./markdown` | `formatCvMarkdown` | anywhere |
| `./bullets` | `flattenCvBullets`, `CvBullet` (08 §4.2 ids: `experience:<entryId>:<line>`, `summary:0:<sentence>`) | anywhere |
| `./format` | `ensureUrl`, `formatPhoneDisplay` (`@rulisme/ui/lib/utils` re-exports them) | anywhere |
| `./template-utils` | `getDescriptionLines`, `formatOngoingEndDate`, `hasPreviewSectionContent`: the layout rules the PDF and apps/cv's HTML previews share | anywhere |
| `./pdf` | `CVDocument({data, style})`, the four `@react-pdf` templates, `renderCvPdfBlob(data, style, {registerFonts})`, `registerCvPrintText` | **browser only** |

- **Worker safety.** Nothing outside `src/pdf/` may import React, `@react-pdf`, `tailwind-merge` or `@rulisme/ui`. `@react-pdf/renderer` compiles yoga-layout's WASM at runtime, which Workers forbid; `apps/api/src/cv-engine-boundary.test.ts` (T8-02) bundles the Worker and fails if it pulls any of them in. Load `./pdf` only with a dynamic import behind an SSR guard.
- **No dependency on `@rulisme/ui`.** The UI library depends on this package (it re-exports `./format`), so this one cannot depend on it, not even for tests (Turborepo rejects the cycle). The print module stays in `@rulisme/ui/print/*` and reaches the PDF through the caller: `renderCvPdfBlob`'s `registerFonts(Font)` callback calls `registerPrintFonts(Font)` and `registerCvPrintText({ toPrintText, toPrintLine, toPrintLines })` (see `apps/cv/src/lib/pdf-fonts.ts`). A render without the text helpers throws. The templates set `PDF_FONT_FAMILY` ("Inter"), the family that registration provides.
- **`CVDataSchema`** takes what the builder saves (a month not picked yet, a link without its scheme, a free-text proficiency) and rejects malformed structure (wrong types, unknown section, template or visibility, a section listed twice, entries without an id or with a repeated one). Missing fields of older documents get the tools' defaults and unknown keys are dropped, so the output is exactly a `CVData` (a test asserts the types are identical: add a field to both). The MCP input schemas keep their stricter formats unchanged.
- **Parity.** Each `src/pdf/<t>-pdf.tsx` has an HTML twin, `apps/cv/src/components/templates/<t>-preview.tsx`; change them together. `scripts/check-cv-template-parity.ts --base <ref>` (or `--files a,b,c`) fails a change set that touches the PDF alone; `CV_PARITY_OVERRIDE=1` accepts an intentional PDF-only fix. The root `bun run check` runs it as `bun run parity:cv-templates` (against `HEAD`, uncommitted and untracked files included) and CI also against the pull request base. See `apps/cv/CLAUDE.md` § Preview ↔ PDF parity.
- **Consumers.** `apps/cv` (editor, Download PDF), `apps/api` (`CVDataSchema`, Markdown, bullets for tailoring; never `./pdf`) and `apps/jobs` (the `/render/cv/$cvvId` page renders tailored variants with `./pdf` in the browser, and headless in the CLI's Chromium, D-14).

## Tests (`bun test`)

- `test/pdf-baseline.test.tsx` — T8-01: every template renders `test/fixtures/sample-cv.json` (apps/cv's sample, frozen) and a wider document to the same page count, extracted text (unpdf) and embedded fonts as the apps/cv templates did before the extraction (`test/fixtures/pdf-baseline.json`). The print module is loaded from `packages/ui/src/print` by path, its `?url` font imports resolved by `test/preload.ts`. After an intentional visual change: `CV_PDF_BASELINE=update bun test test/pdf-baseline.test.tsx`, then `bun run fix` at the root and review the fixture diff.
- `test/schema.test.ts` (TCV-SCHEMA), `test/bullets.test.ts` (TCV-BULLETS), `test/markdown.test.ts` (TCV-MARKDOWN, against the pre-move export in `test/fixtures/markdown-baseline.json`), `test/parity-script.test.ts` (TCV-PARITY), `test/print.test.ts` (`toPdfText`, `getTextLines`).

## Commands

- `bun run test` — `bun test`
- `bun run typecheck` — `tsc --noEmit` (sources and tests)
- `bun run lint` — Biome
