## ADDED Requirements

### Requirement: Invoice Generator Page Layout

The system SHALL render an `InvoiceGenerator` component at the root route (`/`) with a split-panel layout: form on the left half, preview on the right half, identical to the existing CV layout structure.

#### Scenario: Split panel rendering

- **WHEN** the page loads
- **THEN** the left panel SHALL contain the invoice form with a sticky toolbar, and the right panel SHALL contain the invoice preview with a sticky toolbar

#### Scenario: Left toolbar

- **WHEN** the left toolbar renders
- **THEN** it SHALL contain:
  - "Import JSON" button (loads an InvoiceData JSON file)
  - "Load Sample Invoice" button (populates form with sample data)

#### Scenario: Right toolbar

- **WHEN** the right toolbar renders
- **THEN** it SHALL contain a "Download" dropdown with options:
  - "Download as PDF" (generates and downloads invoice PDF)
  - "Download as JSON" (exports InvoiceData as JSON)
- **AND** it SHALL NOT contain template style switcher buttons
- **AND** it SHALL NOT contain a "Download as Markdown" option

### Requirement: SEO Metadata

The system SHALL update all page metadata to reflect the Invoice Generator context.

#### Scenario: Meta tags

- **WHEN** the page renders
- **THEN** the `<title>` SHALL be "Invoice Generator — Bahrul Bangsawan"
- **AND** the meta description SHALL reference invoice generation
- **AND** OG/Twitter card metadata SHALL reference invoice generation
- **AND** the JSON-LD structured data SHALL use `@type: WebApplication` with invoice-related description

### Requirement: CV File Cleanup

The system SHALL remove all CV-specific files that are no longer referenced after the conversion.

#### Scenario: Deleted files

- **WHEN** the conversion is complete
- **THEN** the following files SHALL NOT exist:
  - `src/components/cv-form.tsx`
  - `src/components/cv-preview.tsx`
  - `src/components/cv-pdf.tsx`
  - `src/components/templates/basic-preview.tsx`
  - `src/components/templates/harvard-preview.tsx`
  - `src/components/templates/simple-preview.tsx`
  - `src/components/templates/standard-preview.tsx`
  - `src/components/templates/basic-pdf.tsx`
  - `src/components/templates/harvard-pdf.tsx`
  - `src/components/templates/simple-pdf.tsx`
  - `src/components/templates/standard-pdf.tsx`
  - `src/components/ai/cv-assistant.tsx`
  - `src/components/ai/cv-system-prompt.ts`
  - `src/components/ai/cv-data-context.ts`
  - `src/components/ai/cv-suggestions.ts`
  - `src/data/sample-cv.json`
