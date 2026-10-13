## 1. Contracts and API
- [x] 1.1 `restore` in `INBOX_BULK_ACTIONS`; regenerate schema and CLI models
- [x] 1.2 `inbox:bulk` restore (dismissed → seen) + TD-BULK test
- [x] 1.3 05 §4 table

## 2. Dashboard
- [x] 2.1 Shared selection / bulk run / bulk chrome
- [x] 2.2 Board delete permanently; inbox restore
- [x] 2.3 Approvals, rules, runs
- [x] 2.4 Sources, devices, answers, interviews, offers
- [x] 2.5 Mock api, DOM tests, i18n (en + id)
- [x] 2.6 Confirmation before deleting a single saved answer

## 3. CLI
- [x] 3.1 Multi-id application, rules, devices, approvals commands
- [x] 3.2 `inbox seen|restore`, `tasks list|cancel|retry`
- [x] 3.3 Width-fitting tables with untruncated ids, `--ids`, `--all`, whitespace-separated ids in one argument; FakeApi routes; tests; 16 §3.3

## 4. Verification
- [x] 4.1 `bun run check`, `bun run check-types`
- [x] 4.2 Local full stack: CLI and dashboard bulk actions against the real api
