## Context

The `wilayah.sql` file contains 91,599 Indonesian administrative region entries in a hierarchical code system:

- 2-digit → Province (38 entries, e.g. `11` → "Aceh")
- 2.2 → Kabupaten/Kota (514 entries, e.g. `11.01` → "Kabupaten Aceh Selatan")
- 2.2.2 → Kecamatan/District (7,285 entries, e.g. `11.01.01` → "Bakongan")
- 2.2.2.4 → Kelurahan/Desa/Village (83,762 entries, e.g. `11.01.01.2001` → "Keude Bakongan")

This data must be embedded in the client-side code (no database) while keeping bundle size reasonable.

## Goals / Non-Goals

- **Goals:**
  - Searchable combobox for Country, Province, Kabupaten for Indonesia addresses
  - Cascading selection: province → kabupaten (→ optionally kecamatan → kelurahan)
  - Per-province code-splitting so only relevant data loads on demand
  - Non-Indonesia addresses fall back to plain text inputs
  - Reuse the existing `src/components/ui/combobox.tsx` (Base UI)

- **Non-Goals:**
  - Postal code lookup (not in the wilayah dataset)
  - Server-side search/API for region data
  - Address validation or geocoding
  - Supporting countries other than Indonesia with structured dropdowns

## Decisions

### Decision 1: Per-province chunk files via dynamic import

- **What:** Parse `wilayah.sql` into `src/data/wilayah/provinces.ts` (38 entries, ~1KB) and `src/data/wilayah/[code].ts` per province (kabupaten + kecamatan + kelurahan for that province)
- **Why:** Loading all 91K rows (~3MB JSON) on page load kills performance. Per-province chunks average ~2,400 entries (~50-80KB each) and load only when a province is selected.
- **Alternatives considered:**
  - Single large JSON file: rejected — 3MB upfront load, no tree-shaking
  - IndexedDB cache: rejected — adds complexity, no database requirement
  - Compressed binary format: rejected — over-engineering for this use case

### Decision 2: Build-time SQL parser script

- **What:** `scripts/parse-wilayah.ts` reads `wilayah.sql`, extracts `(kode, nama)` pairs, and generates TypeScript files
- **Why:** One-time generation, output is type-safe and tree-shakable. Run manually when data updates.
- **Alternatives considered:**
  - Runtime SQL parsing: rejected — unnecessary runtime cost
  - Manual JSON conversion: rejected — error-prone with 91K rows

### Decision 3: Two-level cascade minimum (Province → Kabupaten)

- **What:** Province and Kabupaten are required cascading comboboxes. Kecamatan and Kelurahan are optional additional fields.
- **Why:** Province → City is the standard address format. Kecamatan/Kelurahan adds precision but also UI complexity. Start with two levels, extend if needed.

### Decision 4: Reuse existing Combobox component

- **What:** Use the Base UI Combobox from `src/components/ui/combobox.tsx` with `ComboboxInput`, `ComboboxContent`, `ComboboxList`, `ComboboxItem`
- **Why:** Already styled, accessible, and supports search filtering out of the box.

### Decision 5: Shared AddressFields component

- **What:** Extract the address grid (City, State, Postal, Country) into a reusable `AddressFields` component that both From and Bill To sections use.
- **Why:** Both sections have identical address logic. Duplicating cascading state management would be error-prone.

## Risks / Trade-offs

- **Bundle size:** Per-province chunks are ~50-80KB each. If a user switches provinces rapidly, multiple chunks load. Mitigation: chunks are cached by the bundler after first load.
- **Generated file count:** 38 province files + 1 provinces file = 39 files in `src/data/wilayah/`. Mitigation: these are auto-generated and gitignored (or committed once).
- **Combobox performance with large lists:** Kabupaten lists are 5-30 items (fine). Kecamatan per kabupaten could be 5-50+ items (still fine for Base UI Combobox virtual scrolling).

## Open Questions

- Should generated wilayah data files be committed to git or gitignored with the parser script as the source of truth?
- Should kecamatan/kelurahan fields be included in v1 or deferred?
