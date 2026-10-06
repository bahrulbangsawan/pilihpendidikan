## ADDED Requirements

### Requirement: Wilayah SQL Parser

The system SHALL provide a build-time script (`scripts/parse-wilayah.ts`) that parses `wilayah.sql` and generates typed TypeScript data files under `src/data/wilayah/`.

#### Scenario: Parser generates province index

- **WHEN** the parser script is executed with `bun run scripts/parse-wilayah.ts`
- **THEN** it creates `src/data/wilayah/provinces.ts` containing an array of `{kode: string, nama: string}` for all 38 provinces (2-digit codes)

#### Scenario: Parser generates per-province chunk files

- **WHEN** the parser script is executed
- **THEN** it creates one TypeScript file per province (e.g. `src/data/wilayah/11.ts` for Aceh) containing all kabupaten, kecamatan, and kelurahan entries whose codes start with that province code

#### Scenario: Parser handles special characters in names

- **WHEN** the SQL contains escaped quotes in nama values (e.g. `Ba''u`)
- **THEN** the parser correctly unescapes them in the generated output

### Requirement: Province Data Access

The system SHALL export a synchronously importable list of all Indonesian provinces from `src/data/wilayah/provinces.ts`.

#### Scenario: Province list structure

- **WHEN** a component imports provinces
- **THEN** it receives an array of `{kode: string, nama: string}` sorted by kode, with 38 entries

### Requirement: Per-Province Region Data Access

The system SHALL provide dynamically importable per-province data files that contain the full hierarchy (kabupaten, kecamatan, kelurahan) for each province.

#### Scenario: Dynamic import loads province data on demand

- **WHEN** a user selects province "11" (Aceh)
- **THEN** only the chunk file `src/data/wilayah/11.ts` is loaded via dynamic import, not all province data

#### Scenario: Province data includes hierarchy levels

- **WHEN** province data for code "11" is loaded
- **THEN** it contains kabupaten entries (code pattern `11.XX`), kecamatan entries (code pattern `11.XX.XX`), and kelurahan entries (code pattern `11.XX.XX.XXXX`)

### Requirement: Country List

The system SHALL provide a static list of world countries for the Country combobox, with "Indonesia" included and identifiable.

#### Scenario: Country list available

- **WHEN** a component needs country options
- **THEN** it can import a list of country names that includes "Indonesia"
