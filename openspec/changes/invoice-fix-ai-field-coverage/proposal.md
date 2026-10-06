# Change: Fix AI assistant field coverage gaps

## Why

The CV AI assistant cannot read or write all CV fields. Several fields are missing from serialization (AI can't see them), apply handlers (AI can't update them), and system prompt format docs (AI doesn't know the format). The legacy `cv-tools.ts` is also dead code — superseded by `cv-assistant.tsx` handlers.

## What Changes

- **serializeCV()** — add missing fields: `url` (experience, awards, certificates), `gpa` (education), `credentialId` (certificates), `category` (education)
- **handleApplyAction()** — add full-field parsing for experience entries (not just description), add missing fields to education/awards/certificates parsers, add `url` to awards/certificates
- **System prompt format docs** — update pipe-delimited examples to include all fields
- **cv-tools.ts** — **REMOVED** — dead code, fully superseded by `cv-assistant.tsx`

## Coverage Matrix (Current State)

### PersonalInfo

| Field    | Serialized | Writable   | In Prompt |
| -------- | ---------- | ---------- | --------- |
| fullName | YES        | YES (JSON) | NO        |
| jobTitle | YES        | YES (JSON) | NO        |
| email    | YES        | YES (JSON) | NO        |
| phone    | YES        | YES (JSON) | NO        |
| location | YES        | YES (JSON) | NO        |
| linkedIn | YES        | YES (JSON) | NO        |
| photoUrl | NO         | NO         | NO        |
| usePhoto | NO         | NO         | NO        |

> photoUrl/usePhoto: Skip — AI cannot generate photos, intentionally excluded.

### ExperienceEntry

| Field          | Serialized | Writable | In Prompt |
| -------------- | ---------- | -------- | --------- |
| company        | YES        | NO       | NO        |
| url            | NO         | NO       | NO        |
| title          | YES        | NO       | NO        |
| workType       | YES        | NO       | NO        |
| locationPolicy | YES        | NO       | NO        |
| startDate      | YES        | NO       | NO        |
| endDate        | YES        | NO       | NO        |
| current        | YES        | NO       | NO        |
| description    | YES        | YES      | YES       |

> Only description is writable. All other fields are read-only to AI.

### EducationEntry

| Field       | Serialized    | Writable            | In Prompt |
| ----------- | ------------- | ------------------- | --------- |
| category    | YES (partial) | NO                  | NO        |
| institution | YES           | YES                 | YES       |
| degree      | YES           | YES                 | YES       |
| gpa         | NO            | NO                  | NO        |
| startDate   | YES           | YES                 | YES       |
| endDate     | YES           | YES                 | YES       |
| current     | YES           | YES (via "Present") | YES       |

### SkillCategory

| Field | Serialized | Writable | In Prompt |
| ----- | ---------- | -------- | --------- |
| name  | YES        | YES      | YES       |
| items | YES        | YES      | YES       |

> Full coverage.

### AwardEntry

| Field       | Serialized | Writable | In Prompt |
| ----------- | ---------- | -------- | --------- |
| title       | YES        | YES      | YES       |
| issuer      | YES        | YES      | YES       |
| date        | YES        | YES      | YES       |
| description | YES        | YES      | YES       |
| url         | NO         | NO       | NO        |

### CertificateEntry

| Field        | Serialized | Writable | In Prompt |
| ------------ | ---------- | -------- | --------- |
| name         | YES        | YES      | YES       |
| issuer       | YES        | YES      | YES       |
| date         | YES        | YES      | YES       |
| expiryDate   | YES        | YES      | YES       |
| credentialId | YES        | YES      | YES       |
| url          | NO         | NO       | NO        |

### LanguageEntry

| Field       | Serialized | Writable | In Prompt |
| ----------- | ---------- | -------- | --------- |
| language    | YES        | YES      | YES       |
| proficiency | YES        | YES      | YES       |

> Full coverage.

### ProjectEntry

| Field       | Serialized | Writable | In Prompt |
| ----------- | ---------- | -------- | --------- |
| name        | YES        | YES      | YES       |
| url         | YES        | YES      | YES       |
| description | YES        | YES      | YES       |

> Full coverage.

### VolunteerEntry

| Field        | Serialized | Writable            | In Prompt |
| ------------ | ---------- | ------------------- | --------- |
| organization | YES        | YES                 | YES       |
| role         | YES        | YES                 | YES       |
| startDate    | YES        | YES                 | YES       |
| endDate      | YES        | YES                 | YES       |
| current      | YES        | YES (via "Present") | YES       |
| description  | YES        | YES                 | YES       |

> Full coverage.

## Summary of Gaps

1. **Experience** — only `description` writable; `company`, `url`, `title`, `workType`, `locationPolicy`, dates not writable
2. **Education** — `gpa` not serialized/writable; `category` not writable
3. **Awards** — `url` not serialized/writable
4. **Certificates** — `url` not serialized/writable
5. **Experience** — `url` not serialized
6. **Dead code** — `cv-tools.ts` is never used for actual mutations (cv-assistant.tsx does all)

## Impact

- Affected code: `src/components/ai/cv-system-prompt.ts`, `src/components/ai/cv-assistant.tsx`, `src/components/ai/cv-tools.ts`
- No breaking changes — additive field support + dead code removal
