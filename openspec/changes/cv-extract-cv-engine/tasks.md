## 1. Package

- [x] 1.1 `packages/cv-engine` with the subpath exports `.`, `./types`, `./document`, `./schema`, `./markdown`, `./bullets`, `./format`, `./template-utils`, `./pdf` (`package.json`, `CLAUDE.md`)
- [x] 1.2 Types moved out of `apps/cv/src/components/cv-form.tsx` into `src/types.ts` (plus optional `CVVisibility`, type only); defaults in `src/document.ts`
- [x] 1.3 `CVDataSchema` composed from the entry schemas moved from `apps/api/src/schemas.ts` (`src/schema.ts`; TCV-SCHEMA)
- [x] 1.4 `flattenCvBullets` (`src/bullets.ts`; TCV-BULLETS)
- [x] 1.5 `formatCvMarkdown` moved from `apps/cv/src/lib/cv-markdown.ts` (`src/markdown.ts`; TCV-MARKDOWN)
- [x] 1.6 Four templates, `CVDocument`, `renderCvPdfBlob`, `registerCvPrintText` moved to `src/pdf/`; `template-utils` and `format` helpers moved; `@rulisme/ui/lib/utils` re-exports `ensureUrl` / `formatPhoneDisplay`

## 2. Consumers

- [x] 2.1 `apps/cv` imports types, defaults, templates (dynamic import on the client) and Markdown from the engine; old `cv-pdf.tsx`, `templates/*-pdf.tsx`, `template-utils.ts`, `lib/cv-markdown.ts` deleted
- [x] 2.2 `apps/api/src/types.ts` and `src/schemas.ts` re-export the engine's types and schemas (no duplicate definitions)
- [x] 2.3 `apps/jobs` depends on the engine for the render route (`apps/jobs/package.json`)

## 3. Guards

- [x] 3.1 T8-01 PDF baseline: page count, extracted text and fonts of all four templates for the frozen sample and a wider document (`packages/cv-engine/test/pdf-baseline.test.tsx`, `test/fixtures/pdf-baseline.json`)
- [x] 3.2 T8-02 Worker bundle boundary (`apps/api/src/cv-engine-boundary.test.ts`)
- [x] 3.3 Parity script `scripts/check-cv-template-parity.ts` with override (TCV-PARITY, `test/parity-script.test.ts`)

## 4. Verification

- [x] 4.1 `bun test` in `packages/cv-engine`: 57 pass, 0 fail; leaf-1.2 gates G1/G2 verified (status.log)
- [x] 4.2 T8-02 re-run within the scoped api tests (pass)
- [x] 4.3 Handoff recorded (NOT executed here — leaf-5.3 action): wiring `parity:cv-templates` into the root `bun run check` chain and updating root docs for the new package
- [x] 4.4 Handoff recorded (NOT executed — owner action): redeploying `apps/cv` with the refactored imports; no deploy was performed
- [x] 4.5 Handoff recorded (NOT executed — deferred): tightening `/api/cv` PUT validation with `CVDataSchema` behind a flag (08 §3.1) is not implemented; PUT validation is unchanged
