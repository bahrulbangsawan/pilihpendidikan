# Capability: Template System Architecture

Sets up the type, file structure, and switcher components for the multi-template CV system.

## ADDED Requirements

### REQ-TS-1: CVStyle type

The system shall export a `CVStyle` type from `src/components/cv-form.tsx` with values `"basic" | "harvard" | "simple" | "standard"`.

#### Scenario: Type is importable

- **Given** a component imports `CVStyle` from `@/components/cv-form`
- **Then** it can use it to type a style variable
- **And** TypeScript accepts all four string literals

### REQ-TS-2: Preview switcher

The `CVPreview` component shall accept a `style: CVStyle` prop and render the corresponding template component.

#### Scenario: Switching preview style

- **Given** the user selects "Harvard" style
- **When** the preview renders
- **Then** the Harvard template is displayed
- **And** the element has `id="cv-content"`

### REQ-TS-3: PDF switcher

The `CVDocument` component shall accept a `style: CVStyle` prop and render the corresponding PDF template.

#### Scenario: Downloading with selected style

- **Given** the user selects "Simple" style
- **When** they click "Download PDF"
- **Then** the downloaded PDF uses the Simple layout

### REQ-TS-4: Template file structure

Each style shall have two files under `src/components/templates/`: `{style}-preview.tsx` and `{style}-pdf.tsx`.

#### Scenario: All template files exist

- **Given** the codebase
- **Then** 8 template files exist: basic-preview, basic-pdf, harvard-preview, harvard-pdf, simple-preview, simple-pdf, standard-preview, standard-pdf
