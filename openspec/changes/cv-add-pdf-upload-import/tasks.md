## 1. Dependencies
- [x] 1.1 Install `pdfjs-dist` package

## 2. PDF Attachment Adapter
- [x] 2.1 Create `src/components/ai/pdf-attachment-adapter.ts` with custom `AttachmentAdapter` implementation
  - `accept: "application/pdf"` to restrict file types to PDF only
  - `add()`: dynamically import `pdfjs-dist`, extract text page-by-page, truncate at 15,000 chars, return `PendingAttachment` with text content
  - `send()`: return `CompleteAttachment` with extracted text as `TextMessagePart[]`
  - `remove()`: no-op (no server cleanup needed)
  - Configure `pdfjs-dist` worker (CDN or bundled)

## 3. Wire Adapter into Runtime
- [x] 3.1 Update `cv-assistant.tsx` to pass the PDF attachment adapter to `useLocalRuntime` via `adapters.attachments`

## 4. Include Attachment Text in API Messages
- [x] 4.1 Update `openrouter-adapter.ts` to read attachment content from user messages and prepend extracted PDF text to the API message content

## 5. System Prompt Update
- [x] 5.1 Update `cv-system-prompt.ts` to add CV import instruction — guide the AI on parsing uploaded CV text and generating `<apply>` blocks for each identified section

## 6. Validation
- [x] 6.1 Verify PDF-only file filter works (non-PDF files rejected)
- [x] 6.2 Verify PDF text extraction works with a sample CV PDF
- [x] 6.3 Verify extracted text appears in AI messages and AI responds with `<apply>` tags
- [x] 6.4 Verify `pdfjs-dist` is not in the initial bundle (dynamic import works)
- [x] 6.5 Run `bun run typecheck` to confirm no type errors
