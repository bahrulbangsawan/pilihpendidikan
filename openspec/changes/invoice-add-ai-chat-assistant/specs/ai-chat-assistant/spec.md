## ADDED Requirements

### Requirement: BYOK API Key Management

The system SHALL provide a settings dialog where the user can enter, view (masked), and clear their OpenRouter API key. The key SHALL be persisted in `localStorage` and never sent to any server other than OpenRouter's API endpoint.

#### Scenario: User enters API key for the first time

- **WHEN** user opens the AI chat modal and no API key is stored
- **THEN** a settings dialog prompts the user to enter their OpenRouter API key
- **AND** a link to `openrouter.ai/keys` is provided for obtaining a key

#### Scenario: User views stored API key

- **WHEN** user opens the API key settings
- **THEN** the key is displayed in masked form (e.g., `sk-or-...x4f2`)
- **AND** a "Clear Key" button is available to remove the stored key

#### Scenario: Invalid API key

- **WHEN** user enters an invalid API key and attempts to send a message
- **THEN** the system displays a clear error indicating the key is invalid
- **AND** prompts the user to re-enter their key

---

### Requirement: AI Chat Modal

The system SHALL render a floating chat modal (bottom-right corner) using assistant-ui's `AssistantModal` component. The modal SHALL support streaming LLM responses via TanStack AI's `useChat` hook connected to OpenRouter's OpenAI-compatible API.

#### Scenario: User opens chat modal

- **WHEN** user clicks the floating chat button
- **THEN** a modal opens with a chat interface
- **AND** the chat composer is focused and ready for input

#### Scenario: User sends a message

- **WHEN** user types a message and submits
- **THEN** the message is sent to OpenRouter with the CV data as context
- **AND** the AI response streams in real-time in the chat

#### Scenario: Chat without API key

- **WHEN** user attempts to send a message without a stored API key
- **THEN** the settings dialog opens instead of sending the message

---

### Requirement: Interactive Mention System

The system SHALL support `@` mention syntax in the chat composer to reference specific CV sections. Typing `@` SHALL display a suggestion list of available sections: `@summary`, `@experience`, `@education`, `@skills`, `@awards`, `@certificates`, `@languages`, `@personal-info`.

#### Scenario: User mentions a CV section

- **WHEN** user types `@` in the chat composer
- **THEN** a dropdown shows available CV section mentions
- **AND** selecting a mention inserts it as a highlighted token in the composer

#### Scenario: Mentioned section provides context

- **WHEN** user sends a message containing a mention (e.g., `@experience`)
- **THEN** the relevant section data from CVData is included in the AI request context
- **AND** the AI response is focused on that specific section

---

### Requirement: CV Context Injection

The system SHALL inject the current CV data as a system message in every AI request. The system prompt SHALL define the AI's role as a professional CV writing assistant and include the full CV data so the AI can generate contextually relevant content.

#### Scenario: AI receives full CV context

- **WHEN** a chat message is sent to the AI
- **THEN** the system message includes the user's full CV data (personal info, summary, experience, education, skills, awards, certificates, languages)
- **AND** the AI can reference any part of the CV in its response

---

### Requirement: Apply AI Suggestions to CV

The system SHALL provide an "Apply" action on AI responses that contain content suitable for a specific CV section. Clicking "Apply" SHALL update the corresponding CVData field and trigger a re-render of the preview. The user MUST explicitly accept before any form field is modified.

#### Scenario: User applies AI-generated summary

- **WHEN** the AI generates a refined summary and the user clicks "Apply to Summary"
- **THEN** the summary field in the CV form is updated with the AI-generated text
- **AND** the CV preview re-renders immediately

#### Scenario: User declines AI suggestion

- **WHEN** the AI generates a suggestion and the user does not click "Apply"
- **THEN** the CV form fields remain unchanged
- **AND** the suggestion remains visible in the chat history
