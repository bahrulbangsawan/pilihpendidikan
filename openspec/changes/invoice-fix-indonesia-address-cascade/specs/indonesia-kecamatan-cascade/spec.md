## ADDED Requirements

### Requirement: Cascading Kecamatan Combobox for Indonesia

The system SHALL show a searchable Kecamatan combobox between the City (Kabupaten) and Postal Code fields when a kabupaten is selected and the country is "Indonesia", populated with kecamatan entries filtered by the selected kabupaten's code prefix.

#### Scenario: Kecamatan combobox loads after kabupaten selection

- **WHEN** the user selects kabupaten "Kota Administrasi Jakarta Pusat" (code `31.71`) under province "DKI Jakarta"
- **THEN** the Kecamatan field becomes a searchable combobox populated with kecamatan entries whose code starts with `31.71.` (e.g., "Gambir", "Tanah Abang", "Menteng")

#### Scenario: Kecamatan combobox is disabled without kabupaten

- **WHEN** the country is "Indonesia" and a province is selected but no kabupaten is selected
- **THEN** the Kecamatan combobox is disabled with placeholder "Select kabupaten first"

#### Scenario: Kecamatan combobox is disabled without province

- **WHEN** the country is "Indonesia" but no province is selected
- **THEN** the Kecamatan combobox is disabled with placeholder "Select province first"

#### Scenario: Kecamatan is searchable

- **WHEN** the user types "ment" in the Kecamatan combobox
- **THEN** the dropdown filters to show kecamatan matching "ment" (e.g., "Menteng")

### Requirement: Kecamatan field in data interfaces

The system SHALL include a `kecamatan` field in the `SenderInfo` and `RecipientInfo` interfaces, and in the `AddressValues` interface used by the `AddressFields` component.

#### Scenario: Kecamatan field persists in form data

- **WHEN** the user selects kecamatan "Menteng" in the From section
- **THEN** `data.from.kecamatan` is set to "Menteng"

#### Scenario: Kecamatan field for billTo uses correct mapping

- **WHEN** the user selects kecamatan "Gambir" in the Bill To section
- **THEN** `data.billTo.kecamatan` is set to "Gambir" (no field name remapping needed)

## MODIFIED Requirements

### Requirement: Cascade reset includes kecamatan

The system SHALL reset kecamatan (in addition to city and postal code) when a higher-level field changes.

#### Scenario: Province change resets kabupaten and kecamatan

- **WHEN** the user changes the selected province after kabupaten and kecamatan were already selected
- **THEN** kabupaten, kecamatan, and postal code selections are all cleared

#### Scenario: Kabupaten change resets kecamatan

- **WHEN** the user changes the selected kabupaten after kecamatan was already selected
- **THEN** kecamatan and postal code selections are cleared

#### Scenario: Country change resets all Indonesia fields

- **WHEN** the user changes country from "Indonesia" to any other country
- **THEN** province, kabupaten, kecamatan, and postal code selections are all cleared

### Requirement: Grid layout adapts for Indonesia

The system SHALL display 5 address fields (Province, Kabupaten, Kecamatan, Postal Code, Country) in a responsive grid when the country is "Indonesia", and 4 fields (City, State, Postal Code, Country) for other countries. Note: Country is always the first field.

#### Scenario: Indonesia shows 5 columns on desktop

- **WHEN** the country is "Indonesia" on a desktop viewport
- **THEN** the address grid shows Country, Province, Kabupaten, Kecamatan, Postal Code in a 5-column layout

#### Scenario: Non-Indonesia shows 4 columns on desktop

- **WHEN** the country is not "Indonesia" on a desktop viewport
- **THEN** the address grid shows Country, State/Region, City, Postal Code in a 4-column layout

### Requirement: Kecamatan in address display

The system SHALL include kecamatan in the formatted address output in both the invoice preview and PDF.

#### Scenario: Kecamatan appears in preview address

- **WHEN** the invoice preview renders a From or Bill To address with kecamatan "Menteng"
- **THEN** "Menteng" appears in the address line between city and state/province

#### Scenario: Kecamatan appears in PDF address

- **WHEN** the invoice PDF renders a From or Bill To address with kecamatan "Menteng"
- **THEN** "Menteng" appears in the address line between city and state/province
