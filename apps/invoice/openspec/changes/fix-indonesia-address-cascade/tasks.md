## 1. Interface & Data Model Updates

- [x] 1.1 Add `kecamatan: string` to `SenderInfo` in `src/components/invoice-form.tsx`
- [x] 1.2 Add `kecamatan: string` to `RecipientInfo` in `src/components/invoice-form.tsx`
- [x] 1.3 Add `kecamatan: string` to `AddressValues` interface in `src/components/form/address-fields.tsx`
- [x] 1.4 Add `kecamatan` to `src/data/sample-invoice.json` for both `from` and `billTo`

## 2. AddressFields Component — Kecamatan Cascade

- [x] 2.1 Add `kecamatanList` state and filtering logic: when kabupaten is selected, filter `provinceData.kecamatan` where `kode.startsWith(selectedKabupaten.kode + ".")`
- [x] 2.2 Add `handleKecamatanChange` callback following the existing `handleKabupatenChange` pattern
- [x] 2.3 Fix cascade resets: province change clears kabupaten + kecamatan + postalCode; kabupaten change clears kecamatan + postalCode; country change clears all
- [x] 2.4 Add Kecamatan Combobox UI between City and Postal Code fields, with disabled states ("Select province first" / "Select kabupaten first")
- [x] 2.5 Update grid layout: `grid-cols-2 lg:grid-cols-5` for Indonesia, `grid-cols-2 lg:grid-cols-4` for non-Indonesia

## 3. Invoice Form Integration

- [x] 3.1 Wire `kecamatan` field for the From section: pass to AddressFields values, handle onChange
- [x] 3.2 Wire `kecamatan` field for the Bill To section: pass to AddressFields values, update the field mapping in onChange handler (line ~612)
- [x] 3.3 Initialize `kecamatan: ""` in default form data and any reset logic

## 4. PDF & Preview Rendering

- [x] 4.1 Update `src/components/invoice-preview.tsx` to include kecamatan in the address line (between city and state)
- [x] 4.2 Update `src/components/invoice-pdf.tsx` to include kecamatan in the address line (between city and state)

## 5. Verification

- [x] 5.1 Run `bun run build` — no type errors
- [ ] 5.2 Manual test: Indonesia cascade — Province → Kabupaten → Kecamatan populates correctly
- [ ] 5.3 Manual test: cascade resets — changing province clears kabupaten, kecamatan, postalCode
- [ ] 5.4 Manual test: non-Indonesia — fields remain plain text inputs
- [ ] 5.5 Manual test: billTo section works identically to From section
- [ ] 5.6 Manual test: kecamatan appears in PDF and preview address output
