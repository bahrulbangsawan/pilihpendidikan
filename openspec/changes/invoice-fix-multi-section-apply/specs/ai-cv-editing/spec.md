## ADDED Requirements

### Requirement: Multi-section focus targeting

The system prompt builder SHALL accept an array of section keys and generate focus instructions that list all targeted sections, instructing the AI to emit a separate `<apply>` block for each.

#### Scenario: User mentions two sections

- **WHEN** the user message contains `@experience` and `@skills`
- **THEN** `extractMentions` SHALL return `["experience", "skills"]`
- **AND** the system prompt SHALL include focus text naming both sections
- **AND** the AI response SHALL contain separate `<apply section="experience">` and `<apply section="skills">` blocks

#### Scenario: User mentions three or more sections

- **WHEN** the user message contains `@summary`, `@education`, and `@languages`
- **THEN** the system prompt SHALL list all three sections in the focus instruction
- **AND** the prompt SHALL include the MULTI-SECTION EDITING instruction block with a concrete example of multiple `<apply>` blocks

#### Scenario: Single mention still works

- **WHEN** the user message contains only `@summary`
- **THEN** the system prompt SHALL focus on `summary` alone (backward compatible)

#### Scenario: @all mention still works

- **WHEN** the user message contains `@all`
- **THEN** `buildSystemPromptWithMention` SHALL be called with `undefined` (no specific focus, all sections visible)

### Requirement: Batch action application

The action application pipeline SHALL apply all parsed `<apply>` actions atomically in a single state update, preventing race conditions where later actions overwrite earlier ones.

#### Scenario: Two apply blocks in one response

- **WHEN** the AI response contains `<apply section="experience">...</apply>` followed by `<apply section="skills">...</apply>`
- **THEN** the system SHALL parse both actions
- **AND** apply them sequentially to a local data accumulator
- **AND** call the state setter exactly once with the final accumulated result
- **AND** both the experience and skills sections SHALL reflect the AI's changes

#### Scenario: Single apply block backward compatibility

- **WHEN** the AI response contains exactly one `<apply>` block
- **THEN** the batch handler SHALL apply it identically to the previous single-action behavior

### Requirement: Multi-section prompt instruction

The system prompt SHALL include a MULTI-SECTION EDITING instruction block that explicitly tells the AI to use separate `<apply>` blocks when editing multiple sections.

#### Scenario: Instruction present in generated prompt

- **WHEN** `buildSystemPrompt` generates the system prompt
- **THEN** it SHALL contain a MULTI-SECTION EDITING block
- **AND** the block SHALL include an example showing two `<apply>` blocks for different sections
- **AND** the block SHALL state the AI MUST NOT skip any requested section

## MODIFIED Requirements

### Requirement: @all mention support

The AI assistant SHALL support an `@all` mention that targets all CV sections simultaneously.

#### Scenario: User types @all in chat

- **WHEN** the user message contains `@all`
- **THEN** `extractMentions` SHALL return all section keys from `CV_SECTIONS`
- **AND** `buildSystemPromptWithMention` SHALL be called with `undefined` (no focus = all sections visible)

#### Scenario: @all appears in suggestions

- **WHEN** the suggestion list is generated
- **THEN** it SHALL include at least one suggestion that uses `@all`

#### Scenario: @all with 10 sections triggers undefined path

- **WHEN** mentions array length equals the total number of CV sections (10)
- **THEN** the adapter SHALL pass `undefined` to `buildSystemPromptWithMention` instead of the full array
