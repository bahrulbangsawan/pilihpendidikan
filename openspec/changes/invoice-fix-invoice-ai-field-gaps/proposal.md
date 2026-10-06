# Change: Fix AI invoice assistant field coverage gaps

## Why

The AI assistant cannot read or write all InvoiceData fields. Several fields are missing from serialization (AI can't see them), the apply parser (AI can't update them), and the system prompt format docs (AI doesn't know the format). Additionally, `@adjustments` is missing from the mention regex — users typing `@adjustments` get no focused section editing.

## Coverage Matrix (Current State)

### Invoice Details

| Field         | Serialized           | Writable | In Prompt |
| ------------- | -------------------- | -------- | --------- |
| invoiceNumber | YES                  | YES      | YES       |
| dateOfIssue   | YES                  | YES      | YES       |
| dateDue       | YES                  | YES      | YES       |
| currency      | YES                  | YES      | YES       |
| accentColor   | NO                   | NO       | NO        |
| taxRate       | YES (in Totals only) | NO       | NO        |

### From (SenderInfo)

| Field       | Serialized | Writable | In Prompt |
| ----------- | ---------- | -------- | --------- |
| companyName | YES        | YES      | YES       |
| address     | YES        | YES      | YES       |
| city        | YES        | YES      | YES       |
| kecamatan   | NO         | NO       | NO        |
| state       | YES        | YES      | YES       |
| postalCode  | YES        | YES      | YES       |
| country     | YES        | YES      | YES       |
| email       | YES        | YES      | YES       |
| logoUrl     | NO         | NO       | NO        |

> logoUrl: Intentionally excluded — AI cannot generate logo images.

### Bill To (RecipientInfo)

| Field       | Serialized | Writable | In Prompt |
| ----------- | ---------- | -------- | --------- |
| name        | YES        | YES      | YES       |
| address     | YES        | YES      | YES       |
| city        | YES        | YES      | YES       |
| kecamatan   | NO         | NO       | NO        |
| stateRegion | YES        | YES      | YES       |
| postalCode  | YES        | YES      | YES       |
| country     | YES        | YES      | YES       |
| email       | YES        | YES      | YES       |

### Items (InvoiceLineItem)

| Field       | Serialized     | Writable       | In Prompt |
| ----------- | -------------- | -------------- | --------- |
| description | YES            | YES            | YES       |
| period      | YES            | YES            | YES       |
| qty         | YES            | YES            | YES       |
| unitPrice   | YES            | YES            | YES       |
| amount      | YES (computed) | YES (computed) | YES       |
| subItems    | YES            | YES            | YES       |

> Full coverage.

### Adjustments (InvoiceAdjustment)

| Field | Serialized | Writable | In Prompt |
| ----- | ---------- | -------- | --------- |
| label | YES        | YES      | YES       |
| type  | YES        | YES      | YES       |
| mode  | YES        | YES      | YES       |
| value | YES        | YES      | YES       |

> Full coverage — BUT `@adjustments` missing from MENTION_REGEX.

### Custom Fields (InvoiceCustomField)

| Field | Serialized | Writable | In Prompt |
| ----- | ---------- | -------- | --------- |
| label | NO         | NO       | NO        |
| value | NO         | NO       | NO        |

> No coverage at all — section doesn't exist in AI system.

### Notes

| Field | Serialized | Writable | In Prompt |
| ----- | ---------- | -------- | --------- |
| notes | YES        | YES      | YES       |

> Full coverage.

## Summary of Gaps

1. **`@adjustments` not in MENTION_REGEX** — critical bug: typing `@adjustments` doesn't trigger focused editing
2. **`taxRate`** — serialized in Totals but not writable via invoice-details section
3. **`accentColor`** — not serialized, not writable (intentionally skip — design choice, not data)
4. **`from.kecamatan`** — not serialized, not writable (Indonesia subdistrict field)
5. **`billTo.kecamatan`** — not serialized, not writable (Indonesia subdistrict field)
6. **`customFields`** — no section handler, not in section keys, not serialized
7. **`from.logoUrl`** — not serialized, not writable (intentionally skip — AI can't generate images)

## What Changes

- **MENTION_REGEX** — add `adjustments` to the regex pattern
- **serializeInvoice()** — add `kecamatan` to From/Bill To serialization, add `taxRate` to Invoice Details line
- **applyOneAction()** — add `kecamatan` to from/bill-to field arrays, add `taxRate` parsing to invoice-details
- **System prompt** — update pipe-delimited format docs to include new fields
- **Custom fields** — add `custom-fields` section to INVOICE_SECTION_KEYS, serializer, parser, prompt, and mention regex

## Impact

- Affected code: `invoice-system-prompt.ts`, `invoice-assistant.tsx`, `invoice-suggestions.ts`
- No breaking changes — additive field support + bug fix
