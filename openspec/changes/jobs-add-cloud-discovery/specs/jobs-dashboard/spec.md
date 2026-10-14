## ADDED Requirements

### Requirement: Remote job boards on /sources
The `/sources` screen SHALL show the cloud catalog above the CLI sources with each board's status and reason, category, strategy, origin, last success, next check, jobs found and new, success rate, average duration and a follow switch, filters by status group, following and text, and a detail sheet with diagnostics, authentication and terms notes, statistics and recent runs whose logs render as plain text. (Source: 24 §5.5)

#### Scenario: Follow a board
- **WHEN** a user turns on the follow switch of a board
- **THEN** the switch updates optimistically, the API backfills recent jobs and a toast reports how many were added

#### Scenario: Log text stays text
- **WHEN** a run log message contains HTML
- **THEN** it is shown as literal text

### Requirement: Operator controls
For operators the sheet SHALL offer enable, priority, interval, strategy with a live-validated config, rate limits, AI and browser switches, health override and notes, plus run now, retry (with a confirmation that it clears the breaker) and re-probe, and the toolbar SHALL offer add board and refresh directory; these controls SHALL be hidden from other users. (Source: 24 §5.4)

#### Scenario: Plain user
- **WHEN** a user who is not an operator opens a board
- **THEN** no operator control is rendered
