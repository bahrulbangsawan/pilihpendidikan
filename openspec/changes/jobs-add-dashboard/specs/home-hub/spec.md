## MODIFIED Requirements

### Requirement: Service status config
The hub SHALL derive every status-dependent output (service cards, the MCP
item, JSON-LD and `llms.txt`) from one typed config that maps each of `cv`,
`invoice`, `portfolio`, `jobs` and `api` to `{ status: "soon" | "live", url }`,
with `jobs` pointing at `https://jobs.pilihpendidikan.com` and listed after
the three builders in `TOOL_IDS`. (Source: 12 §15)

#### Scenario: Going live is one line
- **WHEN** `SERVICES.cv.status` changes from `"soon"` to `"live"` and the hub is rebuilt
- **THEN** the CV card, JSON-LD and `llms.txt` all show the CV builder as available, and nothing else in the source needed to change

#### Scenario: Job tracker before launch
- **WHEN** `SERVICES.jobs.status` is `"soon"`
- **THEN** the job tracker card shows "Coming soon" and the page contains no link to `https://jobs.pilihpendidikan.com`

## ADDED Requirements

### Requirement: Job tracker card
The hub SHALL show a job tracker card with the name "Job tracker" / "Pelacak lamaran" and the description "Track applications on a board, discover jobs and apply from your computer with the CLI." (Indonesian: "Lacak lamaran di papan, temukan lowongan, dan lamar dari komputer Anda dengan CLI."), and its status MUST stay `soon` until the jobs Worker is deployed and smoke-tested per `DEPLOY.md` § Going live. (Source: 12 §15; 13 §9)

#### Scenario: Both locales
- **WHEN** `/` and `/id` are rendered
- **THEN** each shows the job tracker card with its localized name and description
