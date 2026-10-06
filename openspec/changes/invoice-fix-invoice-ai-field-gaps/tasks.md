## 1. Fix @adjustments mention regex (critical bug)

- [x] 1.1 Add `adjustments` to MENTION_REGEX in `invoice-suggestions.ts` — change pattern to `/@(all|invoice-details|from|bill-to|items|adjustments|custom-fields|notes)\b/g`
- [x] 1.2 Verify `@adjustments` appears in AI suggestions when adjustments section is empty

## 2. Add taxRate to invoice-details section

- [x] 2.1 Update `serializeInvoice()` — add `TaxRate: ${data.taxRate}%` to the `[Invoice Details]` line
- [x] 2.2 Update `applyOneAction()` invoice-details case — parse 5th pipe position as taxRate (number)
- [x] 2.3 Update system prompt format docs — change `(InvoiceNumber | DateOfIssue | DateDue | Currency)` to include `| TaxRate`

## 3. Add kecamatan to From and Bill To

- [x] 3.1 Update `serializeInvoice()` — add `f.kecamatan` and `b.kecamatan` to serialized lines (after city, before state)
- [x] 3.2 Update `applyOneAction()` "from" case — add `kecamatan` to fields array after `city`
- [x] 3.3 Update `applyOneAction()` "bill-to" case — add `kecamatan` to fields array after `city`
- [x] 3.4 Update system prompt format docs — add Kecamatan to From and Bill To pipe examples

## 4. Add custom-fields section

- [x] 4.1 Add `"custom-fields"` to `INVOICE_SECTION_KEYS` and `INVOICE_SECTIONS` in `invoice-system-prompt.ts`
- [x] 4.2 Add custom fields serialization to `serializeInvoice()` — format as `[Custom Fields]\nLabel: Value` lines
- [x] 4.3 Add `case "custom-fields"` to `applyOneAction()` — parse `Label | Value` pipe-delimited lines
- [x] 4.4 Add system prompt format docs for custom-fields section
- [x] 4.5 Add `custom-fields` to MENTION_REGEX in `invoice-suggestions.ts`

## 5. Validation

- [x] 5.1 Run `bun run build` — verify no type errors
- [ ] 5.2 Manual browser test: type `@all Generate a complete invoice for a freelance developer` and verify all sections including custom-fields are populated
- [ ] 5.3 Manual browser test: type `@adjustments Add a 10% early payment discount` and verify focused editing works
