## 1. Data Model & Form

- [x] 1.1 Create `src/components/invoice-form.tsx` with `InvoiceData` interface, `InvoiceLineItem`, `InvoiceSubItem`, `SenderInfo`, `RecipientInfo` types, `CURRENCY_OPTIONS` constant, and `formatCurrency(amount, currency)` helper using `Intl.NumberFormat`
- [x] 1.2 Implement Invoice Details section (invoice number with auto-increment from localStorage counter + editable override, date of issue picker, date due picker, currency selector)
- [x] 1.3 Implement From (sender) section (company name, address, city, state, postal code, country, email, logo upload)
- [x] 1.4 Implement Bill To section (recipient name, address, city, state/region, postal code, country, email)
- [x] 1.5 Implement Line Items section with dynamic add/remove, auto-calculated amounts, and optional sub-items
- [x] 1.6 Implement Notes & Settings section (notes textarea, tax rate percentage input)
- [x] 1.7 Create `src/data/sample-invoice.json` with Cloudflare invoice data (from PDF reference)

## 2. Preview & PDF

- [x] 2.1 Create `src/components/invoice-preview.tsx` — single Cloudflare-style HTML template (orange #f48120 accent bar, two-column from/bill-to, line items table with thin gray borders, subtotal/total/amount-due footer)
- [x] 2.2 Create `src/components/invoice-pdf.tsx` — @react-pdf/renderer document matching the same Cloudflare layout (orange bar, table structure, typography hierarchy, "Page X of Y")
- [ ] 2.3 Verify preview and PDF output match the reference PDF side-by-side

## 3. AI Assistant

- [x] 3.1 Create `src/components/ai/invoice-data-context.ts` (InvoiceDataContext replacing CVDataContext)
- [x] 3.2 Create `src/components/ai/invoice-system-prompt.ts` with invoice-specific system prompt (section keys: invoice-details, from, bill-to, items, notes; pipe-delimited format for items; auto-calculate instructions)
- [x] 3.3 Create `src/components/ai/invoice-suggestions.ts` with invoice-specific suggestions (create sample invoice, add line items, calculate totals, format for client)
- [x] 3.4 Create `src/components/ai/invoice-assistant.tsx` (replace cv-assistant.tsx, update applyOneAction for invoice sections, update imports)
- [x] 3.5 Update `src/components/ai/openrouter-adapter.ts` — change `CVSectionKey` → `InvoiceSectionKey` types
- [x] 3.6 Update `src/components/ai/pdf-attachment-adapter.ts` — update for invoice PDF import context

## 4. Page Shell & Cleanup

- [x] 4.1 Rewrite `src/routes/index.tsx` — InvoiceGenerator component, remove template switcher, remove Markdown export, update imports to invoice-\* files, update "Pre-Fill Example" → "Load Sample Invoice"
- [x] 4.2 Update `src/routes/__root.tsx` — meta tags, title, description, OG tags, JSON-LD schema for Invoice Generator
- [x] 4.3 Update `src/styles.css` — rename `.cv-page` class to `.invoice-page`
- [x] 4.4 Delete old CV files: `cv-form.tsx`, `cv-preview.tsx`, `cv-pdf.tsx`, `templates/*.tsx` (8 files), `ai/cv-*.{ts,tsx}` (3 files), `data/sample-cv.json`
- [x] 4.5 Update `package.json` — rename `cv-bahrul` → `invoice-bahrul`

## 5. Verification

- [x] 5.1 Run `bun run dev` — verify form renders with all invoice sections
- [ ] 5.2 Load sample invoice — confirm preview matches Cloudflare PDF layout
- [ ] 5.3 Download PDF — compare side-by-side with `cloudflare-invoice-2026-03-23.pdf`
- [ ] 5.4 Test AI assistant — "Create an invoice for 5 hours of web development at $100/hr billed to John Smith at john@example.com"
- [x] 5.5 Run `bun run build` — zero TypeScript errors
