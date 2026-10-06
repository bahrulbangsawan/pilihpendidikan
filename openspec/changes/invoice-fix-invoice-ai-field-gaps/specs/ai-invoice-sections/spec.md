## ADDED Requirements

### Requirement: AI Custom Fields Section

The AI assistant SHALL support a `custom-fields` section that can serialize, parse, and apply custom field label/value pairs.

#### Scenario: User creates custom fields via AI

- **WHEN** user sends `@custom-fields Add PO Number: PO-2026-001 and Project Code: PROJ-42`
- **THEN** AI responds with `<apply section="custom-fields">` containing pipe-delimited `Label | Value` lines
- **AND** the custom fields are applied to InvoiceData.customFields

#### Scenario: Custom fields included in @all

- **WHEN** user sends `@all Generate a complete invoice...`
- **THEN** AI includes `<apply section="custom-fields">` alongside all other sections

### Requirement: AI Tax Rate Support

The AI assistant SHALL support reading and writing `taxRate` via the `invoice-details` section.

#### Scenario: User sets tax rate via AI

- **WHEN** user sends `@invoice-details Set tax rate to 11%`
- **THEN** AI responds with `<apply section="invoice-details">` containing taxRate in the pipe-delimited format
- **AND** the taxRate field is updated in InvoiceData

#### Scenario: Tax rate serialized for AI context

- **WHEN** the system prompt is built with invoice data containing taxRate of 11
- **THEN** the `[Invoice Details]` line includes `TaxRate: 11`

### Requirement: AI Kecamatan Field Support

The AI assistant SHALL serialize and parse the `kecamatan` field for both From and Bill To sections.

#### Scenario: Kecamatan serialized in From section

- **WHEN** invoice data has `from.kecamatan` set to "Menteng"
- **THEN** the serialized From line includes "Menteng" in the kecamatan position

#### Scenario: Kecamatan applied from AI response

- **WHEN** AI responds with `<apply section="from">Acme | Jl. Sudirman | Jakarta | Menteng | DKI Jakarta | 12930 | Indonesia | billing@acme.com</apply>`
- **THEN** `from.kecamatan` is set to "Menteng"

## MODIFIED Requirements

### Requirement: Adjustments Mention Detection

The mention regex SHALL include `adjustments` so that `@adjustments` triggers focused section editing.

#### Scenario: User types @adjustments

- **WHEN** user message contains `@adjustments`
- **THEN** extractMentions returns `["adjustments"]`
- **AND** the system prompt focuses on the adjustments section

#### Scenario: @all still includes adjustments

- **WHEN** user message contains `@all`
- **THEN** extractMentions returns all sections including `adjustments`
