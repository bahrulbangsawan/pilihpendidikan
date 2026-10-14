<!--
Source audit of cloud discovery (job-tracker-spec/24 §7.1), produced on
2026-10-13 with real requests (honest UA, robots.txt first, ≤ ~1 req/s).
This is the audit as recorded. The live smoke run afterwards (pilih-scraper)
corrected four entries, and the seed catalog
`packages/jobs-contracts/cloud-sources.json` is authoritative:

- Remotive: robots.txt answers a Cloudflare challenge to our crawler →
  BLOCKED (also held back for its API terms).
- ProBlogger: job pages show a reCAPTCHA wall and the feed has no company →
  BLOCKED.
- Hubstaff Talent: headless Chromium got a Cloudflare challenge → BLOCKED.
- Dynamite Jobs: only the 6 featured jobs are reachable without a browser →
  held back (disabled).

Enabled in the seed: We Work Remotely, Remote OK, Jobspresso, Workew,
JustRemote, Remote Freelance ID, Work From Home ID. Working Nomads is held
back for its "competitive product" clause.
-->

# Remote-job source audit

Checked 2026-10-13T14:38:12+00:00 to 2026-10-13T14:55:16+00:00 with UA `pilih-jobs/0.1.0 (+https://pilihpendidikan.com/bot)`, robots.txt first, ≤ ~1 req/s and ≤ 10 requests per host. 80 sources (78 from bahrul.me/tools?category=remote-jobs + 2 added). Full records (evidence lines per source) are kept in `packages/jobs-contracts/cloud-sources.json` (`audit`).

| Status | Count |
|---|---|
| ACTIVE | 12 |
| AUTH_REQUIRED | 1 |
| BLOCKED | 6 |
| RESTRICTED | 8 |
| DISABLED | 12 |
| UNSUPPORTED | 41 |

## ACTIVE (12)

| Source | Category | Final URL | Strategy | Why |
|---|---|---|---|---|
| We Work Remotely | job_board | https://weworkremotely.com | rss | /remote-jobs.rss: 89 jobs; no scraping clause in ToS |
| Remotive | job_board | https://remotive.com/ | json_api | Documented API: 16 jobs; attribution, ≤4 calls/day, no signup-gating; site itself is behind a Cloudflare challenge |
| Jobspresso | job_board | https://jobspresso.co | rss | /feed/job_feed/: 10 jobs (WP Job Manager); JSON-LD on job pages; ToS not found |
| JustRemote | job_board | https://justremote.co | json_ld | JSON-LD JobPosting on job pages; 84 jobs in __PRELOADED_STATE__ on a category page |
| Workew | job_board | https://workew.com | json_api | WP REST job-listings (5 per page asked) + job_feed RSS (10); ToS not found |
| Working Nomads | job_board | https://www.workingnomads.com/jobs | json_api | /api/exposed_jobs/: 51 jobs; ToS has a 'competitive product' clause |
| Dynamite Jobs | job_board | https://dynamitejobs.com | json_ld | JSON-LD on job pages; discovery via 475 per-company sitemaps (listing is JS) |
| Remote OK | job_board | https://remoteok.com/ | json_api | /api: 99 jobs; API notice requires a followed backlink + attribution |
| Hubstaff Talent | job_board | https://hubstafftalent.net/ | browser | Public job pages (HTML); search list is JS-rendered; lower confidence |
| ProBlogger | job_board | https://problogger.com/jobs/ | rss | wpjobboard RSS: 4 jobs (tiny board); ToS not found |
| Remote Freelance ID | aggregator | https://remotefreelance.id/jobs | json_ld | ItemList JSON-LD: 12 per page; re-lists Upwork/SEEK/Glints jobs |
| Work From Home ID | job_board | https://www.workfromhome.id | json_ld | JSON-LD on job pages; 10 per listing page; RSS robots-disallowed; Crawl-delay 1 |

## AUTH_REQUIRED (1)

| Source | Category | Final URL | Strategy | Why |
|---|---|---|---|---|
| Virtual Vocations | job_board | https://www.virtualvocations.com | none | Premium membership needed for full description and apply |

## BLOCKED (6)

| Source | Category | Final URL | Strategy | Why |
|---|---|---|---|---|
| Remote.co | job_board | — | none | Edge (Akamai) resets/timeouts on robots.txt for our UA |
| FlexJobs | job_board | — | none | Edge resets/timeouts on robots.txt for our UA; paywall unverified |
| SimplyHired | aggregator | https://www.simplyhired.com/ | none | Cloudflare challenge on / and robots.txt |
| Stack Overflow Jobs | job_board | https://stackoverflow.com/jobs | none | Cloudflare challenge; shutdown unverifiable (no Wayback snapshot) |
| Behance | job_board | https://www.behance.net/joblist | none | 403 JS cookie challenge on /joblist |
| Fancy Hands | staffing_service | https://www.fancyhands.com/ | none | Cloudflare 'Attention Required' 403 (VA service per directory) |

## RESTRICTED (8)

| Source | Category | Final URL | Strategy | Why |
|---|---|---|---|---|
| SkipTheDrive | job_board | https://www.skipthedrive.com | none | ToS bans automated collection; robots blocks /job/ |
| EuropeRemotely | job_board | — | none | robots.txt: '*' Disallow / |
| Crossover | job_board | https://www.crossover.com | none | ToS bans robots/scraping |
| Dice | job_board | https://www.dice.com | none | ToS bans unapproved robots/spiders |
| AngelList | job_board | https://wellfound.com/ | none | Redirects to wellfound.com; Talent terms forbid copying users' content |
| Dribbble Jobs | job_board | https://dribbble.com/jobs | none | ToS bans scraping (jobs.rss exists, 59 items) |
| Coroflot | job_board | https://www.coroflot.com | none | robots.txt ends with '*' Disallow / ('block the rest') |
| Teach Away | job_board | https://www.teachaway.com | none | ToS bans harvesting/collecting materials |

## DISABLED (12)

| Source | Category | Final URL | Strategy | Why |
|---|---|---|---|---|
| Pangian | defunct | https://forsale.godaddy.com/forsale/pangian.com | none | Home is a 114-byte page that JS-redirects to /lander, which 307s to GoDaddy 'forsale' (domain for sale; that page answered 403 Akamai to us). |
| Remote Global | defunct | — | none | Domain does not resolve. |
| Outsourcely | defunct | — | none | Domain does not resolve. |
| CloudPeeps | defunct | — | none | Domain does not resolve. |
| Hired | defunct | https://www.lhh.com/en-us/about-us/our-story | none | hired.com 301 → https://www.lhh.com/en-us/about-us/our-story (LHH/Adecco brand page). |
| GitHub Jobs | defunct | — | none | Verified unreachable: the hostname points to 0.0.0.0 (service retired). |
| HackerRank Jobs | defunct | https://www.hackerrank.com/dashboard | none | /jobs 301 → /apply 301/307 → /dashboard (practice/interview-prep dashboard with Log In / Sign Up). |
| Envato Studio | defunct | https://help.elements.envato.com/hc/en-us/articles/18133185005977 | none | studio.envato.com 301 → help.elements.envato.com/hc/en-us/articles/18133185005977, which answers 404. |
| Working Not Working | defunct | https://workingnotworking.com | none | Domain now serves an unrelated AI-tools blog ('Latest Blogs', AI video/image posts); the creative talent network is gone. |
| Contena | defunct | — | none | Dangling Heroku DNS; site gone. |
| Virtual Assistant Jobs | defunct | https://virtualassistantjobs.com | none | Home is an Astra theme template with lorem-ipsum placeholder text; its 'Today's Jobs' link (/todaysjobs) is 404. |
| Chegg Tutors | defunct | https://www.chegg.com/tutors/ | none | https://www.chegg.com/tutors/ → 404 'Page Not Found'. |

## UNSUPPORTED (41)

| Source | Category | Final URL | Strategy | Why |
|---|---|---|---|---|
| Upwork | freelance_marketplace | https://www.upwork.com | none | Freelance marketplace; also protected and ToS-prohibited. |
| Fiverr | freelance_marketplace | https://www.fiverr.com | none | Productised gig marketplace (category from directory + page title; content blocked). |
| Toptal | talent_network | https://www.toptal.com | none | 'Hire Freelance Talent from the Top 3%': vetted network, no public vacancies (only its own /careers). |
| PeoplePerHour | freelance_marketplace | https://www.peopleperhour.com | none | Freelance marketplace (hourlies and project bidding). |
| Freelancer | freelance_marketplace | https://www.freelancer.com | none | Project/contest marketplace; terms forbid automated access, even via its API, without written permission. |
| Guru | freelance_marketplace | https://www.guru.com/ | none | Category from directory description; site blocks our client. |
| Workana | freelance_marketplace | https://www.workana.com | none | Freelance project marketplace (LatAm); /en/jobs is a Vue shell ('Sign up, create your profile and send your proposals'). |
| Catalant | talent_network | https://catalant.com/ | none | gocatalant.com 301 → catalant.com. |
| Outvise | freelance_marketplace | https://www.outvise.com/ | none | outvise.com 301 → www.outvise.com. |
| Scalable Path | talent_network | https://www.scalablepath.com | none | 'A Human Approach to Hiring Remote Developers': vetted network selling to companies. |
| Lemon.io | talent_network | https://lemon.io/ | none | 'Hire TOP Software Developers for Startups': vetted developer network. |
| X-Team | talent_network | https://x-team.com | none | 'Elite, On-Demand Tech Talent'. |
| Codeable | freelance_marketplace | https://www.codeable.io:443/ | none | codeable.io 301 → www.codeable.io:443. |
| 99designs | freelance_marketplace | https://99designs.com/ | none | Design contests and 1:1 projects. |
| DesignCrowd | freelance_marketplace | https://www.designcrowd.com | none | Crowdsourced design contests (title 'Freelance Logo Design, Web Design & Graphic Design'). |
| Creative Circle | staffing_service | https://www.creativecircle.com | none | 'Everforth Creative Circle': staffing & recruiting, embedded studios, consulting. |
| Designhill | freelance_marketplace | https://www.designhill.com | none | Design contests, marketplace and print-on-demand. |
| Crowdspring | freelance_marketplace | https://www.crowdspring.com | none | Category from directory description (crowdsourced design); blocked by AWS WAF challenge. |
| Contently | content_marketplace | https://contently.com | none | 'Content for regulated industries': managed content platform. |
| Scripted | content_marketplace | https://www.scripted.com | none | 'Your AI CMO Backed by Industry Expert Humans': managed content service. |
| ClearVoice (duplicate of Fiverr) | freelance_marketplace | https://www.fiverr.com/?source=www.clearvoice.com | none | www.clearvoice.com 301 → https://www.fiverr.com/?source=www.clearvoice.com: absorbed into Fiverr. |
| WriterAccess | content_marketplace | https://www.writeraccess.com | none | 'Hire Writers and Content Creators'. |
| Textbroker | content_marketplace | https://www.textbroker.com | none | 'SEO Content Creation for Businesses'. |
| The Urban Writers | content_marketplace | https://theurbanwriters.com | none | Ghostwriting services storefront (Shopify OfferCatalog JSON-LD). |
| Verblio | content_marketplace | https://www.verblio.com | none | 'Blog & Content Writing Services'. |
| Compose.ly | content_marketplace | https://www.compose.ly | none | 'Quality Content Writing Services'. |
| Belay | staffing_service | https://belaysolutions.com | none | 'BELAY Assistant & Financial Solutions': VA/bookkeeper service for clients. |
| Time Etc | staffing_service | https://www.timeetc.com | none | 'Virtual Assistants for Hire'. |
| Zirtual | staffing_service | https://www.zirtual.com | none | '#1 Virtual Assistant Company'. |
| Boldly | staffing_service | https://boldly.com | none | 'Premium Executive Assistants' subscription staffing. |
| Support Adventure | staffing_service | https://www.supportadventure.com | none | 'The Remote MSP Staffing Company'; its 'Remote Jobs' pages recruit for its own staffing pool. |
| VA Networking | community | https://www.vanetworking.com/ | none | vanetworking.com 301 → www.vanetworking.com. |
| Assistant Match | staffing_service | https://assistantmatch.com/ | none | www.assistantmatch.com 301 → assistantmatch.com. |
| VIPKid | tutoring_platform | https://www.vipkid.com | none | Home is an empty JS shell (no title, no text); category from directory description. |
| Outschool | tutoring_platform | https://outschool.com | none | 'Live Online Classes for Kids'. |
| Qkids | tutoring_platform | https://qkids.com/ | none | www.qkids.com 301 → qkids.com: Chinese-language parent-facing kids' English course site (Qkids久趣英语); no teacher listings. |
| italki | tutoring_platform | https://www.italki.com | none | Language-learning tutor marketplace. |
| Preply | tutoring_platform | https://preply.com | none | Online tutoring marketplace. |
| Cambly | tutoring_platform | https://www.cambly.com/english | none | www.cambly.com 302 → /english ('English Tutors Online'). |
| Verbling | tutoring_platform | https://www.verbling.com | none | Online language lessons marketplace. |
| Learnlight | tutoring_platform | https://www.learnlight.com/en/ | none | Corporate language and skills-training company (/en/); trainers apply via its careers page. |

## ACTIVE sources: how to ingest

### We Work Remotely — `rss`
- rss: `https://weworkremotely.com/remote-jobs.rss` — 89 item(s) verified; fields: title ("Company: Title"), link, guid, pubDate, expires_at, region, country, state, skills, category, type, description, media:content (logo, 15/89)
- also json_ld: `https://weworkremotely.com/remote-jobs/datadog-developer-advocate-service-management` (1 item(s))
- selectors (verified): `{"item": "section.jobs li.new-listing-container", "title": ".new-listing__header__title__text", "company": ".new-listing__company-name", "link": "a.listing-link--unlocked[href]", "location": ".new-listing__company-headquarters", "posted": ".new-listing__header__icons__date", "matched": "200 items on the home page (title/link/date 199, company 200, location 195); fallback only"}`
- terms: https://weworkremotely.com/terms-and-conditions — No clause about scraping, crawling, robots or automated access found (searched the saved page for scrap/crawl/spider/robot/automat/harvest/API).
- notes: Main feed advertised via <link rel=alternate>; per-category feeds also linked (/categories/<slug>.rss). Company is the prefix of the RSS title. Detail-page JSON-LD needs json.loads(strict=False) (raw control characters). Home page also links Toptal-sponsored external listings.

### Remotive — `json_api`
- json_api: `https://remotive.com/api/remote-jobs` — 16 item(s) verified; fields: id, url, title, company_name, company_logo, category, tags, job_type, publication_date, candidate_required_location, salary, description
  - API terms: Link back to the Remotive URL and name Remotive as source; do not submit jobs to third-party sites (Jooble, Neuvoo, Google Jobs, LinkedIn Jobs); jobs delayed 24 h; displaying jobs to collect signups/emails is a breach; max ~4 requests/day advised, >2/min blocked; paid private API exists.
- terms: https://github.com/remotive-com/remote-jobs-api — Please note that API documentation and access is granted so that developers can share our jobs further. Please do not submit Remotive jobs to third Party websites, including but not limited to: Jooble, Neuvoo, Google Jobs, LinkedIn Jobs. Please link back to the URL found on Remotive AND mention Remo…
- notes: ACTIVE only for the documented API, under its conditions; the website is behind a Cloudflare challenge for our UA. limit=5 was ignored: the response held all 16 jobs (job-count 16, total-job-count 16) — the free API exposes a small, 24 h-delayed set. Risk: the clause against showing jobs to collect signups may conflict with a sign-in-gated dashboard; get Remotive's OK or show them only with attribution. Same JSON also carries '00-warning' (remotive.io endpoint retired).

### Jobspresso — `rss`
- rss: `https://jobspresso.co/feed/job_feed/` — 10 item(s) verified; fields: title, link, guid, pubDate, description, content:encoded, job_listing:company, job_listing:location, job_listing:job_type, job_listing:job_category, media:content (logo), post-id
- also json_ld: `https://jobspresso.co/job/back-end-engineer-php/` (1 item(s))
- selectors (verified): `{"item": "ul.job_listings li.job_listing", "title": "h3.job_listing-title", "company": "div.job_listing-company strong", "link": "a.job_listing-clickbox[href]", "location": "div.job_listing-location", "posted": "li.job_listing-date", "matched": "20/20 items on the home page"}`
- terms: no terms-of-service page found on the fetched pages
- notes: WordPress + WP Job Manager. Use the pretty-permalink feed /feed/job_feed/ (the ?feed= form is robots-disallowed). The feed returned only the latest 10. No terms-of-service link found on the home page; ToS not verified.

### JustRemote — `json_ld`
- json_ld: `https://justremote.co/remote-developer-jobs/staff-software-engineer-retirement-financial-platform-gusto` — 1 item(s) verified; fields: title, hiringOrganization, datePosted, validThrough, employmentType, jobLocationType, applicantLocationRequirements, description
- also embedded_json: `https://justremote.co/remote-developer-jobs` (84 item(s))
- terms: https://justremote.co/terms — No clause about scraping, crawling, robots or automated access found (searched the saved page for scrap/crawl/spider/robot/automat/harvest/API).
- notes: Listing HTML has no job anchors (React; rendered client-side) but the server ships window.__PRELOADED_STATE__ with 84 jobs on /remote-developer-jobs (homeJobsState has 10 on the home page). Discover via the embedded JSON (href), enrich from detail-page JSON-LD. No RSS found.

### Workew — `json_api`
- wp_rest: `https://workew.com/wp-json/wp/v2/job-listings?per_page=5` — 5 item(s) verified; fields: id, date, modified, link, title.rendered, content.rendered, meta._company_name, meta._job_location, meta._remote_position, meta._job_salary, meta._job_salary_currency, meta._job_salary_unit, meta._application, meta._filled, job-categories, job-types, job_listing_region
- also rss: `https://workew.com/?feed=job_feed` (10 item(s))
- also json_ld: `https://workew.com/job/data-analyst-acorns/` (1 item(s))
- terms: no terms-of-service page found on the fetched pages
- notes: WordPress + WP Job Manager; the /remote-jobs/ list loads by AJAX (no job anchors in the HTML). The WP REST collection is WordPress core, not documented by the site; RSS (latest 10) is the fallback. Only a privacy policy is linked; no terms of service found.

### Working Nomads — `json_api`
- json_api: `https://www.workingnomads.com/api/exposed_jobs/` — 51 item(s) verified; fields: url, title, description, company_name, category_name, tags, location, pub_date
- terms: https://www.workingnomads.com/terms-and-conditions — You agree not to (and not to permit others to): ... b) Resell, sublicense, or otherwise commercially exploit the Service ... d) Access or use the Service to build a competitive product or service.
- notes: workingnomads.co 301 → workingnomads.com. No scraping clause; the 'competitive product' clause (in the subscription terms) is worth a check if the dashboard ever republishes listings. The public API returns the latest 51 jobs.

### Dynamite Jobs — `json_ld`
- json_ld: `https://dynamitejobs.com/company/backgammon/remote-job/senior-full-stack-engineer-us-remote` — 1 item(s) verified; fields: title, hiringOrganization, datePosted, validThrough, employmentType, jobLocationType, applicantLocationRequirements, description, directApply, identifier, occupationalCategory, image, url
- also sitemap: `https://dynamitejobs.com/sitemap/jobs-of-companies-index.xml` (475 item(s))
- also embedded_json: `https://dynamitejobs.com/` (6 item(s))
- terms: https://dynamitejobs.com/terms-and-conditions — No clause about scraping, crawling, robots or automated access found (searched the saved page for scrap/crawl/spider/robot/automat/harvest/API).
- notes: /remote-jobs renders its list client-side (no job anchors; Pinia state holds only SEO data). Job URLs come from the per-company sitemaps (index of 475) or the 6 featured jobs on the home page; each job page carries JSON-LD JobPosting. Expensive discovery; meta robots says 'noarchive'.

### Remote OK — `json_api`
- json_api: `https://remoteok.com/api` — 99 item(s) verified; fields: slug, id, epoch, date, company, company_logo, position, tags, description, location, salary_min, salary_max, apply_url, logo, url
  - API terms: API Terms of Service: link back (followed, no nofollow) to the Remote OK URL and mention Remote OK as source or API access is suspended; do not use the logo.
- terms: https://remoteok.com/api — API Terms of Service: Please link back (with follow, and without nofollow!) to the URL on Remote OK and mention Remote OK as a source, so we get traffic back from your site. If you do not we'll have to suspend API access.
- notes: remoteok.io 301 → remoteok.com (brand redirect). Home table rows are placeholders filled by JS. The /legal ToS has no scraping clause; the API's own notice requires attribution. First array element is the legal notice, not a job (100 elements → 99 jobs).

### Hubstaff Talent — `browser`
- also html: `https://hubstafftalent.net/jobs/remote-magento-developer-6` (1 item(s))
- terms: https://hubstaff.com/terms — No clause about scraping, crawling, robots or automated access found (searched the saved page for scrap/crawl/spider/robot/automat/harvest/API).
- notes: talent.hubstaff.com 301 → hubstafftalent.net. Free job board + freelancer directory. The /search/jobs result container (div.job-results) is empty in the HTML (filled by JS), so listing needs a browser or sitemap discovery; detail pages are plain HTML. The Hubstaff ToS covers the main product; no Talent-specific scraping clause found. Lower confidence than the other ACTIVE sources.

### ProBlogger — `rss`
- rss: `https://problogger.com/jobs/wpjobboard/xml/rss/?filter=active` — 4 item(s) verified; fields: title, link, guid, pubDate, description, category
- also json_ld: `https://problogger.com/jobs/job/agriculture-business-specialist-3/` (1 item(s))
- terms: no terms-of-service page found on the fetched pages
- notes: WPJobBoard. Very low volume: 4 active jobs in the feed, 2 distinct jobs linked on /jobs/. The feed URL in <head> carries many map parameters; the short ?filter=active form works. No terms-of-service link found on the jobs page.

### Remote Freelance ID — `json_ld`
- json_ld: `https://remotefreelance.id/jobs` — 12 item(s) verified; fields: ItemList.itemListElement[].name, description (client location, budget, type, snippet), url, position
- selectors (verified): `{"item": "div.public-jobs-list article.public-job", "title": "h2 a", "link": "h2 a[href]", "matched": "12/12 on /jobs"}`
- terms: https://remotefreelance.id/terms — No clause about scraping or automated access found; the Indonesian 'Syarat & Ketentuan' page (≈4,200 characters) covers accounts and profiles only.
- notes: Re-lists jobs from other sources: URLs are /jobs/upwork/<id>/…, /jobs/seek/<id>/…, plus Glints links. Detail pages have no JobPosting JSON-LD (only WebPage/Breadcrumb). The listing's ItemList JSON-LD is the cleanest source; paginate /jobs?page=N. Because the content originates on Upwork/SEEK/Glints, dedupe against those and respect their terms (Upwork forbids scraping).

### Work From Home ID — `json_ld`
- json_ld: `https://www.workfromhome.id/jobs/765604520-full-stack-e-commerce-developer-with-sage-x3-experience` — 1 item(s) verified; fields: title, hiringOrganization, datePosted, validThrough, employmentType, jobLocationType, applicantLocationRequirements, description, identifier
- selectors (verified): `{"item": "div.job-listings-item", "title": "a.job-details-link h3", "link": "a.job-details-link[href]", "company": "a.job-info-link-item[href^='/companies/']", "location": "div.job-details div.d-flex > :nth-child(5)", "posted": "div.job-posted-date", "job_type": "div.job-details div.d-flex > :nth-child(3)", "matched": "10/10 items on /jobs for every field"}`
- terms: no terms-of-service page found on the fetched pages
- notes: JBoard-style board (jb-* classes). Honour Crawl-delay 1. Listing shows 10 per page; detail pages carry JobPosting JSON-LD. Employers seen include Toptal, Baymard, Webflow — likely partly aggregated. No terms-of-service link found.
