## 1. Setup

- [x] 1.1 Install shadcn/ui components: input, textarea, card, separator, badge, label
- [x] 1.2 Define TypeScript types for CV data (personal info, experience entries, education entries, skills)

## 2. Form Panel

- [x] 2.1 Build CVForm component with personal info section (name, title, email, phone, location, LinkedIn)
- [x] 2.2 Add professional summary textarea section
- [x] 2.3 Add repeatable work experience section (company, title, start/end dates, description bullets) with add/remove
- [x] 2.4 Add repeatable education section (institution, degree, start/end dates) with add/remove
- [x] 2.5 Add skills tag input (type + Enter to add, click to remove)

## 3. Preview Panel

- [x] 3.1 Build CVPreview component with ATS-compliant semantic HTML structure
- [x] 3.2 Style preview as A4-like document (white card, subtle shadow, generous whitespace)
- [x] 3.3 Verify: no `<table>`, no non-semantic `<div>` — only `<h1>`, `<h2>`, `<h3>`, `<p>`, `<ul>`, `<li>`, `<section>`

## 4. Integration

- [x] 4.1 Wire up useState in index.tsx — all form changes reflect instantly in preview
- [x] 4.2 Add responsive layout: side-by-side on md+, stacked on mobile

## 5. Verification

- [x] 5.1 Run `bun run build` — must pass with zero errors
- [x] 5.2 Run `bun run typecheck` — must pass with zero errors
- [ ] 5.3 Visually confirm: typing in form updates preview in realtime
- [x] 5.4 Inspect preview HTML: confirm no `<table>` or non-semantic `<div>` elements
- [ ] 5.5 Test responsive: preview stacks below form on narrow viewports
