# CV Bahrul

A CV/Resume builder web application with real-time preview and PDF export.

## Features

- Interactive form with sections for personal info, summary, experience, education, skills, awards, certificates, and languages
- Real-time CV preview as you type
- PDF download with multi-page support
- Pre-fill with sample data
- Responsive split-pane layout (form + preview)

## Tech Stack

- [TanStack Start](https://tanstack.com/start) — Full-stack React framework
- [React 19](https://react.dev) — UI library
- [shadcn/ui](https://ui.shadcn.com) — Component library
- [Tailwind CSS v4](https://tailwindcss.com) — Styling
- [TypeScript](https://www.typescriptlang.org) — Type safety
- [Bun](https://bun.sh) — Runtime and package manager

## Getting Started

```bash
bun install
bun run dev
```

The app runs at `http://localhost:5001`.

## PDF Export

Uses `html2canvas` + `jsPDF` for client-side PDF generation with A4 formatting and automatic page breaks.
