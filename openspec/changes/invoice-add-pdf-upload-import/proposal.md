# Change: Add PDF upload to import old CV into AI assistant

## Why

Users want to upload an existing CV (PDF) and have the AI assistant extract and apply its content to the CV builder. The attachment UI (drag-and-drop, `+` button) already exists but files are never sent to the AI — attachments are purely visual. This feature closes the gap by adding client-side PDF text extraction and wiring extracted content into the AI conversation.

## What Changes

- **New dependency**: `pdfjs-dist` for client-side PDF text extraction (Mozilla PDF.js, no server needed)
- **Custom `AttachmentAdapter`**: PDF-only adapter that extracts text on attach and stores it as `text` content parts — replaces the default adapter which silently drops non-image files
- **OpenRouter adapter update**: include attachment text content in API messages instead of stripping all non-text parts
- **System prompt update**: add instruction for handling imported CV text — AI should parse the old CV and map content to the correct sections using `<apply>` tags
- **File type restriction**: attachment accept filter set to `application/pdf` only

## Impact

- Affected code: `cv-assistant.tsx`, `openrouter-adapter.ts`, `cv-system-prompt.ts`, `package.json`
- New file: `src/components/ai/pdf-attachment-adapter.ts`
- No breaking changes — additive capability on existing attachment infrastructure
- Existing `<apply>` tag system handles the output side without modification
