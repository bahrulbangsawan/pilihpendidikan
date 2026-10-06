# Capability: Style Selector UI

Adds a style picker to the preview toolbar so users can switch between CV templates.

## ADDED Requirements

### REQ-SS-1: Style state
The `CVGenerator` component shall maintain a `style: CVStyle` state, defaulting to `"basic"`.

#### Scenario: Default style on page load
- **Given** the user opens the CV builder
- **Then** the "Basic" style is selected
- **And** the preview renders the Basic template

### REQ-SS-2: Style selector buttons
The preview toolbar shall display a button group with 4 options: Basic, Harvard, Simple, Standard.

#### Scenario: Selecting a style
- **Given** the user clicks the "Harvard" button
- **Then** the Harvard button shows as active (primary variant)
- **And** all other buttons show as outline variant
- **And** the preview updates to the Harvard template

### REQ-SS-3: Style passed to PDF export
The selected style shall be passed to the PDF generation function so the downloaded PDF matches the preview.

#### Scenario: PDF matches selected style
- **Given** the user has selected "Simple" style
- **When** they click "Download PDF"
- **Then** the generated PDF uses the Simple PDF template
