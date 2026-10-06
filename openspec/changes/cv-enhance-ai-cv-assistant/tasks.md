## 1. Personal-info section support
- [x] 1.1 Add `personal-info` format block to system prompt in `cv-system-prompt.ts` (`Personal Info (FullName | JobTitle | Email | Phone | Location | LinkedIn):`)
- [x] 1.2 Update `Valid sections:` line in `cv-system-prompt.ts` to include `personal-info`
- [x] 1.3 Add `case "personal-info"` to `handleApplyAction` in `cv-assistant.tsx` — parse pipe-separated fields and call `setter({ ...current, personalInfo: { ...current.personalInfo, ...parsed } })`

## 2. @all mention support
- [x] 2.1 Update `MENTION_REGEX` in `cv-suggestions.ts` to also match `@all`
- [x] 2.2 Update `extractMentions` in `cv-suggestions.ts` — when `@all` is detected, return all section keys from `CV_SECTIONS`
- [x] 2.3 Update `openrouter-adapter.ts` — when mentions include "all" (or all 10 keys), pass `undefined` to `buildSystemPromptWithMention`
- [x] 2.4 Add an `@all` suggestion to `getCVSuggestions` in `cv-suggestions.ts` (e.g., "Review my entire CV")

## 3. ATS best practices in system prompt
- [x] 3.1 Add ATS & CV BEST PRACTICES block to `buildSystemPrompt` in `cv-system-prompt.ts` — after section formats, before CV DATA

## 4. Multi-item request interpretation
- [x] 4.1 Add USER REQUEST INTERPRETATION block to `buildSystemPrompt` in `cv-system-prompt.ts` — after ATS rules

## 5. Verification
- [x] 5.1 Read final `cv-system-prompt.ts` and verify personal-info format, ATS rules, interpretation guide are present
- [x] 5.2 Read `cv-assistant.tsx` and verify `handleApplyAction` covers all 10 sections
- [x] 5.3 Read `cv-suggestions.ts` and verify `MENTION_REGEX` matches `@all`
- [x] 5.4 Run `bun run dev` and confirm no build errors
