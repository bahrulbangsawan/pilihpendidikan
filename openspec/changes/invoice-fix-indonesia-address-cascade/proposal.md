# Change: Fix Indonesia address cascade — add Kecamatan level and fix field mapping

## Why

The current Indonesia address implementation (from `add-indonesia-region-combobox`) only cascades two levels: Province → Kabupaten. The wilayah dataset already contains kecamatan data per province chunk, but it's unused. Additionally, the `billTo` section maps `state` → `stateRegion` inline (line 612 of invoice-form.tsx), which doesn't account for the new `kecamatan` field, creating a potential bug when cascading resets fire for fields not in the `RecipientInfo` interface.

## What Changes

- **Kecamatan cascading combobox**: Add a third Indonesia-specific searchable dropdown between Kabupaten and Postal Code, filtered by the selected kabupaten's code prefix from the already-loaded province data
- **Interface updates**: Add `kecamatan` to `AddressValues` (address-fields.tsx), `SenderInfo`, and `RecipientInfo` (invoice-form.tsx)
- **Field mapping fix**: Update the `billTo` onChange handler to map `kecamatan` correctly alongside the existing `state` → `stateRegion` mapping
- **Cascade reset fix**: Changing province resets kabupaten, kecamatan, and postal code; changing kabupaten resets kecamatan and postal code
- **Grid layout**: Adjust from `grid-cols-4` to responsive layout accommodating 5 fields for Indonesia
- **PDF/Preview rendering**: Include kecamatan in the address display for both invoice-pdf.tsx and invoice-preview.tsx

## Impact

- Affected code:
  - `src/components/form/address-fields.tsx` — add kecamatan combobox, update interface, fix cascade resets
  - `src/components/invoice-form.tsx` — update `SenderInfo`/`RecipientInfo` interfaces, fix billTo field mapping, wire kecamatan field
  - `src/components/invoice-pdf.tsx` — render kecamatan in address line
  - `src/components/invoice-preview.tsx` — render kecamatan in address line
  - `src/data/sample-invoice.json` — add kecamatan sample values
- Affected specs: extends `address-combobox-fields` from `add-indonesia-region-combobox`
- No new data files needed — kecamatan data already exists in per-province chunks
