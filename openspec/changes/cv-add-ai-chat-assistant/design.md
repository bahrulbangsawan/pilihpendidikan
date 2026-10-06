## Context
The CV builder is a client-side SPA (TanStack Start + React 19) with form state managed via `useState` in `index.tsx`. All CV data flows down as props. Adding AI assistance requires: a chat UI, LLM integration, CV context injection, and a way to apply AI suggestions back to form fields — all client-side since the API key is user-provided (BYOK).

## Goals / Non-Goals
- Goals: Streaming AI chat in a floating modal, BYOK key storage in localStorage, mention-based section targeting, apply AI output to CV fields, works with any OpenRouter-compatible model
- Non-Goals: Server-side API proxy, user accounts, chat history persistence across sessions, fine-tuned models, auto-apply without user confirmation

## Decisions

### 1. Client-side direct calls (no server function)
- **Decision**: Browser calls OpenRouter API directly using user's key
- **Why**: BYOK pattern — no server secrets to manage, zero hosting cost for AI features
- **Alternatives considered**: TanStack Start `createServerFn` (requires server-side key, adds cost/complexity), edge function proxy (unnecessary for BYOK)

### 2. TanStack AI with OpenAI-compatible adapter
- **Decision**: Use `@tanstack/react-ai` `useChat` hook with OpenRouter's OpenAI-compatible endpoint (`https://openrouter.ai/api/v1`)
- **Why**: TanStack AI provides streaming hooks that integrate naturally with the existing TanStack ecosystem. OpenRouter exposes an OpenAI-compatible API, so the standard `openai` SDK works as the adapter.
- **Alternatives considered**: Vercel AI SDK (heavier, Vercel-centric), raw fetch + SSE parsing (more work, less reliable)

### 3. assistant-ui modal for chat UI
- **Decision**: Use `@assistant-ui/react` `AssistantModal` component for a floating bottom-right chat button
- **Why**: Production-ready chat UI with markdown rendering, streaming display, and composable architecture. The modal pattern doesn't disrupt the existing form/preview split layout.
- **Alternatives considered**: Custom chat UI (significant effort), shadcn chat component (doesn't exist in registry), inline panel (breaks layout)

### 4. localStorage for API key
- **Decision**: Store OpenRouter API key in `localStorage` under key `openrouter-api-key`
- **Why**: Standard BYOK pattern (Typingmind, Cursor, etc.). Persists across sessions so user enters key once. The key belongs to the user, not the app.
- **Risk**: Any JS on the domain can read it → Mitigation: This is acceptable for BYOK tools; the user opts in. Show masked key in settings UI.

### 5. Mention system mapping
- **Decision**: Map `@` mentions to CVData keys: `@summary`, `@experience`, `@education`, `@skills`, `@awards`, `@certificates`, `@languages`, `@personal-info`
- **Why**: Lets users target specific sections for refinement. The AI receives only the relevant section data plus overall context.
- **Implementation**: assistant-ui supports mention suggestions natively via its composer API

### 6. Apply-to-field mechanism
- **Decision**: AI responses include an "Apply" action button. Clicking it calls `setData` to update the relevant CVData field. No auto-apply — user must explicitly accept.
- **Why**: Users need to review AI output before it modifies their CV. This prevents unwanted overwrites.
- **Flow**: AI generates text → user reads in chat → clicks "Apply to [section]" → form field updates → preview re-renders

### 7. Context injection strategy
- **Decision**: Send full CV data as a system message, with the mentioned section highlighted. Include a system prompt defining the AI's role as a CV writing assistant.
- **Why**: The AI needs full context (job title, experience, skills) to generate coherent, non-contradictory content even when targeting a single section.
- **Token cost**: A typical CV is ~1-2K tokens — negligible overhead per request.

## Risks / Trade-offs
- **Risk**: OpenRouter API changes or rate limits → Mitigation: OpenAI-compatible API is stable; user manages their own rate limits via their account
- **Risk**: assistant-ui version compatibility with React 19 → Mitigation: Check compatibility before implementation; fallback to simpler custom UI if needed
- **Risk**: Large CV data inflates token usage → Mitigation: System prompt is ~1-2K tokens max; acceptable for all models
- **Risk**: User enters invalid API key → Mitigation: Validate key on first use with a lightweight API call; show clear error state

## Open Questions
- Should model selection be exposed in the UI, or default to a sensible model (e.g., `openrouter/auto`)?
- Should chat history persist in sessionStorage for the current tab session, or reset on each modal open?
