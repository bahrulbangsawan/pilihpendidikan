# Tasks: Add CV Template System

## Phase 1: Architecture Setup

- [x] **T1** Export `CVStyle` type from `src/components/cv-form.tsx`
- [x] **T2** Create `src/components/templates/` directory
- [x] **T3** Add `style` state to `CVGenerator` in `src/routes/index.tsx`
- [x] **T4** Add style selector button group to preview toolbar
- [x] **T5** Pass `style` prop to `CVPreview` and `handleDownloadPDF`

## Phase 2: Extract Basic Template

- [x] **T6** Extract current `cv-preview.tsx` content into `templates/basic-preview.tsx`
- [x] **T7** Extract current `cv-pdf.tsx` content into `templates/basic-pdf.tsx`
- [x] **T8** Convert `cv-preview.tsx` into switcher component
- [x] **T9** Convert `cv-pdf.tsx` into switcher component
- [x] **T10** Verify Basic template still works (preview + PDF download)

## Phase 3: Harvard Template

- [x] **T11** Create `templates/harvard-preview.tsx` — centered header, blue headers with rules, title+dates on same row
- [x] **T12** Create `templates/harvard-pdf.tsx` — matching PDF layout
- [x] **T13** Verify Harvard preview renders correctly with sample data
- [x] **T14** Verify Harvard PDF downloads and matches preview

## Phase 4: Simple Template

- [x] **T15** Create `templates/simple-preview.tsx` — centered header, blue headers left-aligned, clean separation
- [x] **T16** Create `templates/simple-pdf.tsx` — matching PDF layout
- [x] **T17** Verify Simple preview renders correctly with sample data
- [x] **T18** Verify Simple PDF downloads and matches preview

## Phase 5: Standard Template

- [x] **T19** Create `templates/standard-preview.tsx` — two-column header, compact spacing, non-uppercase headers
- [x] **T20** Create `templates/standard-pdf.tsx` — matching PDF layout
- [x] **T21** Verify Standard preview renders correctly with sample data
- [x] **T22** Verify Standard PDF downloads and matches preview

## Phase 6: Validation

- [x] **T23** Run `bun run typecheck` — zero errors
- [ ] **T24** Test switching between all 4 styles in the UI
- [ ] **T25** Test PDF download for each style

## Dependencies
- T6-T7 depend on T2
- T8-T9 depend on T6-T7
- T10 depends on T3-T5 and T8-T9
- T11-T22 depend on T10 (Basic must work before building others)
- T11-T22 are parallelizable across styles (Harvard, Simple, Standard are independent)
