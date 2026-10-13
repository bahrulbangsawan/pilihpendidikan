## ADDED Requirements

### Requirement: Stats screen
`apps/jobs` SHALL provide a Stats screen at `/stats` showing, for a selectable range (presets or a valid custom `from` / `to`, queried with the browser time zone), four stat cells, an unconfirmed-submissions callout linking to the filtered board, the funnel, the weekly applications series (monthly beyond a year), rejections by stage, time to response (median with P75), the breakdown table with a dimension switcher and the automation reliability card; rates below a cohort or group of 5 MUST be hidden with the hint that rates appear after 5 applications. (Source: 10 §8; 12 §9)

#### Scenario: Small cohort
- **WHEN** the summary's cohort is smaller than 5
- **THEN** the stat cells show counts and the rates hint instead of percentages

#### Scenario: Breakdown switcher
- **WHEN** the user picks "Score band" in the breakdown switcher
- **THEN** the breakdown is fetched again with `by=score_band`

#### Scenario: Empty period
- **WHEN** the selected period has no activity
- **THEN** the empty state links to the Board and the Inbox

#### Scenario: Failed summary
- **WHEN** the summary request fails
- **THEN** an error with Retry is shown and Retry asks again

### Requirement: Accessible chart data tables
Every chart on the Stats screen SHALL have a focusable toggle button that swaps the chart for a data table (with a caption, scoped headers and the chart's numbers) and back, and the chart itself SHALL be exposed as a labelled image. (Source: 10 §8; 12 §9; T10-10)

#### Scenario: Keyboard toggle
- **WHEN** a keyboard user focuses a chart's toggle and presses Enter
- **THEN** the chart is replaced by a table holding the same numbers

### Requirement: Analytics through the BFF with a 60-second cache
The dashboard SHALL read analytics only through the BFF `bffRequest` server function, which SHALL cache the answers of the summary, timeseries and breakdown routes per user (keyed by the SHA-256 of the bearer and the request path) for 60 seconds in the isolate. (Source: 10 §6; D-15)

#### Scenario: Repeated request
- **WHEN** the same user requests the same summary twice within 60 seconds
- **THEN** the second answer comes from the BFF cache without calling the api
