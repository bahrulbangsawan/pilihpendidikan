## ADDED Requirements

### Requirement: Invoice AI System Prompt

The system SHALL provide an AI assistant (via assistant-ui modal + OpenRouter) that understands invoice context and can generate/edit invoice data using `<apply section="...">` tags.

Valid sections: `invoice-details`, `from`, `bill-to`, `items`, `notes`

#### Scenario: Natural language to line items

- **WHEN** the user says "bill for 3 hours of consulting at $150/hr"
- **THEN** the AI SHALL respond with an `<apply section="items">` tag containing a properly formatted line item with description="Consulting", qty=3, unitPrice=150, amount=450

#### Scenario: Full invoice from description

- **WHEN** the user mentions `@all` (e.g., "Create an invoice @all for John Smith at john@example.com for 5 hours of web development at $100/hr")
- **THEN** the AI SHALL generate separate `<apply>` blocks for each section it can populate (bill-to, items, and optionally invoice-details)

#### Scenario: Off-topic rejection

- **WHEN** the user asks a non-invoice question
- **THEN** the AI SHALL respond "I can only help with invoice content."

### Requirement: Invoice AI Suggestions

The system SHALL display contextual suggestion chips in the AI modal based on current invoice state.

#### Scenario: Empty invoice suggestions

- **WHEN** invoice has no items
- **THEN** suggestions SHALL include "Create a sample invoice" and "Add line items from description"

#### Scenario: Populated invoice suggestions

- **WHEN** invoice has items
- **THEN** suggestions SHALL include "Add more items", "Review totals", and "Format for client"

### Requirement: Invoice Section Mentions

The system SHALL support `@mention` syntax for targeting specific invoice sections: `@invoice-details`, `@from`, `@bill-to`, `@items`, `@notes`, `@all`.

#### Scenario: Mention parsing

- **WHEN** user message contains `@items`
- **THEN** the system prompt SHALL focus on the items section and the AI response SHALL use `<apply section="items">`

### Requirement: PDF Invoice Import

The system SHALL accept PDF uploads via the AI assistant and extract invoice data from the uploaded PDF text.

#### Scenario: PDF upload parsing

- **WHEN** user uploads a PDF invoice
- **THEN** the AI SHALL parse sender info, recipient info, line items, and totals from the PDF text and generate `<apply>` blocks for each extractable section
