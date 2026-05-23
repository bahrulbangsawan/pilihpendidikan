# Add CV Template System

## Summary

Add a multi-template system to the CV builder with 4 design styles: Basic (current), Harvard, Simple, and Standard. Users can switch between styles via a selector in the preview toolbar. Both the HTML preview and PDF export render the selected style.

## Motivation

The current CV builder has a single hardcoded layout. Different industries and contexts prefer different CV formats (e.g., academic positions favor the Harvard style). Offering multiple templates increases the tool's utility without changing the underlying data model.

## Scope

### In scope

- Extract current layout into a "Basic" template
- Create 3 new templates: Harvard, Simple, Standard (preview + PDF each)
- Style selector UI in the preview toolbar
- Pass selected style to both preview and PDF export

### Out of scope

- Custom color pickers or user-defined themes
- Template-specific data fields
- Template persistence (localStorage, URL state)
- Font changes (all templates use Helvetica)

## Reference Designs

### Basic (current)

Left-aligned name, neutral gray palette, uppercase section headers with bottom border, bullet-point descriptions.

### Harvard

- Centered name and contact info at top
- Blue (#1a4f7c) section headers, centered, with horizontal rules above and below
- Experience entries: job title + company left-aligned, location + dates right-aligned on the same line
- Formal academic layout, denser spacing

### Simple

- Centered name and contact info
- Blue (#1a4f7c) section headers, left-aligned with bottom border
- Cleaner separation between sections
- Lighter visual weight than Harvard

### Standard

- Two-column header: name + job title on left, contact info on right
- Neutral color palette (like Basic)
- Slightly more compact spacing than Basic
- Section headers with bottom border, not uppercase

## Approach

1. Define `CVStyle` type exported from `cv-form.tsx`
2. Create `src/components/templates/` directory with paired preview + PDF files per style
3. Convert `cv-preview.tsx` and `cv-pdf.tsx` into switcher components that delegate to the correct template
4. Add style state and selector UI in `index.tsx`

## Risks

- **PDF layout drift**: Each PDF template must be independently tested to ensure it matches its preview counterpart
- **Bundle size**: 8 new template files. Mitigated by dynamic imports for PDF templates (already using `await import()`)
