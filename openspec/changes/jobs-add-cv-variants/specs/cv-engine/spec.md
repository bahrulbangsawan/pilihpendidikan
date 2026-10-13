## ADDED Requirements

### Requirement: Private CV visibility
A stored CV document SHALL accept an optional `visibility` of `"public"` or `"private"`, where an absent value means public, and every tailored Job Tracker variant SHALL be written with `visibility: "private"` so existing CVs keep today's public-by-id behaviour. (Source: 08 §9; D-25)

#### Scenario: Existing CV unchanged
- **WHEN** anyone requests `GET /api/cv/<id>` for a CV without a `visibility` field
- **THEN** the document is returned as before

#### Scenario: Tailored variant stored private
- **WHEN** the tailoring consumer saves a tailored document
- **THEN** the stored CV carries `visibility: "private"`

### Requirement: Owner-only reads of private CVs
The api Worker SHALL answer `404` on `GET /api/cv/<id>`, its `.json` / `.pdf` aliases and the `/cv/<slug>.pdf` print redirect for a private CV unless the request carries the owner's own credential (bearer or session cookie), with no admin bypass, and MCP `cv_get` SHALL refuse another user's private CV while `cv_list` hides it. (Source: 08 §9; D-25, D-26; TCV-PRIVATE)

#### Scenario: Stranger reads a private CV
- **WHEN** an unauthenticated client or another user (including an admin) requests a private CV
- **THEN** the response is `404` and no print redirect is issued

#### Scenario: Owner reads it
- **WHEN** the owner requests the same CV with their own bearer token
- **THEN** the document is returned and the print redirect works

### Requirement: Privacy kept on save and noindex for tailored slugs
A save of a private CV that omits `visibility` SHALL keep it private, an unknown `visibility` value SHALL be refused, and responses for `-t-` (tailored) slugs SHALL carry `X-Robots-Tag: noindex` even when the owner has made the document public. (Source: 08 §9; D-25; TCV-PRIVATE)

#### Scenario: Builder save without the field
- **WHEN** the CV builder saves a private CV with a body that has no `visibility`
- **THEN** the stored document stays private

#### Scenario: Public tailored slug
- **WHEN** a public CV whose id ends in `-t-<10 chars>` is read
- **THEN** the response carries `X-Robots-Tag: noindex`
