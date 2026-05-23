## ADDED Requirements

### Requirement: Invoice Preview Component

The system SHALL render a single `InvoicePreview` component in the right panel that visually replicates the Cloudflare invoice style from the reference PDF (`cloudflare-invoice-2026-03-23.pdf`).

#### Scenario: Empty state

- **WHEN** no invoice data has been entered (no company name, no items)
- **THEN** the preview SHALL display a centered placeholder message: "Start filling in the form to see your invoice preview"

#### Scenario: Cloudflare-style header

- **WHEN** invoice data is present
- **THEN** the preview SHALL render:
  - An orange (#f48120) horizontal accent bar at the very top of the page
  - "Invoice" as bold ~24pt heading, top-left
  - Company logo image positioned top-right (if `from.logoUrl` is set)
  - Invoice metadata block below heading: "Invoice number", "Date of issue", "Date due" as label-value pairs in small bold-label text

#### Scenario: From and Bill To layout

- **WHEN** sender and/or recipient info is present
- **THEN** the preview SHALL render a two-column layout:
  - Left column: sender company name (bold), address lines, email
  - Right column: "Bill to" label (bold), recipient name, address lines, email

#### Scenario: Amount due summary

- **WHEN** line items exist
- **THEN** the preview SHALL render a bold summary line: "${total} {currency} due {formatted date}" in ~18pt font

#### Scenario: Line items table

- **WHEN** line items exist
- **THEN** the preview SHALL render a table with columns: Description | Qty | Unit price | Amount
  - Column headers in small text with a horizontal rule below
  - Thin gray (#e5e5e5) horizontal rules between rows
  - Description left-aligned, Qty/Unit price/Amount right-aligned
  - Period shown as gray subtext below description
  - Sub-items indented with smaller text and their own qty/unit price/amount columns

#### Scenario: Footer totals

- **WHEN** line items exist
- **THEN** the preview SHALL render right-aligned footer rows:
  - Subtotal (sum of all line item amounts)
  - Tax line (if taxRate > 0): "Tax (X%)" with calculated amount
  - Total
  - "Amount due" in bold with currency code (e.g., "$0.00 USD")
