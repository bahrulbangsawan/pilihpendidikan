## Context

The wilayah per-province chunk files (e.g., `src/data/wilayah/31.ts`) already export `ProvinceData` with `kabupaten`, `kecamatan`, and `kelurahan` arrays. The kecamatan entries use a `XX.YY.ZZ` code format where `XX.YY` is the parent kabupaten code. This hierarchical code system enables client-side filtering without additional data loading.

## Goals / Non-Goals

- **Goals:**
  - Add kecamatan as a third cascading searchable combobox for Indonesia addresses
  - Filter kecamatan list by selected kabupaten's code prefix (e.g., `31.71` → kecamatan codes starting with `31.71.`)
  - Properly cascade resets across all 3 levels
  - Fix the billTo field mapping to handle the new `kecamatan` field
  - Render kecamatan in PDF and preview address output

- **Non-Goals:**
  - Kelurahan/desa (4th level) — deferred, adds too many items and UI complexity
  - Postal code auto-lookup from kecamatan — not in the dataset
  - Changing the data loading strategy — per-province chunks already have kecamatan

## Decisions

### Decision 1: Filter kecamatan from already-loaded province data

- **What:** When a kabupaten is selected, filter `provinceData.kecamatan` where `kode.startsWith(selectedKabupaten.kode + ".")`
- **Why:** The province chunk is already loaded when kabupaten was selected. No additional network request needed.
- **Alternatives considered:**
  - Nested data structure (kabupaten → kecamatan): rejected — would require regenerating all data files

### Decision 2: Add kecamatan to both SenderInfo and RecipientInfo

- **What:** Add `kecamatan: string` to both interfaces, keeping it as an optional display field
- **Why:** Both From and Bill To sections use AddressFields and need the same field structure

### Decision 3: Responsive grid layout

- **What:** Use `grid-cols-2 lg:grid-cols-5` for Indonesia (5 fields) and `grid-cols-2 lg:grid-cols-4` for non-Indonesia (4 fields)
- **Why:** 5 equal columns on desktop keeps fields compact; 2 columns on mobile prevents overflow

### Decision 4: Kecamatan display in address output

- **What:** Insert kecamatan between city and state in the address line: `city, kecamatan, state postalCode`
- **Why:** Follows Indonesian address convention where kecamatan appears after kabupaten/kota

## Risks / Trade-offs

- **Kecamatan list size:** Some kabupaten have 30+ kecamatan. The Combobox search filtering handles this well.
- **Address line length:** Adding kecamatan makes the formatted address longer. The PDF/preview already wraps text.
