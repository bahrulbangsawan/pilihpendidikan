## 1. Serialization gaps (cv-system-prompt.ts)
- [x] 1.1 Add `url` to Experience serialization
- [x] 1.2 Add `gpa` to Education serialization
- [x] 1.3 Add `url` to Awards serialization
- [x] 1.4 Add `url` to Certificates serialization

## 2. Apply handler gaps (cv-assistant.tsx)
- [x] 2.1 Update Experience handler to parse full entries (Company | URL | Title | WorkType | LocationPolicy | StartDate | EndDate | Description) — not just description
- [x] 2.2 Update Education handler to include `gpa` and `category` fields
- [x] 2.3 Update Awards handler to include `url` field
- [x] 2.4 Update Certificates handler to include `url` field

## 3. System prompt format docs (cv-system-prompt.ts)
- [x] 3.1 Update Experience format example with all fields
- [x] 3.2 Update Education format example to include GPA and Category
- [x] 3.3 Update Awards format example to include URL
- [x] 3.4 Update Certificates format example to include URL

## 4. Dead code removal
- [x] 4.1 Delete `src/components/ai/cv-tools.ts`
- [x] 4.2 Remove any imports of cv-tools.ts across the codebase (none found)

## 5. Verification
- [x] 5.1 Grep every interface field name and confirm it appears in serializeCV and handleApplyAction — 41/41 fields covered
- [x] 5.2 Run `bunx biome check src/components/ai/` — zero errors
