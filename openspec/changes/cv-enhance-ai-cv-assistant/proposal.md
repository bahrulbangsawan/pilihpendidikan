# Change: Enhance AI CV assistant completeness and quality

## Why
The AI assistant has four gaps that prevent "no human touch" CV editing: (1) personal-info fields are completely unwritable — the AI can see them but has no `case` to apply changes, (2) users can't target all sections at once with `@all`, (3) the system prompt contains no ATS/CV writing guidance so output quality varies, and (4) ambiguous requests like "add experience with 3 bullets" are misinterpreted as 3 separate entries.

## What Changes
- **personal-info handler** — add `case "personal-info"` to `handleApplyAction` and corresponding `<apply section="personal-info">` format in the system prompt
- **@all mention** — extend `MENTION_REGEX` to match `@all`, return all section keys from `extractMentions`, pass `undefined` to `buildSystemPromptWithMention` (which already means "all sections"), add an `@all` suggestion
- **ATS best practices** — append professional CV writing rules to the system prompt (action verbs, quantified achievements, no pronouns, concise bullets)
- **Request interpretation** — add clarification block to system prompt so the AI correctly handles "add X with N bullets" vs "add N entries"
- **Valid sections list** — update the `Valid sections:` line to include `personal-info`

## Impact
- Affected code: `cv-system-prompt.ts`, `cv-assistant.tsx`, `cv-suggestions.ts`, `openrouter-adapter.ts`
- No breaking changes — additive handlers + prompt enhancements
- Closes the last "NO HUMAN TOUCH" gap from the field coverage audit
