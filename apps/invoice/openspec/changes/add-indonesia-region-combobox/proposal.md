# Change: Add cascading Indonesia region comboboxes to address fields

## Why

The invoice form's City, State/Region, Postal Code, and Country fields are plain text inputs. For Indonesia, users must manually type province and city names from memory, leading to typos and inconsistency. The `wilayah.sql` dataset (91,599 rows from Kepmendagri No 300.2.2-2138 Tahun 2025) provides authoritative region data that should power searchable dropdowns with cascading selection.

## What Changes

- **Country field** becomes a searchable combobox (all countries) in both From and Bill To sections
- **State/Region and City fields** become cascading comboboxes when country is "Indonesia", populated from wilayah data (38 provinces, 514 kabupaten/kota)
- **District and Village fields** added as optional cascading comboboxes for Indonesia (7,285 kecamatan, 83,762 kelurahan)
- **Non-Indonesia fallback**: City, State/Region, Postal Code remain plain text inputs when country is not Indonesia
- **Data storage**: wilayah.sql parsed into per-province TypeScript chunk files for code-splitting (no database required)
- **Postal Code** remains a text input even for Indonesia (wilayah data contains administrative codes, not postal codes)

## Impact

- Affected specs: `indonesia-region-data` (new), `address-combobox-fields` (new)
- Affected code:
  - `src/components/invoice-form.tsx` — address field sections (lines 409-434, 505-530)
  - `src/components/ui/combobox.tsx` — existing Base UI Combobox (reused as-is)
  - `src/components/form/form-field.tsx` — may need `FormFieldCustom` for combobox wrappers
  - `src/data/wilayah/` — new generated data files
  - `scripts/parse-wilayah.ts` — new parser script
  - `SenderInfo` and `RecipientInfo` interfaces — add district/village fields
