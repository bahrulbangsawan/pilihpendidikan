## ADDED Requirements

### Requirement: Worker-mediated R2 storage
Job Tracker files (CV PDFs, cover letters, attachments, evidence screenshots, run logs) SHALL be stored in the R2 bucket bound as `JOBS_FILES` under the key `u/{user_id}/{kind}/{fil_id}{ext}` with custom metadata `{user_id, file_id, sha256, kind}`, and SHALL be reachable only through authorized `/api/v1/files` routes, never through public or presigned R2 URLs. (Source: 14 §5.1; 04 §2.5; D-05)

#### Scenario: Key built by the server
- **WHEN** a user uploads a `cv_pdf`
- **THEN** the object key is `u/<their usr_ id>/cv_pdf/<fil_ id>.pdf`, independent of any client-supplied name

### Requirement: Streamed, integrity-checked upload
`POST /api/v1/files` (`files:write`, upload rate limit) SHALL take `multipart/form-data` with a `meta` JSON part (`kind`, `sha256`, `content_type`, `size_bytes`, `links`) followed by the `file` part, insert a `pending` row, stream the body to R2 without buffering while computing the SHA-256, the byte count and the first 8 bytes, pass the declared SHA-256 to R2, and SHALL delete the object and answer `422 policy_violation` when the digest, size or magic bytes differ from the declaration; on success it SHALL mark the row `ready` with its links and `change_log` in one batch and answer `201 {file}`. (Source: 14 §5.2; 05 §7; 08 §6.5; T8-09, TF-UPLOAD)

#### Scenario: Wrong checksum
- **WHEN** the declared `sha256` does not match the uploaded bytes
- **THEN** the response is `422 policy_violation`, the R2 object is deleted and the pending row removed

#### Scenario: Non-PDF bytes as cv_pdf
- **WHEN** a `cv_pdf` upload does not start with `%PDF-`
- **THEN** the upload is refused with `422 policy_violation`

### Requirement: Per-kind content rules and size caps
Uploads SHALL be accepted only with the content types allowed for their kind (`cv_pdf`: PDF; `cover_letter`: PDF, DOCX, plain text; `attachment`: PDF, DOCX, PNG, JPEG; `evidence_screenshot`: PNG, JPEG; `run_log`: JSONL) and magic bytes that match the declared type, and SHALL be refused with `413 payload_too_large` above 5 MB for `cv_pdf` and 25 MB for every other kind. (Source: 05 §7; 08 §6.5; 14 §5.2)

#### Scenario: Oversize CV PDF
- **WHEN** a `cv_pdf` of 6 MB is uploaded
- **THEN** the response is `413 payload_too_large`

### Requirement: Linked uploads are owner-checked
An upload that links a record (for example `links.cv_variant_id`) SHALL be refused with `404` when the record is not the caller's, and a `cv_pdf` linked to a CV variant SHALL only be accepted while the variant can take a PDF (`generating`, or `draft` for a re-render); a successful `cv_pdf` upload SHALL set the variant's `file_id`, move it to `draft` and open a `cv_variant` approval unless auto-approval applies. (Source: 08 §6.5; 11 §6.1; TCV-TICKET-UPLOAD)

#### Scenario: Link to another user's variant
- **WHEN** user B uploads a PDF linked to user A's variant id
- **THEN** the response is `404 not_found` and nothing is stored

### Requirement: Owner-only download
`GET /api/v1/files/{fil_id}/content` (`files:read`) SHALL stream the object only to its owner (`404` otherwise or when the file is not `ready`) with `ETag: "<sha256>"`, `Cache-Control: private, no-store`, `Content-Disposition: attachment` with a name restricted to `[A-Za-z0-9 ._-]` and `X-Content-Type-Options: nosniff`, SHALL answer `304` to a matching `If-None-Match`, and SHALL honour single byte ranges for evidence screenshots only; `GET /api/v1/files/{fil_id}` SHALL return the metadata. (Source: 14 §5.3; 05 §7; TF-DOWNLOAD)

#### Scenario: Another user's file
- **WHEN** user B requests user A's file content
- **THEN** the response is `404`

#### Scenario: Conditional download
- **WHEN** the CLI sends `If-None-Match` with the file's SHA-256
- **THEN** the response is `304` without a body

### Requirement: File deletion
`DELETE /api/v1/files/{fil_id}` (`files:write`) SHALL mark the file `deleted`, and SHALL delete the R2 object immediately only when nothing references the file; a referenced file's object SHALL be removed later by the retention job. (Source: 05 §7; TF-DELETE)

#### Scenario: Deleting an attached CV PDF
- **WHEN** the user deletes a PDF still referenced by a CV variant
- **THEN** the row is `deleted` and the R2 object remains until the retention job finds it unreferenced

### Requirement: File retention
A daily cron job SHALL remove `pending` uploads older than 24 h, delete evidence screenshots and run logs whose `retention_until` passed (screenshots keep the user's evidence retention, default 180 days; run logs 30 days), start a 30-day clock on unreferenced `cv_pdf` / `cover_letter` / `attachment` files and delete them when it expires unless they became referenced again, and purge the objects of deleted unreferenced files, processing at most 5,000 rows per step so the job is resumable. (Source: 14 §5.4, §7; TF-RETENTION)

#### Scenario: Abandoned upload
- **WHEN** a file row has been `pending` for more than 24 hours
- **THEN** the next daily run deletes the R2 object and the row
