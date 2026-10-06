# Change: Add CV Generator Page

## Why

The project needs its core feature — a CV generator at the `/` route. Users should be able to fill in personal info, work experience, education, and skills through a form, and see a live ATS-friendly CV preview updating in realtime beside it.

## What Changes

- Replace the placeholder `index.tsx` with a full CV generator page
- Install shadcn/ui components: input, textarea, card, separator, badge, label
- Build a form panel with five sections (personal info, summary, experience, education, skills)
- Build a CV preview panel using semantic HTML (no tables, ATS-compliant headings)
- Responsive layout: side-by-side on desktop (md+), stacked on mobile

## Impact

- Affected specs: `cv-generator` (new capability)
- Affected code: `src/routes/index.tsx`, new components in `src/components/`
- No breaking changes — this replaces a placeholder page
