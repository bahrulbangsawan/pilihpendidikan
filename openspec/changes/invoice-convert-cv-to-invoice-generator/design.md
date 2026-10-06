## Context

This is a full application pivot: CV Generator → Invoice Generator. The existing TanStack Start + React + shadcn/ui + @react-pdf/renderer + assistant-ui stack remains. The Cloudflare invoice PDF (`cloudflare-invoice-2026-03-23.pdf`) serves as the exact visual specification for both the HTML preview and PDF output.

### Stakeholders

- End users who need to generate professional invoices
- AI assistant users who want natural-language invoice creation

### Constraints

- Must keep the split-panel (form left, preview right) UX pattern
- Must keep the AI assistant modal (assistant-ui + OpenRouter)
- Must keep @react-pdf/renderer for PDF generation
- Must deploy on Cloudflare Workers via TanStack Start
- Invoice visual output must match the Cloudflare reference PDF exactly

## Goals / Non-Goals

### Goals

- Replace CV data model with Invoice data model (metadata, from/to addresses, line items)
- Create a single invoice template matching Cloudflare's visual style (orange accent bar, two-column header, tabular line items)
- Repurpose AI assistant for invoice context (natural-language → line items, auto-calculate totals)
- Keep all reusable infrastructure (SectionList, FormField, accordion patterns, DnD, download dropdown)

### Non-Goals

- Multiple invoice templates (only one Cloudflare-style template for now)
- Multi-currency conversion or payment integration
- Invoice numbering persistence or database storage
- Email/send invoice functionality

## Decisions

### 1. Single template vs. multiple templates

**Decision**: Single Cloudflare-style template only.
**Why**: The reference PDF is the single source of truth. Template variety adds complexity without being requested. Can be added later as a separate change.

### 2. Line items with sub-items

**Decision**: Support optional `subItems[]` array per line item.
**Why**: The Cloudflare invoice uses indented sub-rows (e.g., "First 10", "First 500") under parent items. This is a structural requirement from the reference PDF.

### 3. Auto-calculation approach

**Decision**: `amount = qty * unitPrice` computed in the form component, stored but always recalculated on render. Tax applied to subtotal.
**Why**: Keeps the data model simple. The form auto-fills `amount` but allows override for edge cases (discounts, flat-fee items). Same approach for `subtotal → tax → total` in preview/PDF.

### 4. AI section mapping

**Decision**: Replace CV's 10-section `@mention` system with 5 invoice sections: `@invoice-details`, `@from`, `@bill-to`, `@items`, `@notes`. Keep `@all`.
**Why**: Direct mapping to the 5 form accordion sections. Simpler than CV's 10 sections. The `<apply section="...">` tag pattern is proven and stays.

### 5. File renaming strategy

**Decision**: Create new files with `invoice-` prefix, then delete old `cv-` files. Do not rename in-place (git history is less important than clean diffs).
**Why**: The content changes are so extensive that renaming would create confusing diffs. Clean new files are easier to review.

## Risks / Trade-offs

| Risk                       | Impact                                          | Mitigation                                                             |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| PDF layout fidelity        | Preview may not match PDF pixel-perfectly       | Use same @react-pdf/renderer styles for both; verify side-by-side      |
| AI prompt accuracy         | Invoice AI may generate wrong line item formats | Extensive format examples in system prompt; structured `<apply>` tags  |
| Breaking all existing data | Users with saved CV JSON can't load it          | Expected — this is a full pivot, not backwards-compatible              |
| Sub-items complexity       | Nested DnD or form state management             | Keep sub-items as simple array, no DnD for sub-items (add/remove only) |

## Migration Plan

### Phase 1: Data Model + Form (tasks 1.1–1.4)

Create InvoiceData type, invoice-form component, sample data. This unblocks all other work.

### Phase 2: Preview + PDF (tasks 2.1–2.3)

Create invoice-preview and invoice-pdf matching Cloudflare style. These depend on InvoiceData from Phase 1.

### Phase 3: AI Assistant (tasks 3.1–3.4)

Rename and rewrite AI files. Depends on InvoiceData type and new section keys.

### Phase 4: Page Shell + Cleanup (tasks 4.1–4.5)

Wire everything into index.tsx, update meta/SEO, delete old CV files, rename package.

### Rollback

Git revert to the commit before implementation begins. No database or external service changes.

## Resolved Questions

1. **Invoice numbering**: Auto-increment from localStorage counter (persists across sessions). Format: `IN-XXXXXXXX` where the numeric portion increments. The field remains editable so users can override with their own numbering scheme.
2. **Currency formatting**: Yes. Use `Intl.NumberFormat` with the appropriate locale for each currency (e.g., USD → `$1,000.00`, IDR → `Rp1.000`, EUR → `1.000,00 €`). The `currency` field in InvoiceData drives both the symbol and the thousands/decimal separator formatting throughout preview and PDF.
