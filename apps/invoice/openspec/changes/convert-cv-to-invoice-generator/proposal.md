# Change: Convert CV Generator to Invoice Generator

## Why

The project needs to pivot from a CV/resume builder to an invoice generator while preserving the proven UX patterns (split-panel layout, AI assistant modal, download dropdown, import JSON). The generated invoices must visually replicate the Cloudflare invoice style (reference: `cloudflare-invoice-2026-03-23.pdf`).

## What Changes

- **BREAKING** Replace `CVData` type system with `InvoiceData` (new fields: invoice metadata, from/billTo addresses, line items with sub-items, tax/notes)
- **BREAKING** Remove all 4 CV template variants (basic, harvard, simple, standard) — replaced by a single Cloudflare-style invoice template
- **BREAKING** Remove CV-specific form sections (personal info, summary, experience, education, skills, awards, certificates, languages, projects, volunteer) — replaced by invoice sections (details, from, bill-to, line items, notes)
- **BREAKING** Rename all `cv-*` AI files to `invoice-*` and rewrite system prompt for invoice context
- Remove Markdown export (not applicable to invoices)
- Remove template style switcher from toolbar (single template only)
- Update SEO metadata, page title, and JSON-LD schema from CV to Invoice context
- Rename package from `cv-bahrul` to `invoice-bahrul`

## Impact

- Affected specs: None currently exist in `openspec/specs/` (greenfield specs)
- Affected code (22 files reference CV types/names):
  - `src/components/cv-form.tsx` → rewrite as `invoice-form.tsx`
  - `src/components/cv-preview.tsx` → rewrite as `invoice-preview.tsx`
  - `src/components/cv-pdf.tsx` → rewrite as `invoice-pdf.tsx`
  - `src/components/templates/*.tsx` (8 files) → delete all
  - `src/components/ai/cv-*.{ts,tsx}` (4 files) → rename + rewrite
  - `src/components/ai/openrouter-adapter.ts` → update types from CVSectionKey to InvoiceSectionKey
  - `src/components/ai/pdf-attachment-adapter.ts` → update for invoice PDF import
  - `src/components/assistant-ui/thread.tsx` → update CV references
  - `src/routes/index.tsx` → rewrite page component
  - `src/routes/__root.tsx` → update meta/SEO
  - `src/data/sample-cv.json` → replace with `sample-invoice.json`
  - `src/styles.css` → update `.cv-page` class to `.invoice-page`
  - `package.json` → rename project
