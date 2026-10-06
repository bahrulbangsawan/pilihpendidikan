## ADDED Requirements

### Requirement: CV Form Panel

The system SHALL provide a form panel at the `/` route with five sections for CV data entry: Personal Info, Professional Summary, Work Experience, Education, and Skills.

#### Scenario: Personal info fields

- **WHEN** the user visits the `/` route
- **THEN** the form displays input fields for: full name, job title, email, phone, location, and LinkedIn URL

#### Scenario: Professional summary

- **WHEN** the user navigates to the summary section
- **THEN** a textarea is available for entering a professional summary

#### Scenario: Repeatable work experience

- **WHEN** the user clicks "Add Experience"
- **THEN** a new experience entry appears with fields for: company, job title, start date, end date, and description
- **AND** the user can remove any experience entry

#### Scenario: Repeatable education

- **WHEN** the user clicks "Add Education"
- **THEN** a new education entry appears with fields for: institution, degree, start date, and end date
- **AND** the user can remove any education entry

#### Scenario: Skills tag input

- **WHEN** the user types a skill name and presses Enter
- **THEN** the skill is added as a tag
- **AND** the user can click any tag to remove it

### Requirement: CV Preview Panel

The system SHALL render a live CV preview using ATS-friendly semantic HTML that updates in realtime as the user types in the form.

#### Scenario: Semantic HTML structure

- **WHEN** the preview renders
- **THEN** it uses only semantic tags: `<h1>`, `<h2>`, `<h3>`, `<p>`, `<ul>`, `<li>`, `<section>`
- **AND** it contains NO `<table>` elements
- **AND** it uses standard ATS section headings: "Professional Summary", "Work Experience", "Education", "Skills"

#### Scenario: A4 document appearance

- **WHEN** the preview is displayed
- **THEN** it appears as a white card with subtle shadow resembling a printed A4 document
- **AND** it uses clean minimalist design with generous whitespace and clear hierarchy

#### Scenario: Realtime preview updates

- **WHEN** the user modifies any form field
- **THEN** the corresponding section in the preview updates immediately without page reload

### Requirement: Responsive Layout

The system SHALL display the form and preview in a responsive layout that adapts to screen size.

#### Scenario: Desktop layout

- **WHEN** the viewport is md or wider (768px+)
- **THEN** the form panel appears on the left and the preview panel on the right, side-by-side

#### Scenario: Mobile layout

- **WHEN** the viewport is narrower than md (below 768px)
- **THEN** the form panel stacks on top and the preview panel appears below it
