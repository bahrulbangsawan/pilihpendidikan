## ADDED Requirements

### Requirement: Invoice PDF Document

The system SHALL generate a downloadable PDF using `@react-pdf/renderer` that matches the Cloudflare invoice layout identically to the HTML preview.

#### Scenario: PDF visual fidelity

- **WHEN** the user clicks "Download as PDF"
- **THEN** the generated PDF SHALL include:
  - Orange (#f48120) horizontal bar at page top
  - "Invoice" heading in bold serif/sans-serif font
  - Company logo positioned top-right (if provided)
  - Invoice metadata (number, dates) in small text
  - Two-column from/bill-to section
  - Bold amount due summary line
  - Line items table with thin gray borders, right-aligned numbers
  - Sub-items indented
  - Subtotal/Tax/Total/Amount due footer
  - "Page X of Y" at bottom-right

#### Scenario: PDF file naming

- **WHEN** the user downloads a PDF
- **THEN** the filename SHALL follow the pattern `Invoice-{invoiceNumber}-{YYYYMMDD}.pdf`

#### Scenario: Multi-page support

- **WHEN** line items exceed one page
- **THEN** the PDF SHALL paginate correctly with the orange accent bar on each page and page numbers at bottom-right
