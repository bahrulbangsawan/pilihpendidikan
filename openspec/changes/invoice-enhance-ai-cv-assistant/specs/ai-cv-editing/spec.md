## ADDED Requirements

### Requirement: Personal-info section editing

The AI assistant SHALL support editing personal-info fields (fullName, jobTitle, email, phone, location, linkedIn) via `<apply section="personal-info">` tags using pipe-separated format.

#### Scenario: AI updates personal info fields

- **WHEN** the AI responds with `<apply section="personal-info">John Doe | Software Engineer | john@example.com | +1234567890 | New York, NY | https://linkedin.com/in/johndoe</apply>`
- **THEN** the system SHALL parse the pipe-separated values and update the corresponding `personalInfo` fields in CVData
- **AND** empty pipe segments SHALL preserve the existing field value

#### Scenario: System prompt includes personal-info format

- **WHEN** the system prompt is built
- **THEN** it SHALL include a format example for `personal-info` showing pipe-separated fields (FullName | JobTitle | Email | Phone | Location | LinkedIn)
- **AND** the `Valid sections:` list SHALL include `personal-info`

### Requirement: @all mention support

The AI assistant SHALL support an `@all` mention that targets all CV sections simultaneously.

#### Scenario: User types @all in chat

- **WHEN** the user message contains `@all`
- **THEN** `extractMentions` SHALL return all section keys from `CV_SECTIONS`
- **AND** `buildSystemPromptWithMention` SHALL be called with `undefined` (no focus = all sections visible)

#### Scenario: @all appears in suggestions

- **WHEN** the suggestion list is generated
- **THEN** it SHALL include at least one suggestion that uses `@all` (e.g., "Review @all sections and suggest improvements")

### Requirement: ATS best practices in system prompt

The system prompt SHALL include professional CV writing guidance covering action verbs, quantified achievements, concise bullets, and ATS-friendly formatting rules.

#### Scenario: ATS rules present in prompt

- **WHEN** `buildSystemPrompt` generates the system prompt
- **THEN** it SHALL contain an "ATS & CV BEST PRACTICES" section
- **AND** the section SHALL specify: bullet points over paragraphs, action verbs, quantified achievements, industry keywords, no personal pronouns, no filler words, concise descriptions

### Requirement: Multi-item request interpretation

The system prompt SHALL include explicit guidance on interpreting ambiguous user requests about adding entries with multiple bullet points vs. adding multiple entries.

#### Scenario: Interpretation guide present in prompt

- **WHEN** `buildSystemPrompt` generates the system prompt
- **THEN** it SHALL contain a "USER REQUEST INTERPRETATION" section
- **AND** the section SHALL clarify: "add X with N descriptions" = 1 entry with N bullets (;; separated), "add N experiences" = N separate entries, always preserve existing entries
