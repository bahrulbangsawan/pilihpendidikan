## ADDED Requirements

### Requirement: PDF File Upload Restriction
The attachment system SHALL accept only PDF files (MIME type `application/pdf`). All other file types SHALL be rejected by the file picker and drop zone.

#### Scenario: User attaches a PDF file
- **WHEN** the user clicks the `+` button or drags a file into the composer
- **THEN** the file picker SHALL only show `.pdf` files
- **AND** a valid PDF SHALL appear as an attachment thumbnail in the composer

#### Scenario: User attempts to attach a non-PDF file
- **WHEN** the user drags a `.docx`, `.jpg`, or other non-PDF file into the drop zone
- **THEN** the file SHALL be rejected and not appear in the composer

### Requirement: Client-Side PDF Text Extraction
The system SHALL extract text content from uploaded PDF files entirely on the client side using `pdfjs-dist`, without sending the file to any server.

#### Scenario: Text-based PDF uploaded
- **WHEN** a user attaches a text-based PDF
- **THEN** the system SHALL extract all text content page by page
- **AND** store the extracted text as `text` content parts on the attachment

#### Scenario: Scanned or image-only PDF uploaded
- **WHEN** a user attaches a PDF that contains only images (no extractable text)
- **THEN** the system SHALL detect that no text was extracted
- **AND** the extracted content SHALL be empty (graceful degradation, no crash)

#### Scenario: Large PDF text truncation
- **WHEN** the extracted text exceeds 15,000 characters
- **THEN** the system SHALL truncate to the first 15,000 characters
- **AND** append a note indicating the text was truncated

### Requirement: PDF Content Included in AI Messages
The OpenRouter adapter SHALL include extracted PDF text content in the API request when a user message has attachments with text content.

#### Scenario: Message sent with PDF attachment
- **WHEN** the user sends a message with an attached PDF
- **THEN** the extracted PDF text SHALL be prepended to the user's message content in the API request
- **AND** the text SHALL be formatted as: `"--- Uploaded CV (PDF) ---\n{extracted text}\n--- End of uploaded CV ---"`

#### Scenario: Message sent without attachments
- **WHEN** the user sends a message without any attachments
- **THEN** the API request SHALL behave exactly as before (no change to existing behavior)

### Requirement: System Prompt CV Import Instruction
The system prompt SHALL include guidance for the AI to parse uploaded CV text and map it to the appropriate CV sections using `<apply>` tags.

#### Scenario: AI receives a message with uploaded CV text
- **WHEN** the AI receives a user message containing uploaded CV text
- **AND** the user asks to import or update their CV
- **THEN** the AI SHALL parse the raw CV text and generate `<apply>` blocks for each identified section (personal-info, summary, experience, education, skills, etc.)

### Requirement: Dynamic Import for Bundle Optimization
The `pdfjs-dist` library SHALL be loaded via dynamic import (`import()`) only when a user actually attaches a PDF file, to avoid increasing the initial bundle size.

#### Scenario: Page loads without PDF attachment
- **WHEN** the page loads normally without any PDF upload interaction
- **THEN** `pdfjs-dist` SHALL NOT be included in the initial JavaScript bundle

#### Scenario: First PDF attachment triggers library load
- **WHEN** the user attaches their first PDF in the session
- **THEN** `pdfjs-dist` SHALL be dynamically imported at that point
