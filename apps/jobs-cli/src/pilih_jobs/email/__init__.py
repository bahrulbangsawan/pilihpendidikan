"""Email applications on the CLI (09; leaf 4.4).

- `templates` — the `en`/`id` templates and the renderer (port of the contracts renderer);
- `eml` — the RFC 5322 `.eml` (RFC 2047 subjects, multipart/mixed, base64 PDFs, `X-Unsent`);
- `opener` — the OS handler (macOS `open`, Windows `os.startfile`, Linux `xdg-open`);
- `handoff` — draft / approve (payload hash) / send (verified downloads) / confirm.

Absolute imports keep this package distinct from the standard library `email` package.
"""
