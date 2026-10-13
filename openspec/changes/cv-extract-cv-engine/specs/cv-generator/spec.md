## ADDED Requirements

### Requirement: CV builder uses the shared CV engine
The CV builder (`apps/cv`) SHALL take its document types, empty-document
defaults, PDF templates (`renderCvPdfBlob` from
`@pilihpendidikan/cv-engine/pdf`, loaded by dynamic import on the client
only) and Markdown export from `@pilihpendidikan/cv-engine`, keep only the
HTML previews and editor chrome itself, and its Download PDF and Markdown
outputs MUST stay unchanged by the extraction. (Source: 08 §3.1, §3.3,
§11 T8-01; D-14)

#### Scenario: Download PDF
- **WHEN** a user clicks Download PDF in any of the four templates
- **THEN** the builder renders the PDF with the engine's templates in the browser and the result has the same pages, text and fonts as before the extraction

#### Scenario: Server render stays clean
- **WHEN** the builder's route is rendered on the Worker (SSR)
- **THEN** no `@react-pdf` module is loaded; the engine's PDF subpath is imported only after hydration
