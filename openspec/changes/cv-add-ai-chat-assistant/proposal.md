# Change: Add AI Chat Assistant with BYOK OpenRouter

## Why
Users need AI-powered assistance to generate, refine, and improve CV content directly within the builder. Rather than switching to external tools (ChatGPT, etc.), an embedded chat modal lets users iterate on specific CV sections in context. Using a BYOK (Bring Your Own Key) model with OpenRouter means zero hosting cost for AI features and gives users access to their preferred models.

## What Changes
- Add **TanStack AI** (`@tanstack/react-ai`) with OpenRouter adapter for streaming LLM chat
- Add **assistant-ui** modal component for a floating chat interface
- Add **BYOK API key management** — user enters their OpenRouter key in a settings dialog, stored in `localStorage`
- Add **interactive mention system** — user types `@summary`, `@experience`, `@skills`, etc. to reference specific CV sections
- Add **apply-to-field** mechanism — AI suggestions can be applied directly to form fields with preview before accepting
- Inject full CV data as context so the AI understands the user's profile when generating/refining text

## Impact
- Affected specs: `ai-chat-assistant` (new capability)
- Affected code:
  - `src/routes/index.tsx` — pass CV data + setter to assistant modal
  - New: `src/components/ai/` — assistant modal, key settings, mention config
- New dependencies: `@tanstack/react-ai`, `@assistant-ui/react`, `openai` (OpenRouter-compatible SDK)
- No breaking changes — purely additive feature
