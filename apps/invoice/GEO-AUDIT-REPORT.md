# GEO Audit Report: Invoice Generator -- Bahrul Bangsawan

**Audit Date:** 2026-03-25
**URL:** https://invoice.bahrul.me
**Business Type:** SaaS / Free Web Tool
**Pages Analyzed:** 2 (/ and /id)

---

## Executive Summary

**Overall GEO Score: 19/100 (Critical)**

invoice.bahrul.me has strong technical SSR infrastructure and basic structured data, but is critically lacking in AI-citable content, brand authority, and trust signals. The site is a pure interactive tool with virtually no textual content for AI systems to extract, quote, or cite. Without prose content, FAQ sections, an llms.txt file, or any external brand presence, the site is effectively invisible to AI-powered search engines (ChatGPT, Perplexity, Gemini, Claude).

### Score Breakdown

| Category                 | Score  | Weight | Weighted Score |
| ------------------------ | ------ | ------ | -------------- |
| AI Citability            | 6/100  | 25%    | 1.5            |
| Brand Authority          | 14/100 | 20%    | 2.8            |
| Content E-E-A-T          | 18/100 | 20%    | 3.6            |
| Technical GEO            | 38/100 | 15%    | 5.7            |
| Schema & Structured Data | 38/100 | 10%    | 3.8            |
| Platform Optimization    | 12/100 | 10%    | 1.2            |
| **Overall GEO Score**    |        |        | **19/100**     |

---

## Critical Issues (Fix Immediately)

### 1. Zero Crawlable Text Content

**Severity:** CRITICAL
**Pages:** All (/, /id)
**Impact:** The entire site renders as an interactive form with only UI labels. AI systems have nothing to quote, extract, or reference. This is the single biggest blocker -- the site is functionally invisible to AI citation systems.
**Fix:** Add a content section (300-500 words) below the tool explaining what it does, who it's for, and basic invoicing guidance. Use semantic HTML (`<section>`, `<h2>`, `<p>`).

### 2. No Privacy Policy or Terms of Service

**Severity:** CRITICAL
**Impact:** Essential trust signals for any tool handling business data (company names, emails, addresses). Their absence undermines trustworthiness scores across all AI evaluation systems.
**Fix:** Create `/privacy` and `/terms` pages. Emphasize that all data stays client-side (localStorage only, never uploaded).

### 3. No llms.txt File

**Severity:** CRITICAL
**Impact:** LLM-powered engines (Perplexity, ChatGPT Search, Claude) use this file to understand site purpose in a machine-readable way. Currently returns 307 redirect to homepage.
**Fix:** Create `/public/llms.txt` with a structured summary of the application, features, and links.

### 4. Site Not Indexed by Any Search Engine

**Severity:** CRITICAL
**Impact:** Zero external visibility. Without backlinks, directory listings, or content marketing, search engines and AI systems cannot discover the site.
**Fix:** Submit to Google Search Console, submit sitemap, create external mentions (Product Hunt, AlternativeTo, SaaSHub).

---

## High Priority Issues

### 5. No AI Crawler Directives in robots.txt

**Pages:** /public/robots.txt
**Impact:** No specific rules for GPTBot, ClaudeBot, PerplexityBot. Without explicit `Allow` directives, some AI systems may be conservative about indexing.
**Fix:** Add explicit `Allow: /` rules for each major AI crawler.

### 6. Incomplete Sitemap

**Pages:** /public/sitemap.xml
**Impact:** Only 1 URL listed (missing /id locale, no `lastmod`, no hreflang annotations).
**Fix:** Add both locale URLs with `lastmod` dates and `xhtml:link` hreflang annotations.

### 7. No FAQ or Q&A Content

**Impact:** Common invoicing questions ("What should an invoice include?", "How to calculate tax?") are never answered. Zero chance of AI citation for these queries.
**Fix:** Add an FAQ section with `FAQPage` JSON-LD schema covering 8-10 common questions.

### 8. No About/Author Page

**Impact:** No way for users or search engines to evaluate who built this and why they should trust it.
**Fix:** Create `/about` page with author bio, credentials, LinkedIn/GitHub links, and motivation.

### 9. Missing WebApplication Schema Properties

**Pages:** /\_\_root.tsx (lines 51-66)
**Impact:** Schema lacks `featureList`, `screenshot`, `inLanguage`, `datePublished`.
**Fix:** Add these properties to strengthen AI knowledge graph extraction.

### 10. JSON-LD is English-Only (Not Locale-Aware)

**Pages:** /\_\_root.tsx
**Impact:** The `/id` route serves English-only structured data despite having Indonesian translations. AI systems serving Indonesian users see mismatched language signals.
**Fix:** Make JSON-LD generation locale-aware using the existing i18n system.

---

## Medium Priority Issues

### 11. All Security Headers Missing

No `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Strict-Transport-Security`, or `Permissions-Policy` headers.
**Fix:** Add a `public/_headers` file or Cloudflare Worker middleware.

### 12. No Cache-Control Headers

Static assets and HTML lack caching directives.
**Fix:** Add `Cache-Control: public, max-age=31536000, immutable` for `/assets/*`.

### 13. Person Schema Too Thin

Author schema has only `name` and `url`. Missing `sameAs`, `jobTitle`, `image`.
**Fix:** Add `sameAs` array linking LinkedIn, GitHub, and bahrul.me.

### 14. No BreadcrumbList Schema

Even a minimal breadcrumb improves SERP presentation and AI structural understanding.
**Fix:** Add `BreadcrumbList` JSON-LD with `Home > Invoice Generator`.

### 15. No Data Transparency Statement

The tool's strongest privacy feature (all data stays in browser) is never communicated.
**Fix:** Add a visible footer note: "Your data never leaves your browser."

### 16. `html lang` Hardcoded to "en" in SSR

**Pages:** /\_\_root.tsx line 80
**Impact:** AI crawlers without JS see `lang="en"` for the `/id` route.
**Fix:** Set `lang` attribute server-side based on route.

---

## Low Priority Issues

### 17. No `twitter:site` or `twitter:creator` Meta Tags

Twitter Card tags exist for content display but lack author attribution.

### 18. No `datePublished`/`dateModified` in Structured Data

Freshness signals are absent from the schema.

### 19. Missing `robots` Meta Tag

Explicit `<meta name="robots" content="index, follow">` is a positive signal even when robots.txt allows all.

### 20. Web Manifest Name Mismatch

`site.webmanifest` uses "Bahrul Bangsawan" instead of "Invoice Generator".

### 21. Sitemap Uses Deprecated `changefreq`

Google ignores `changefreq`. Replace with `lastmod` (which is actually useful).

---

## Category Deep Dives

### AI Citability (6/100)

The site scores critically low on citability because it is a pure interactive tool with no textual content. There are zero quotable passages, zero answer blocks, zero statistical data, and zero educational content. The only text AI systems can extract is the meta description.

**What exists:** Meta description, JSON-LD description, UI labels
**What is missing:** Prose content, FAQ, how-to guides, feature descriptions, invoicing best practices

The meta description is the _only_ passage AI could potentially cite:

> "Create, preview, and download professional invoices as PDF. Free online invoice generator with real-time preview and AI assistant."

This is insufficient for AI citation. AI systems need self-contained, information-rich passages of 2-4 sentences each.

### Brand Authority (14/100)

| Platform          | Status                                                              |
| ----------------- | ------------------------------------------------------------------- |
| LinkedIn          | Active (Growth Marketing at KYZN, Founder at Growthacker Indonesia) |
| GitHub            | Referenced but not discoverable in search                           |
| Personal site     | work.bahrul.me exists and is indexed                                |
| invoice.bahrul.me | **Not indexed** -- zero search results                              |
| YouTube           | No presence                                                         |
| Reddit            | No mentions                                                         |
| Wikipedia         | No article                                                          |
| Medium/Dev.to     | No presence                                                         |
| Twitter/X         | No presence                                                         |

The brand "Bahrul Bangsawan" has ambiguous entity recognition -- search results mix the person with unrelated individuals and the generic Malay word "bangsawan." invoice.bahrul.me has zero external mentions or backlinks.

### Content E-E-A-T (18/100)

| Pillar            | Score | Key Gap                                                     |
| ----------------- | ----- | ----------------------------------------------------------- |
| Experience        | 10/25 | Tool works but no written narrative of invoicing experience |
| Expertise         | 5/25  | Zero educational content about invoicing                    |
| Authoritativeness | 3/25  | No external authority signals, no about page                |
| Trustworthiness   | 8/25  | No privacy policy, no terms, no contact info                |

The tool itself demonstrates competence (multi-currency, Indonesia-specific features, AI assistant), but none of this is communicated in crawlable text. The privacy advantage (all data client-side) is invisible.

### Technical GEO (38/100)

| Factor                            | Score                                               |
| --------------------------------- | --------------------------------------------------- |
| SSR via TanStack Start            | Excellent -- full HTML on first request             |
| Meta tags (OG, Twitter, hreflang) | Good -- complete set                                |
| Favicons / PWA manifest           | Good -- complete set                                |
| robots.txt                        | Partial -- allows all but no AI-specific directives |
| Sitemap                           | Poor -- missing /id, no lastmod, no hreflang        |
| llms.txt                          | Missing entirely                                    |
| Security headers                  | Missing entirely                                    |
| Caching headers                   | Missing entirely                                    |

The SSR implementation is the strongest technical asset. TanStack Start delivers complete HTML server-side, which is exactly what AI crawlers need. However, the missing llms.txt and incomplete sitemap significantly reduce discoverability.

### Schema & Structured Data (38/100)

**Present:**

- `WebApplication` with basic properties (name, description, url, applicationCategory, operatingSystem, offers, author)
- `Offer` (price: 0, priceCurrency: USD)
- `Person` (name, url)

**Missing:**

- `featureList` -- highest-impact addition for GEO
- `screenshot` -- needed for rich results
- `inLanguage` -- should declare ["en", "id"]
- `datePublished` / `dateModified`
- `FAQPage` schema
- `BreadcrumbList` schema
- `Organization` schema
- `sameAs` on Person entity

The JSON-LD is correctly SSR'd via TanStack Start's shellComponent, which is a solid foundation. The main gaps are property completeness and missing supplementary schema types.

### Platform Optimization (12/100)

LinkedIn is the only platform with meaningful presence. GitHub exists but isn't discoverable. No presence on YouTube, Reddit, Wikipedia, Medium, Dev.to, Twitter, or any tool directory. No content marketing footprint exists to drive AI training data or citation.

---

## Quick Wins (Implement This Week)

1. **Create llms.txt** -- Add `/public/llms.txt` with structured site summary. Estimated impact: +15 points on Technical GEO.

2. **Fix sitemap.xml** -- Add `/id` URL, add `lastmod` dates, add `xhtml:link` hreflang annotations. Estimated impact: +8 points on Technical GEO.

3. **Add AI crawler directives to robots.txt** -- Explicit `Allow: /` for GPTBot, ClaudeBot, PerplexityBot. Estimated impact: +8 points on Technical GEO.

4. **Enrich JSON-LD schema** -- Add `featureList`, `screenshot`, `inLanguage`, `sameAs` to existing WebApplication/Person schema. Estimated impact: +15 points on Schema.

5. **Add visible data transparency footer** -- "Your invoices stay in your browser. No sign-up. No data uploaded." Estimated impact: +5 points on E-E-A-T.

---

## 30-Day Action Plan

### Week 1: Technical Foundation

- [ ] Create `/public/llms.txt` with application summary and features
- [ ] Update `/public/robots.txt` with AI crawler directives (GPTBot, ClaudeBot, PerplexityBot)
- [ ] Update `/public/sitemap.xml` with /id URL, lastmod, hreflang annotations
- [ ] Enrich JSON-LD: add `featureList`, `screenshot`, `inLanguage`, `datePublished`
- [ ] Add `sameAs` array to Person schema (LinkedIn, GitHub, bahrul.me)
- [ ] Make JSON-LD locale-aware (use i18n translations for /id route)
- [ ] Fix `html lang` attribute to be server-side locale-aware

### Week 2: Trust & Content

- [ ] Create privacy policy page (`/privacy`)
- [ ] Create terms of service page (`/terms`)
- [ ] Add a content section below the tool (300-500 words): what it does, who it's for, key features
- [ ] Add FAQ section with 8-10 invoicing questions + `FAQPage` JSON-LD
- [ ] Add data transparency footer note
- [ ] Add BreadcrumbList schema
- [ ] Add security headers via `_headers` file or Cloudflare middleware

### Week 3: Authority & Brand

- [ ] Create `/about` page with author bio, credentials, motivation
- [ ] Submit to Google Search Console and verify domain
- [ ] Submit to tool directories: Product Hunt, AlternativeTo, SaaSHub
- [ ] Write LinkedIn post announcing the tool
- [ ] Make GitHub repository public with README
- [ ] Add `meta name="robots"` tag to all pages

### Week 4: Content Marketing & Platform Expansion

- [ ] Publish article on Dev.to: "Building a Free Invoice Generator with React PDF"
- [ ] Publish article on Medium: "How I Added AI to an Invoice Tool"
- [ ] Create a demo video for YouTube
- [ ] Share on relevant Reddit communities (r/webdev, r/SideProject, r/indonesia)
- [ ] Add cache-control headers for static assets
- [ ] Re-run GEO audit to measure improvement

---

## Appendix: Pages Analyzed

| URL                          | Title                                 | GEO Issues                                                                 |
| ---------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| https://invoice.bahrul.me    | Invoice Generator -- Bahrul Bangsawan | 15 (no content, missing schema properties, no llms.txt, no privacy policy) |
| https://invoice.bahrul.me/id | Generator Faktur -- Bahrul Bangsawan  | 16 (same as above + English-only JSON-LD, lang mismatch, not in sitemap)   |

---

_Report generated by GEO Audit v1.0 on 2026-03-25_
