## ADDED Requirements

### Requirement: Shared CV engine package
The workspace SHALL provide `packages/cv-engine` (`@pilihpendidikan/cv-engine`)
as the single definition of the CV document (`CVData`, `CVStyle`,
`CVSectionId`, the entry types, `DEFAULT_SECTION_ORDER`, `createEmptyCV`),
its PDF templates and its Markdown export, consumed by `apps/cv`, `apps/api`
and `apps/jobs`; no consumer MAY keep its own copy of the CV types.
(Source: 08 §3.1, §3.3; D-14; D-20)

#### Scenario: Api types
- **WHEN** `apps/api` code imports `CVData`
- **THEN** the type comes from `@pilihpendidikan/cv-engine` (directly or through the `src/types.ts` re-export) and no second definition exists

### Requirement: Worker-safe core and browser-only PDF subpath
The engine SHALL expose a Worker-safe core (`.`, `./types`, `./document`,
`./schema`, `./markdown`, `./bullets`, `./format`, `./template-utils`) that
imports no React, `@react-pdf`, `tailwind-merge` or `@rulisme/ui`, and a
browser-only `./pdf` subpath with `CVDocument`, the four templates and
`renderCvPdfBlob`; a test MUST bundle the api Worker and fail if
`@react-pdf` or `yoga-layout` enters it. (Source: 08 §1, §3.2, §11 T8-02)

#### Scenario: Bundle guard
- **WHEN** a Worker-reachable module imports `@pilihpendidikan/cv-engine/pdf`
- **THEN** `apps/api/src/cv-engine-boundary.test.ts` (T8-02) fails

### Requirement: Whole-document CV schema
The engine SHALL provide `CVDataSchema` (Zod v4) for the stored CV document,
composed from the entry schemas, that accepts what the builder saves (an
unpicked month, a link without its scheme, free-text proficiency), rejects
malformed structure (wrong types, unknown section, template or visibility, a
section listed twice, entries without an id or with a repeated id), fills
the defaults of older documents and drops unknown keys so its output is
exactly a `CVData`. (Source: 08 §3.1)

#### Scenario: Duplicate section
- **WHEN** a document lists `experience` twice in `sectionOrder`
- **THEN** `CVDataSchema` rejects it

#### Scenario: Older document
- **WHEN** a document saved before a field existed is parsed
- **THEN** the missing field gets the builder's default and the result type-checks as `CVData`

### Requirement: Bullet provenance ids
The engine SHALL provide `flattenCvBullets(data)` that lists every bullet
with a stable id — `<section>:<entryId>:<line>` for entry description lines
(e.g. `experience:<entryId>:<line>`) and `summary:0:<sentence>` for summary
sentences — so tailoring can cite its
sources. (Source: 08 §4.2)

#### Scenario: Experience line
- **WHEN** an experience entry `e1` has a two-line description
- **THEN** the bullets `experience:e1:0` and `experience:e1:1` are returned with their text

### Requirement: Markdown export
The engine SHALL provide `formatCvMarkdown(data)` with output identical to
the export `apps/cv` produced before the extraction. (Source: 08 §3.1)

#### Scenario: Baseline
- **WHEN** the frozen sample CV is exported
- **THEN** the Markdown equals `test/fixtures/markdown-baseline.json` (TCV-MARKDOWN)

### Requirement: Behaviour-neutral PDF templates
The four templates (basic, harvard, simple, standard) SHALL render, through
`CVDocument({data, style})` (default basic) and `renderCvPdfBlob(data, style,
{registerFonts})`, PDFs whose page count, extracted text and embedded fonts
equal the output of the `apps/cv` templates before the move, and a render
MUST throw when the caller has not registered the shared print text helpers.
(Source: 08 §3.1, §11 T8-01)

#### Scenario: Baseline comparison
- **WHEN** `test/pdf-baseline.test.tsx` renders the frozen sample CV and a wider document in all four templates
- **THEN** every page count, text extraction and font list equals `test/fixtures/pdf-baseline.json`

### Requirement: No dependency on the UI library
The engine MUST NOT depend on `@rulisme/ui`; the shared print module SHALL
reach the PDF through the caller's `registerFonts` callback and
`registerCvPrintText`, and `@rulisme/ui/lib/utils` SHALL re-export the
engine's `ensureUrl` and `formatPhoneDisplay`. (Source: 08 §3.1)

#### Scenario: Cycle check
- **WHEN** the workspace dependency graph is built
- **THEN** `@rulisme/ui` depends on `@pilihpendidikan/cv-engine` and not the reverse

### Requirement: Preview and PDF parity across packages
A change set that modifies `packages/cv-engine/src/pdf/<t>-pdf.tsx` SHALL
also modify `apps/cv/src/components/templates/<t>-preview.tsx`;
`scripts/check-cv-template-parity.ts` MUST exit 1 otherwise, unless
`CV_PARITY_OVERRIDE=1` marks an intentional PDF-only fix. (Source: 08 §3.2)

#### Scenario: PDF-only edit
- **WHEN** the check runs with `--files packages/cv-engine/src/pdf/harvard-pdf.tsx`
- **THEN** it exits 1 naming `harvard-preview.tsx`

#### Scenario: Override
- **WHEN** the same check runs with `CV_PARITY_OVERRIDE=1`
- **THEN** it exits 0
