## 1. Dependencies & Setup
- [x] 1.1 Install `@assistant-ui/react` (chat UI + LocalRuntime)
- [x] 1.2 Add assistant-ui shadcn components (thread, assistant-modal) via registry
- [x] 1.3 Fix type import issues in generated components for verbatimModuleSyntax
- [x] 1.4 Verify all dependencies work with React 19 and TanStack Start (typecheck + build pass)

## 2. BYOK API Key Management
- [x] 2.1 Create `src/components/ai/use-api-key.ts` — useSyncExternalStore hook for localStorage read/write/clear
- [x] 2.2 Create `src/components/ai/api-key-dialog.tsx` — Dialog with masked key display, input field, clear button, and link to openrouter.ai/keys
- [x] 2.3 Key validation handled via OpenRouter API error response (invalid key returns clear error)

## 3. AI Chat Core
- [x] 3.1 Create `src/components/ai/openrouter-adapter.ts` — ChatModelAdapter calling OpenRouter's OpenAI-compatible SSE streaming API directly from browser
- [x] 3.2 Create `src/components/ai/cv-system-prompt.ts` — serializes CVData into system prompt with role definition + full CV context
- [x] 3.3 Streaming via SSE parsing in adapter — tokens render incrementally in chat

## 4. Chat Modal UI
- [x] 4.1 assistant-ui `AssistantModal` + `Thread` installed via shadcn registry
- [x] 4.2 `CVAssistant` component renders floating chat button (bottom-right), integrated in `index.tsx`
- [x] 4.3 No API key state — shows setup button that opens ApiKeyDialog instead of chat modal
- [x] 4.4 Added TooltipProvider to `__root.tsx` (required by assistant-ui)

## 5. Mention System
- [x] 5.1 Define CV section keys and labels in `cv-system-prompt.ts` (8 sections: personal-info, summary, experience, etc.)
- [x] 5.2 `@section` regex parsing in adapter detects mentions in user messages and focuses system prompt
- [x] 5.3 Context-aware suggestion adapter provides CV-specific prompts (e.g., "Improve my @summary")
- [x] 5.4 Custom welcome message and placeholder text guide users on `@section` syntax

## 6. Apply Mechanism
- [x] 6.1 Create `src/components/ai/cv-tools.ts` — utility to apply AI suggestions to CVData by section
- [x] 6.2 Built-in copy button in assistant-ui action bar lets users copy AI text
- [x] 6.3 System prompt instructs AI to format output in code blocks for easy copying
- [x] 6.4 API key settings button (KeyRound icon) accessible when chat is active

## 7. Integration & Polish
- [x] 7.1 CVData passed from index.tsx to CVAssistant; system prompt updates on every CV change
- [x] 7.2 Modal uses fixed positioning — no layout interference with form/preview split
- [x] 7.3 Error handling: OpenRouter API errors parsed and displayed in chat; invalid key shows clear message
- [x] 7.4 Full build passes (typecheck + vite build)
