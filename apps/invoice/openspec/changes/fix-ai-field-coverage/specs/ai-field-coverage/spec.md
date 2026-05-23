## ADDED Requirements

### Requirement: Full Experience Field Coverage

The AI assistant SHALL serialize and parse all ExperienceEntry fields: company, url, title, workType, locationPolicy, startDate, endDate, current, and description.

#### Scenario: AI reads experience URL

- **WHEN** user has an experience entry with a company URL
- **THEN** the serialized CV text includes the URL so the AI can reference it

#### Scenario: AI writes full experience entry

- **WHEN** the AI generates an experience apply block with pipe-delimited fields
- **THEN** handleApplyAction parses company, url, title, workType, locationPolicy, startDate, endDate, and description into the correct ExperienceEntry fields

### Requirement: Full Education Field Coverage

The AI assistant SHALL serialize and parse the `gpa` and `category` fields for EducationEntry.

#### Scenario: AI reads education GPA

- **WHEN** user has an education entry with a GPA value
- **THEN** the serialized CV text includes the GPA

#### Scenario: AI writes education with GPA and category

- **WHEN** the AI generates an education apply block
- **THEN** handleApplyAction parses gpa and category into the correct EducationEntry fields

### Requirement: Award URL Coverage

The AI assistant SHALL serialize and parse the `url` field for AwardEntry.

#### Scenario: AI reads award URL

- **WHEN** user has an award with a URL
- **THEN** the serialized CV text includes the URL

#### Scenario: AI writes award with URL

- **WHEN** the AI generates an award apply block
- **THEN** handleApplyAction parses the url field

### Requirement: Certificate URL Coverage

The AI assistant SHALL serialize and parse the `url` field for CertificateEntry.

#### Scenario: AI reads certificate URL

- **WHEN** user has a certificate with a URL
- **THEN** the serialized CV text includes the URL

#### Scenario: AI writes certificate with URL

- **WHEN** the AI generates a certificate apply block
- **THEN** handleApplyAction parses the url field

## REMOVED Requirements

### Requirement: Legacy cv-tools.ts Apply Function

**Reason**: The `applySuggestionToCV` function in cv-tools.ts is dead code — all apply logic is handled by handleApplyAction in cv-assistant.tsx. The legacy function returns data unchanged for education, skills, awards, certificates, and languages.
**Migration**: No migration needed — no code imports or calls this function for actual mutations.
