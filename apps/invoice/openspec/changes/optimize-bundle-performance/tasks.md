## 1. Bundle Splitting & Lazy Loading

- [x] 1.1 Lazy-load `InvoicePreview` in `invoice-generator.tsx` using `lazy()` + `Suspense` with a skeleton fallback
- [x] 1.2 Create a `SortableWrapper` component that lazy-loads `@dnd-kit/core` and `@dnd-kit/sortable`, update `section-list.tsx` to use it
- [x] 1.3 Update `vite.config.ts` manual chunks: remove `vendor-dnd` from eager chunks (it will auto-split as a lazy dependency)

## 2. Resource Preloading

- [x] 2.1 Add `requestIdleCallback` preload for `@react-pdf/renderer` and `invoice-pdf` modules in `invoice-generator.tsx` (with `navigator.connection` guard for slow networks)
- [ ] 2.2 Add `<link rel="preconnect">` hints in `__root.tsx` for any external origins used — N/A: no static external origins; OpenRouter API is user-configured at runtime

## 3. Image Optimization

- [x] 3.1 Convert `public/og-image.png` to WebP format (59 KB → 22 KB, -63%), update OG meta references in `i18n/index.ts`

## 4. localStorage Optimization

- [x] 4.1 Debounce `saveData()` in `invoice-generator.tsx` with 500ms delay; add `beforeunload` flush to prevent data loss

## 5. CSS Audit

- [x] 5.1 CSS is 113 KB (Tailwind v4 with purge active). The 13 KB overage is from utility classes actually in use — no unused classes to remove.

## 6. Validation

- [x] 6.1 Production build succeeds; critical-path JS reduced from 673 KB → 629 KB (-44 KB / -6.5%)
- [x] 6.2 TypeScript type-check passes with no errors
- [x] 6.3 `beforeunload` handler added to flush pending debounced writes
- [x] 6.4 PDF download uses same dynamic import path; idle preload warms the cache
- [x] 6.5 DnD renders plain accordion fallback while module loads, then upgrades to sortable
