## 1. System prompt multi-section support

- [x] 1.1 Change `buildSystemPrompt` signature in `cv-system-prompt.ts` from `mentionedSection?: CVSectionKey` to `mentionedSections?: CVSectionKey[]`
- [x] 1.2 Update focus instruction to list all targeted sections: `mentionedSections.join(", ")`
- [x] 1.3 Add MULTI-SECTION EDITING instruction block to system prompt body with example of multiple `<apply>` blocks

## 2. Adapter multi-mention passthrough

- [x] 2.1 Update `OpenRouterAdapterOptions.buildSystemPromptWithMention` type from `(section?: CVSectionKey) => string` to `(sections?: CVSectionKey[]) => string`
- [x] 2.2 Change adapter to pass full `mentions` array instead of `mentions[0]` (keep the `>= 10` -> `undefined` guard)
- [x] 2.3 Update `onApplyAction` type from `(action: ApplyAction) => void` to `(actions: ApplyAction[]) => void`
- [x] 2.4 Replace per-action dispatch loop with single batch call: `onApplyAction(actions)`

## 3. Batch action handler

- [x] 3.1 Extract existing `handleApplyAction` switch into pure function `applyOneAction(data: CVData, action: ApplyAction): CVData` that returns new data instead of calling setter
- [x] 3.2 Rewrite `handleApplyAction` to accept `ApplyAction[]`, iterate with local accumulator, call `setter` once
- [x] 3.3 Update `buildSystemPromptWithMention` caller in `cv-assistant.tsx` to match new array signature

## 4. Verification

- [x] 4.1 Run `bun run build` — no type errors
- [ ] 4.2 Manual test: "Fill @experience with 2 entries and @skills with frontend technologies" — both sections populate
- [ ] 4.3 Manual test: "Fill @summary and @education and @languages" — all 3 sections update
- [ ] 4.4 Manual test: "Improve @summary" — single-section still works
- [ ] 4.5 Manual test: "Review @all sections" — @all pathway still works
