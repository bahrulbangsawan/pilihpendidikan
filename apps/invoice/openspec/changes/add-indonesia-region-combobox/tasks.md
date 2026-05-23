## 1. Data Layer — Parse wilayah.sql into TypeScript chunks

- [x] 1.1 Create `scripts/parse-wilayah.ts` that reads `wilayah.sql`, extracts `(kode, nama)` pairs, and categorizes by hierarchy level (province/kabupaten/kecamatan/kelurahan)
- [x] 1.2 Generate `src/data/wilayah/provinces.ts` — array of `{kode, nama}` for 38 provinces
- [x] 1.3 Generate per-province files `src/data/wilayah/[code].ts` — each containing kabupaten, kecamatan, and kelurahan arrays for that province
- [x] 1.4 Create `src/data/wilayah/index.ts` — export types (`WilayahEntry`, `ProvinceData`) and a `loadProvinceData(code: string)` helper that wraps the dynamic import
- [x] 1.5 Run the parser and verify output: 38 province chunk files generated, `provinces.ts` has 38 entries
- [x] 1.6 Create `src/data/countries.ts` — static array of world country names for the Country combobox

## 2. UI Component — Reusable AddressFields with cascading logic

- [x] 2.1 Create `src/components/form/address-fields.tsx` — a reusable component that renders Country, State/Region, City, Postal Code in a grid
- [x] 2.2 Implement Country combobox using `src/components/ui/combobox.tsx` with search filtering over the countries list
- [x] 2.3 Implement Indonesia detection: when country === "Indonesia", switch State/Region and City from text inputs to comboboxes
- [x] 2.4 Implement Province combobox: populate from `provinces.ts`, searchable, updates parent state on selection
- [x] 2.5 Implement Kabupaten/Kota combobox: dynamically import province data on province selection, populate City combobox with kabupaten list, disable until province is selected
- [x] 2.6 Implement cascade reset: changing province clears city; changing country clears province and city
- [x] 2.7 Keep Postal Code as plain text input regardless of country

## 3. Integration — Wire AddressFields into invoice form

- [x] 3.1 Update `SenderInfo` and `RecipientInfo` interfaces to include optional `district` and `village` fields if kecamatan/kelurahan support is added — _Deferred: keeping v1 at Province → Kabupaten level_
- [x] 3.2 Replace the From section address grid with `<AddressFields>` component
- [x] 3.3 Replace the Bill To section address grid with `<AddressFields>` component (mapped `stateRegion` → `state`)
- [x] 3.4 Verify both sections work independently (selecting Indonesia in From doesn't affect Bill To)

## 4. Verification

- [x] 4.1 Run `bun run build` — no TypeScript or build errors
- [ ] 4.2 Manual test: select Indonesia → province combobox loads → select province → city combobox loads kabupaten
- [ ] 4.3 Manual test: select non-Indonesia country → fields are plain text inputs
- [ ] 4.4 Manual test: switch from Indonesia to another country → cascading fields reset and become text inputs
- [x] 4.5 Verify bundle: province chunk files load on demand (check network tab), not bundled in main chunk
