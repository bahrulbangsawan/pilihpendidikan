## ADDED Requirements

### Requirement: Country Combobox

The system SHALL replace the Country text input with a searchable combobox in both the "From" and "Bill To" address sections of the invoice form.

#### Scenario: Country field is searchable

- **WHEN** the user clicks the Country field
- **THEN** a searchable dropdown appears with a list of world countries

#### Scenario: Country search filters results

- **WHEN** the user types "indo" in the Country combobox
- **THEN** the dropdown filters to show countries matching "indo" (e.g. "Indonesia")

### Requirement: Cascading Province Combobox for Indonesia

The system SHALL show a searchable Province combobox for the State/Region field when the selected country is "Indonesia".

#### Scenario: Province combobox appears for Indonesia

- **WHEN** the user selects "Indonesia" as the country
- **THEN** the State/Region field becomes a searchable combobox populated with 38 Indonesian provinces

#### Scenario: Province combobox is searchable

- **WHEN** the user types "jawa" in the Province combobox
- **THEN** the dropdown filters to show provinces matching "jawa" (e.g. "Jawa Barat", "Jawa Tengah", "Jawa Timur")

### Requirement: Cascading Kabupaten/Kota Combobox for Indonesia

The system SHALL show a searchable Kabupaten/Kota combobox for the City field when a province is selected, populated with kabupaten/kota from that province only.

#### Scenario: City combobox loads after province selection

- **WHEN** the user selects province "Jawa Barat"
- **THEN** the City field becomes a searchable combobox populated with kabupaten/kota under Jawa Barat only (via dynamic import)

#### Scenario: City combobox is disabled without province

- **WHEN** the country is "Indonesia" but no province is selected
- **THEN** the City combobox is disabled with a placeholder indicating "Select province first"

#### Scenario: Province change resets city

- **WHEN** the user changes the selected province after a city was already selected
- **THEN** the city selection is cleared and the new province's kabupaten list is loaded

### Requirement: Non-Indonesia Text Input Fallback

The system SHALL show plain text inputs for City, State/Region, and Postal Code when the selected country is not "Indonesia".

#### Scenario: Text inputs for non-Indonesia country

- **WHEN** the user selects "United States" as the country
- **THEN** City, State/Region, and Postal Code fields are plain text inputs (not comboboxes)

#### Scenario: Switching from Indonesia to another country

- **WHEN** the user changes country from "Indonesia" to "Singapore"
- **THEN** the Province and City comboboxes are replaced with plain text inputs and previous selections are cleared

### Requirement: Postal Code Remains Text Input

The system SHALL keep the Postal Code field as a plain text input regardless of the selected country, since the wilayah dataset does not contain postal code data.

#### Scenario: Postal code is always a text input

- **WHEN** the country is "Indonesia"
- **THEN** the Postal Code field remains a regular text input, not a combobox

### Requirement: Independent Address Sections

The system SHALL manage cascading state independently for the "From" and "Bill To" address sections.

#### Scenario: From and Bill To selections are independent

- **WHEN** the user selects "Indonesia" and province "Aceh" in the From section
- **THEN** the Bill To section's country and province selections are unaffected

### Requirement: Address Fields Reusable Component

The system SHALL extract the address field grid (Country, State/Region, City, Postal Code) into a reusable component used by both From and Bill To sections.

#### Scenario: Shared component for both sections

- **WHEN** the invoice form renders
- **THEN** both the From and Bill To sections use the same AddressFields component with independent state
