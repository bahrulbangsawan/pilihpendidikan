## Context
The AI assistant modal already has full attachment UI (drag-and-drop zone, `+` button, visual previews) via `@assistant-ui/react` primitives, but the `openrouter-adapter.ts` only maps `p.type === "text"` content parts — attachments are silently dropped. Users want to upload old CV PDFs and have the AI import the content into the builder.

## Goals / Non-Goals
- Goals:
  - Client-side PDF text extraction (no server, no upload to external services)
  - PDF-only file filter (restrict the `+` button and drop zone to `.pdf` files)
  - Extracted text included in AI messages so the model can parse and apply CV content
  - System prompt guidance for mapping raw CV text to `<apply>` sections
- Non-Goals:
  - Image/scan OCR support (only text-based PDFs)
  - Parsing structured PDF layout (tables, columns) — plain text extraction is sufficient
  - Server-side processing or cloud storage of uploaded files

## Decisions

### 1. PDF library: `pdfjs-dist`
- **Why**: Mozilla's official PDF.js — mature, well-maintained, runs entirely in the browser
- **Alternatives considered**:
  - `pdf-parse`: Node.js only, won't work client-side
  - `unpdf`: Lighter but less mature, smaller community
  - `pdf2json`: Node.js only
- **Bundle concern**: `pdfjs-dist` is ~500KB but only loaded when user attaches a PDF (the adapter can dynamic-import it)

### 2. Custom `AttachmentAdapter` vs extending `SimpleTextAttachmentAdapter`
- **Decision**: Custom adapter implementing `AttachmentAdapter` interface
- **Why**: `SimpleTextAttachmentAdapter` uses `file.text()` which reads raw bytes as UTF-8 — PDFs are binary, this produces garbage. We need `pdfjs-dist` to parse the binary format.
- **API**: `accept: "application/pdf"`, `add()` extracts text, `send()` returns content as `TextMessagePart[]`

### 3. Injecting PDF text into API messages
- **Decision**: Modify `openrouter-adapter.ts` to check user message attachments and prepend extracted text
- **Why**: The `@assistant-ui/react` framework stores completed attachment content as `ThreadUserMessagePart[]` on the message. We just need to read the attachment's content parts alongside the regular message content.
- **Alternative**: Modify the system prompt to include the PDF text — rejected because the text could be very long and would be sent with every subsequent message

### 4. Dynamic import for bundle optimization
- **Decision**: Use `import("pdfjs-dist")` inside the adapter's `add()` method
- **Why**: Most users won't upload PDFs. Dynamic import keeps the main bundle small and only loads pdf.js when actually needed.

## Risks / Trade-offs
- **Scanned PDFs**: Text extraction won't work on image-only/scanned PDFs — the extracted text will be empty. Mitigation: show a user-friendly message if extraction yields no text.
- **Large PDFs**: A 50-page document could produce very long text that exceeds model context. Mitigation: truncate to first ~15,000 characters with a note.
- **PDF.js worker**: `pdfjs-dist` uses a web worker for performance. The worker file needs to be served or we use the legacy build without workers. Decision: use `GlobalWorkerOptions.workerSrc` pointed to a CDN or bundled worker.

## Open Questions
- None — the approach is straightforward with well-understood components.
