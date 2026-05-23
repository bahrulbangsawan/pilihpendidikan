# Change: Fix multi-section apply so AI fills all requested sections at once

## Why
When users mention multiple sections (e.g., "Fill @experience and @skills"), only the first mentioned section gets focused in the system prompt. Even if the AI returns multiple `<apply>` blocks, a state race condition causes all but the last action to be silently overwritten. The result: only one section ever updates.

## What Changes
Three coordinated fixes across the AI assistant pipeline:

1. **Multi-section focus in system prompt** — `buildSystemPrompt` accepts an array of section keys and generates focus instructions for all of them, with an explicit instruction for the AI to emit multiple `<apply>` blocks
2. **Pass full mentions array** — `buildSystemPromptWithMention` receives all extracted mentions (not just `mentions[0]`), and its type signature changes from `CVSectionKey` to `CVSectionKey[]`
3. **Batch action application** — `onApplyAction` changes from per-action dispatch to batch dispatch (`ApplyAction[]`). The handler applies all actions to a local accumulator before calling the setter once, eliminating the race condition

## Impact
- Affected code: `cv-system-prompt.ts`, `openrouter-adapter.ts`, `cv-assistant.tsx`
- Affected capability: `ai-cv-editing`
- No breaking changes to user-facing behavior — single-section mentions and `@all` continue to work
- The `ApplyAction` interface type is unchanged; only the callback signature changes from `(action) => void` to `(actions[]) => void`
