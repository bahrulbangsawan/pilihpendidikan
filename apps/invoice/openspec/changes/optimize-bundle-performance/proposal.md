# Change: Optimize Bundle Performance

## Why

The critical-path JavaScript totals **673 KB** (uncompressed), exceeding the 300 KB performance budget by 2.2x. The CSS is 111 KB (over 100 KB budget). While heavy chunks like `@react-pdf/renderer` (1.5 MB) and `vendor-assistant` (467 KB) are already lazy-loaded, the initial page load still ships too much JS before the user can interact. Additionally, static assets (OG image, favicons) use unoptimized formats.

## What Changes

### Bundle splitting & lazy loading

- Lazy-load `@dnd-kit` (43 KB) since drag-and-drop is only used for item reordering inside accordion sections
- Lazy-load `InvoicePreview` component to defer the right panel from the critical path
- Split `invoice-generator` chunk by separating form and preview concerns

### Resource preloading

- Preload `@react-pdf/renderer` on browser idle so PDF download feels instant
- Add `<link rel="preconnect">` for known external origins

### Image optimization

- Convert `og-image.png` (59 KB) to WebP (~35 KB)
- Serve WebP favicon variants where supported

### CSS optimization

- Audit and remove unused Tailwind utilities to bring CSS under 100 KB budget

### localStorage persistence

- Debounce `saveData()` calls to avoid writing to localStorage on every keystroke

## Impact

- Affected specs: None (no existing specs; this creates `bundle-performance`)
- Affected code:
  - `src/components/invoice-generator.tsx` (lazy imports, idle preload)
  - `src/components/invoice-form.tsx` (debounced save, lazy DnD wrapper)
  - `src/components/form/section-list.tsx` (lazy DnD wrapper)
  - `src/routes/__root.tsx` (preconnect hints)
  - `vite.config.ts` (chunk strategy updates)
  - `public/og-image.png` (format conversion)
