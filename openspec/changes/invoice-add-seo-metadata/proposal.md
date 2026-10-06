# Change: Add SEO Metadata and Discoverability

## Why

An SEO audit scored the site **18/100 (Critical)**. The page is missing: meta description, canonical URL, Open Graph tags, Twitter Card tags, JSON-LD structured data, sitemap.xml, and a proper H1 heading. Without these, the page is effectively invisible to search engines and generates blank previews when shared on social media.

## What Changes

- Add meta description, canonical URL, and improved title to `__root.tsx` head config
- Add Open Graph and Twitter Card meta tags for social sharing
- Add JSON-LD structured data (`WebApplication` schema) for rich results
- Create `sitemap.xml` in `public/`
- Add `Sitemap:` directive to `robots.txt`
- Add a visually-hidden H1 heading to the CV generator page for proper heading hierarchy

## Impact

- Affected code: `src/routes/__root.tsx`, `src/routes/index.tsx`, `public/robots.txt`, new `public/sitemap.xml`
- Affected specs: `seo-metadata` (new capability)
- No breaking changes — purely additive metadata and a hidden heading element
- Expected score improvement: 18 → 75+ (Good)
