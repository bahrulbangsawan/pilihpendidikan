## Context

This is a TanStack Start + Cloudflare Workers SSR application. The invoice generator is a single-page tool with a split-panel layout: form on the left, live preview on the right. Heavy dependencies (`@react-pdf/renderer`, `@assistant-ui/react`, `pdfjs-dist`) are already lazy-loaded. The remaining critical-path budget overshoot comes from the DnD library, the combined form+preview chunk, and the main React bundle.

### Current Critical Path (uncompressed)

| Chunk                                     | Size       |
| ----------------------------------------- | ---------- |
| `main` (React, ReactDOM, shared)          | 223 KB     |
| `vendor-router` (TanStack Router)         | 132 KB     |
| `invoice-generator` (form + preview + UI) | 264 KB     |
| `vendor-dnd` (@dnd-kit)                   | 43 KB      |
| `vendor-icons` (lucide-react)             | 11 KB      |
| **Total**                                 | **673 KB** |

### Target Critical Path

| Chunk           | Size        | Change                 |
| --------------- | ----------- | ---------------------- |
| `main`          | 223 KB      | No change (React core) |
| `vendor-router` | 132 KB      | No change              |
| `invoice-form`  | ~150 KB     | Split from generator   |
| `vendor-icons`  | 11 KB       | No change              |
| **Total**       | **~516 KB** | **-157 KB (-23%)**     |

Deferred to lazy:

- `invoice-preview` (~114 KB) - loaded after form hydrates
- `vendor-dnd` (43 KB) - loaded when user opens item accordion

## Goals / Non-Goals

### Goals

- Reduce critical-path JS from 673 KB to under 550 KB
- Lazy-load DnD and preview components
- Preload PDF renderer on idle for perceived performance
- Optimize static assets (OG image format)
- Debounce localStorage writes

### Non-Goals

- Replacing `@react-pdf/renderer` with a lighter alternative (too invasive)
- Server-side PDF generation (requires different architecture)
- Service worker caching (premature for current traffic)
- Font optimization (no custom fonts loaded; uses system stack)

## Decisions

### 1. Lazy-load InvoicePreview with Suspense

- **Decision**: Wrap `InvoicePreview` in `lazy()` + `Suspense` with a skeleton fallback
- **Why**: Preview is below-fold on mobile and only needed after form data exists. Deferring it saves ~114 KB from the critical path.
- **Alternative**: Code-split at route level. Rejected because both panels are on the same route.

### 2. Lazy-load @dnd-kit via wrapper component

- **Decision**: Create a `SortableWrapper` that lazy-loads `@dnd-kit/core` and `@dnd-kit/sortable` on first render
- **Why**: DnD is only used inside `SectionList` for reordering items. Users may never reorder items, so 43 KB is wasted for most sessions.
- **Alternative**: Remove DnD entirely and use move-up/move-down buttons. Rejected because drag-and-drop is a better UX.

### 3. Idle preload for react-pdf

- **Decision**: Use `requestIdleCallback` to preload the `@react-pdf/renderer` chunk after initial render
- **Why**: The 1.5 MB PDF chunk causes a noticeable delay on first download click. Preloading during idle eliminates perceived latency.
- **Trade-off**: Uses bandwidth even if user never downloads. Acceptable because the app's primary purpose is PDF generation.

### 4. Debounce localStorage writes

- **Decision**: Debounce `saveData()` with a 500ms delay
- **Why**: Currently every keystroke triggers `JSON.stringify` + `localStorage.setItem`. On large invoices with many items, this causes micro-jank on low-end devices.

### 5. WebP for OG image

- **Decision**: Convert `og-image.png` to WebP format
- **Why**: WebP delivers ~40% smaller file size. All social media crawlers that support OG images support WebP.
- **Risk**: Some very old crawlers may not support WebP. Mitigation: keep PNG as fallback if needed.

## Risks / Trade-offs

| Risk                                        | Impact   | Mitigation                                                      |
| ------------------------------------------- | -------- | --------------------------------------------------------------- |
| Lazy preview causes layout shift            | Medium   | Use fixed-height skeleton placeholder                           |
| Idle preload wastes bandwidth on mobile     | Low      | Only preload on non-slow connections via `navigator.connection` |
| Debounced save may lose data on tab close   | Low      | Flush on `beforeunload` event                                   |
| WebP OG image not supported by old crawlers | Very Low | Monitor with Search Console                                     |

## Open Questions

- None. All decisions are straightforward with low risk.
