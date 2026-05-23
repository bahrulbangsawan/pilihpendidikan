## ADDED Requirements

### Requirement: Invoice Data Model

The system SHALL define an `InvoiceData` TypeScript interface as the single source of truth for all invoice state, exported from `src/components/invoice-form.tsx`.

The interface SHALL include:

- Invoice metadata: `invoiceNumber` (string), `dateOfIssue` (ISO date string), `dateDue` (ISO date string), `currency` (string, default "USD")
- Sender info (`from`): `companyName`, `address`, `city`, `state`, `postalCode`, `country`, `email`, `logoUrl` (all strings)
- Recipient info (`billTo`): `name`, `address`, `city`, `stateRegion`, `postalCode`, `country`, `email` (all strings)
- Line items (`items[]`): each with `id` (string), `description` (string), `period` (string), `qty` (number), `unitPrice` (number), `amount` (number, auto-calculated as qty \* unitPrice)
- Optional sub-items per line item (`subItems[]`): each with `id`, `label`, `qty`, `unitPrice`, `amount`
- Notes (`notes`: string) and tax rate (`taxRate`: number, percentage)

#### Scenario: Empty invoice initialization

- **WHEN** the application loads with no prior data
- **THEN** `InvoiceData` SHALL be initialized with empty strings, empty arrays, `currency: "USD"`, `taxRate: 0`, and an auto-incremented `invoiceNumber` in the format `IN-XXXXXXXX`
- **AND** the invoice number counter SHALL be persisted in `localStorage` (key: `invoice-counter`) and increment by 1 on each new invoice
- **AND** the invoice number field SHALL remain editable so users can override with their own numbering scheme

#### Scenario: Currency-aware number formatting

- **WHEN** a currency is selected (e.g., USD, IDR, EUR)
- **THEN** all monetary values in preview and PDF SHALL be formatted using `Intl.NumberFormat` with the appropriate locale and currency code (e.g., USD → `$1,000.00`, IDR → `Rp1.000`, EUR → `1.000,00 €`)

#### Scenario: Line item amount auto-calculation

- **WHEN** a user sets `qty` and `unitPrice` on a line item
- **THEN** `amount` SHALL be computed as `qty * unitPrice` and displayed as read-only

#### Scenario: Tax calculation

- **WHEN** `taxRate` is non-zero
- **THEN** `tax = subtotal * (taxRate / 100)` and `total = subtotal + tax`

### Requirement: Sample Invoice Data

The system SHALL provide a sample invoice JSON file at `src/data/sample-invoice.json` containing data matching the Cloudflare reference invoice (sender: Cloudflare Inc., recipient: Mayarosa Nur Arafah, 3-4 line items with sub-items).

#### Scenario: Load sample invoice

- **WHEN** user clicks "Load Sample Invoice"
- **THEN** all form fields SHALL populate with the sample data and the preview SHALL render immediately
