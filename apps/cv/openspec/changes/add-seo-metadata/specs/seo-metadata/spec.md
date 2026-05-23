## ADDED Requirements

### Requirement: Page Title and Description
The system SHALL render an optimized title tag and meta description in the document head for search engine display.

#### Scenario: Title tag length
- **WHEN** the page is rendered
- **THEN** the `<title>` tag contains 30-60 characters describing the page purpose

#### Scenario: Meta description presence
- **WHEN** the page is rendered
- **THEN** a `<meta name="description">` tag is present with 120-160 characters

### Requirement: Canonical URL
The system SHALL declare a canonical URL to prevent duplicate content indexing.

#### Scenario: Canonical link tag
- **WHEN** the page is rendered
- **THEN** a `<link rel="canonical">` tag is present with an absolute URL matching the page

### Requirement: Open Graph Tags
The system SHALL include Open Graph meta tags for proper social media previews on Facebook, LinkedIn, and other platforms.

#### Scenario: Required OG tags present
- **WHEN** the page is rendered
- **THEN** the following meta tags are present: `og:title`, `og:description`, `og:image`, `og:url`, `og:type`
- **AND** `og:image` references an image at least 1200x630 pixels
- **AND** `og:url` is an absolute URL

### Requirement: Twitter Card Tags
The system SHALL include Twitter Card meta tags for proper previews on Twitter/X.

#### Scenario: Twitter card configuration
- **WHEN** the page is rendered
- **THEN** `<meta name="twitter:card" content="summary_large_image">` is present
- **AND** `twitter:title`, `twitter:description`, and `twitter:image` are set

### Requirement: JSON-LD Structured Data
The system SHALL include JSON-LD structured data so search engines can understand the page is a web application.

#### Scenario: WebApplication schema
- **WHEN** the page is rendered
- **THEN** a `<script type="application/ld+json">` block is present
- **AND** it contains a valid `WebApplication` schema with `name`, `description`, `url`, and `applicationCategory` properties

### Requirement: Heading Hierarchy
The system SHALL have exactly one H1 heading per page with a logical heading hierarchy (H1 > H2 > H3).

#### Scenario: Single H1 on index page
- **WHEN** the index page is rendered
- **THEN** exactly one `<h1>` element is present
- **AND** all H2 headings are nested logically under it with no skipped heading levels

### Requirement: Sitemap
The system SHALL provide a valid XML sitemap at `/sitemap.xml` listing all indexable URLs.

#### Scenario: Sitemap accessibility
- **WHEN** a crawler requests `/sitemap.xml`
- **THEN** a valid XML document is returned with `<urlset>` containing `<url><loc>` entries

#### Scenario: Robots.txt sitemap directive
- **WHEN** a crawler requests `/robots.txt`
- **THEN** the file includes a `Sitemap:` directive pointing to the absolute URL of the sitemap
