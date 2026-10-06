## ADDED Requirements

### Requirement: Critical Path Bundle Budget

The application SHALL keep critical-path JavaScript (all chunks required for initial render) under 550 KB uncompressed. Heavy dependencies that are not needed for initial render (PDF renderer, AI assistant, DnD library) SHALL be lazy-loaded.

#### Scenario: Initial page load ships only essential chunks

- **WHEN** a user loads the invoice generator page
- **THEN** only the main React bundle, router, form components, and icon chunks are loaded eagerly
- **AND** the total uncompressed size of eagerly-loaded JS is under 550 KB

#### Scenario: DnD library is deferred

- **WHEN** the page loads
- **THEN** the `@dnd-kit` library is NOT included in the initial JavaScript bundle
- **AND** it is loaded on-demand when the sortable list component first renders

#### Scenario: Preview panel is deferred

- **WHEN** the page loads
- **THEN** the `InvoicePreview` component is lazy-loaded with a Suspense boundary
- **AND** a skeleton fallback is displayed while the preview chunk loads

### Requirement: PDF Renderer Idle Preload

The application SHALL preload the `@react-pdf/renderer` chunk during browser idle time so that the first PDF download does not incur a loading delay.

#### Scenario: Preload on idle

- **WHEN** the initial page render completes and the browser is idle
- **THEN** the `@react-pdf/renderer` and `invoice-pdf` modules are preloaded in the background
- **AND** the preload does NOT block user interaction or degrade initial load performance

#### Scenario: Slow connection guard

- **WHEN** the browser reports a slow network connection (via `navigator.connection`)
- **THEN** the idle preload is skipped to conserve bandwidth

### Requirement: Debounced localStorage Persistence

The application SHALL debounce localStorage writes with a 500ms delay to avoid performance overhead on every keystroke. Data integrity SHALL be preserved by flushing pending writes on page unload.

#### Scenario: Rapid typing does not trigger excessive writes

- **WHEN** a user types quickly into an invoice form field
- **THEN** localStorage is updated at most once every 500ms (not on every keystroke)

#### Scenario: Data preserved on tab close

- **WHEN** a user closes the browser tab while a debounced write is pending
- **THEN** the pending data is flushed to localStorage via a `beforeunload` handler

### Requirement: Optimized Static Assets

Static image assets SHALL use modern formats (WebP) where browser and crawler support permits, to reduce page weight.

#### Scenario: OG image is WebP

- **WHEN** a social media crawler or browser requests the OG image
- **THEN** a WebP-format image is served
- **AND** the file size is under 45 KB

### Requirement: CSS Budget

The application's production CSS bundle SHALL remain under 100 KB uncompressed.

#### Scenario: CSS within budget

- **WHEN** a production build is run
- **THEN** the total CSS output is under 100 KB uncompressed
