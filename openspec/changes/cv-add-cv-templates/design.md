# Design: CV Template System

## Architecture

### Type Definition

```typescript
// Exported from src/components/cv-form.tsx
export type CVStyle = "basic" | "harvard" | "simple" | "standard"
```

### File Structure

```
src/components/
  cv-preview.tsx          # Switcher: renders correct preview by style
  cv-pdf.tsx              # Switcher: renders correct PDF Document by style
  templates/
    basic-preview.tsx     # Extracted from current cv-preview.tsx
    basic-pdf.tsx         # Extracted from current cv-pdf.tsx
    harvard-preview.tsx   # Harvard HTML preview
    harvard-pdf.tsx       # Harvard PDF template
    simple-preview.tsx    # Simple HTML preview
    simple-pdf.tsx        # Simple PDF template
    standard-preview.tsx  # Standard HTML preview
    standard-pdf.tsx      # Standard PDF template
```

### Component Contracts

Each preview template:
- Props: `{ data: CVData }`
- Must include `id="cv-content"` on root `<article>`
- Uses Tailwind CSS for styling
- Returns `null` placeholder when no content exists

Each PDF template:
- Named export: `CVDocument`
- Props: `{ data: CVData }`
- Returns `<Document><Page>...</Page></Document>`
- Uses `@react-pdf/renderer` primitives
- Uses `wrap={false}` on multi-line entries

### Switcher Pattern

```typescript
// cv-preview.tsx
export function CVPreview({ data, style }: { data: CVData; style: CVStyle }) {
  switch (style) {
    case "harvard": return <HarvardPreview data={data} />
    case "simple":  return <SimplePreview data={data} />
    case "standard": return <StandardPreview data={data} />
    default:        return <BasicPreview data={data} />
  }
}
```

```typescript
// cv-pdf.tsx
export function CVDocument({ data, style }: { data: CVData; style: CVStyle }) {
  // Same switch pattern
}
```

### Style Selector UI

Button group in the preview toolbar using existing `Button` component:

```
[Basic] [Harvard] [Simple] [Standard]    [Download PDF]
```

Active style gets `variant="default"`, others get `variant="outline"`.

### State Flow

```
index.tsx
  └─ style: CVStyle (state)
  ├─ CVPreview  ← receives style prop → delegates to template
  └─ handleDownloadPDF() ← uses style → imports correct PDF template
```

## Design Decisions

### Why switcher components instead of a registry/config?
A simple switch statement is the most readable approach for 4 templates. A registry pattern would add abstraction without benefit at this scale.

### Why paired files (preview + PDF) instead of a single template?
HTML (Tailwind) and PDF (@react-pdf/renderer) use completely different rendering systems. They cannot share components. Pairing them by name makes the correspondence clear.

### Why not dynamic imports for previews?
Preview components are small and render synchronously. Dynamic imports would add loading states and complexity for no meaningful bundle savings. PDF templates are already dynamically imported in `handleDownloadPDF`.

## Style Specifications

### Harvard
- **Header**: centered, name 20px bold, contact below in smaller text
- **Colors**: section headers #1a4f7c (blue), body text #333
- **Section headers**: centered, uppercase, with horizontal rules above and below
- **Experience**: title + company left, location + dates right on same row
- **Spacing**: tighter than Basic, more content per page

### Simple
- **Header**: centered, name 20px bold, contact with bullet separators
- **Colors**: section headers #1a4f7c (blue), body text #333
- **Section headers**: left-aligned, normal case (not uppercase), bottom border only
- **Experience**: standard stacked layout (like Basic but with blue headers)
- **Spacing**: clean, moderate whitespace

### Standard
- **Header**: two-column — name+title left, contact right-aligned
- **Colors**: neutral palette like Basic (#171717, #737373)
- **Section headers**: left-aligned, not uppercase, bottom border
- **Experience**: standard stacked layout
- **Spacing**: slightly more compact than Basic
