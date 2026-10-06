## ADDED Requirements

### Requirement: Invoice Form Component

The system SHALL render an `InvoiceForm` component in the left panel with 5 accordion sections, each collapsible and expandable, using the existing `SectionList` and `FormField` patterns.

#### Scenario: Invoice Details section

- **WHEN** the form renders
- **THEN** the "Invoice Details" section SHALL display:
  - Invoice number input (pre-filled with auto-generated "IN-XXXXXXXX", editable)
  - Date of issue input (date picker)
  - Date due input (date picker)
  - Currency selector (dropdown with USD, EUR, GBP, IDR, SGD options)

#### Scenario: From (sender) section

- **WHEN** the user expands the "From" section
- **THEN** it SHALL display fields for: company name, address (textarea), city, state, postal code, country, email, and logo upload (file input that converts to data URL)

#### Scenario: Bill To section

- **WHEN** the user expands the "Bill To" section
- **THEN** it SHALL display fields for: recipient name, address (textarea), city, state/region, postal code, country, email

#### Scenario: Line Items section

- **WHEN** the user expands the "Line Items" section
- **THEN** it SHALL display a dynamic list of line items, each with: description, period (text), qty (number), unit price (number), amount (read-only, auto-calculated)
- **AND** each line item SHALL have an "Add Sub-Item" button to add indented sub-rows
- **AND** line items SHALL be reorderable via drag-and-drop (using existing DnD kit patterns)
- **AND** an "Add Item" button SHALL append a new empty line item

#### Scenario: Notes & Settings section

- **WHEN** the user expands the "Notes & Settings" section
- **THEN** it SHALL display a notes textarea and a tax rate number input (percentage)

### Requirement: Form Real-time Updates

The form SHALL call `onChange(updatedData)` on every field change, enabling real-time preview updates in the right panel.

#### Scenario: Live preview sync

- **WHEN** the user types in any form field
- **THEN** the preview panel SHALL update within the same render cycle
