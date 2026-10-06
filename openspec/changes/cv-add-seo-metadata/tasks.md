# Tasks

## Prerequisites
- [x] Confirm production domain URL for canonical/OG tags — using `https://cv.bahrul.me`

## Implementation (sequential — each builds on prior head config)
- [x] Update title tag in `__root.tsx` head to 30-60 chars — "Bahrul Bangsawan — CV Builder & Resume Generator" (49 chars)
- [x] Add `<meta name="description">` in `__root.tsx` head (152 chars)
- [x] Add `<link rel="canonical">` in `__root.tsx` head — `https://cv.bahrul.me`
- [x] Add Open Graph meta tags (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`) in `__root.tsx` head
- [x] Add Twitter Card meta tags (`twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`) in `__root.tsx` head
- [x] Add JSON-LD `WebApplication` structured data block to `__root.tsx` shellComponent
- [x] Add visually-hidden H1 heading to `src/routes/index.tsx` for proper heading hierarchy

## Crawlability
- [x] Create `public/sitemap.xml` with site URLs
- [x] Add `Sitemap:` directive to `public/robots.txt`

## Validation
- [x] Run SEO audit again and confirm score >= 70 — scored **83.5/100 (Good)**
