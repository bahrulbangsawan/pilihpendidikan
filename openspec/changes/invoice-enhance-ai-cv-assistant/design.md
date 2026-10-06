## Context

The AI assistant uses a pipe-delimited text format inside `<apply>` tags to communicate structured data back to the app. Each section has its own parser in `handleApplyAction`. Personal-info is the only section without a parser despite being serialized in the prompt. The `@all` mention requires coordination between `cv-suggestions.ts` (regex + extraction) and `openrouter-adapter.ts` (prompt building).

## Goals / Non-Goals

- Goals: Complete personal-info write path, add @all mention, improve AI output quality via ATS rules, clarify multi-item requests
- Non-Goals: Adding new CV sections, changing the `<apply>` tag format, modifying the UI, changing the AI model

## Decisions

- **Personal-info format**: Use pipe-separated `FullName | JobTitle | Email | Phone | Location | LinkedIn` on a single line — consistent with other sections and simplest to parse. Photo fields (`photoUrl`, `usePhoto`) are intentionally excluded since the AI cannot generate photos.
- **@all handling**: When `extractMentions` detects `@all`, return all section keys. In `openrouter-adapter.ts`, when mentions include "all" or contain all keys, pass `undefined` to `buildSystemPromptWithMention` — this already means "no focus = all sections visible" so no prompt builder changes needed.
- **ATS rules placement**: Append after section formats, before `CV DATA:` block — the AI sees format rules first, then quality rules, then the actual data.
- **Request interpretation**: A short block after ATS rules, so the AI applies both quality and parsing rules together.

## Risks / Trade-offs

- Longer system prompt increases token usage slightly — mitigated by keeping rules concise (under 20 lines)
- Personal-info parser is simpler than other sections (single line, no merge logic) — this is intentional since there's only ever one personal-info record

## Open Questions

- None — all decisions are straightforward extensions of existing patterns
