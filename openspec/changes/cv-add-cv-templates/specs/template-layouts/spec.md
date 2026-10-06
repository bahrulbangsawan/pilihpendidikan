# Capability: Template Layouts

Defines the 4 CV template layouts (Basic, Harvard, Simple, Standard) for both HTML preview and PDF export.

## ADDED Requirements

### REQ-TL-1: Basic template
The Basic template shall match the current cv-preview.tsx and cv-pdf.tsx layout exactly (left-aligned name, neutral palette, uppercase section headers).

#### Scenario: Basic template preserves current design
- **Given** sample CV data is loaded
- **When** Basic style is selected
- **Then** the preview matches the original pre-template design

### REQ-TL-2: Harvard template
The Harvard template shall render a centered header, blue (#1a4f7c) section headers with horizontal rules, and experience entries with title/company left and location/dates right-aligned.

#### Scenario: Harvard section headers are blue and centered
- **Given** sample CV data with experience entries
- **When** Harvard style is selected
- **Then** section headers display in #1a4f7c blue, centered, with rules above and below
- **And** experience entries show title left and dates right on the same line

### REQ-TL-3: Simple template
The Simple template shall render a centered header, blue (#1a4f7c) section headers left-aligned with bottom border, and clean section separation.

#### Scenario: Simple template uses blue headers
- **Given** sample CV data
- **When** Simple style is selected
- **Then** section headers are blue (#1a4f7c), left-aligned, with bottom border
- **And** the name is centered at the top

### REQ-TL-4: Standard template
The Standard template shall render a two-column header (name+title left, contact right), neutral colors, and non-uppercase section headers with bottom border.

#### Scenario: Standard header is two-column
- **Given** sample CV data with personal info
- **When** Standard style is selected
- **Then** name and job title appear left-aligned
- **And** contact info appears right-aligned on the same row

### REQ-TL-5: All templates render all sections
Every template shall render all CV sections: header, summary, experience, education, skills, awards, certificates, languages.

#### Scenario: Complete data renders in all styles
- **Given** sample CV data with all sections filled
- **When** each style is selected in turn
- **Then** all sections are visible in the preview for each style

### REQ-TL-6: Font consistency
All templates shall use Helvetica font family. No template shall introduce a different font.

#### Scenario: Helvetica used across all styles
- **Given** any style is selected
- **Then** the PDF uses `fontFamily: "Helvetica"`
- **And** the preview inherits the global Helvetica/Arial font stack
