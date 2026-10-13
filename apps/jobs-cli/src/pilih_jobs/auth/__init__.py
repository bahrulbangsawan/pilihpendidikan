"""OAuth 2.0 + PKCE loopback login, credential storage and token refresh (17).

- `pkce` — verifier/challenge/state (RFC 7636, 17 §4.1);
- `metadata` — RFC 8414 authorization-server metadata (cached 24 h);
- `loopback` — the one-shot `127.0.0.1` redirect listener (RFC 8252, 17 §10.1);
- `store` — keyring / opt-in encrypted-file secret stores and `credentials.json` (17 §12);
- `session` — `TokenManager`: access tokens, refresh under `auth.lock` (17 §7.3);
- `flow` — `login()` / `logout()` orchestration with device registration (17 §6, §8).
"""

from typing import Final

CLIENT_ID: Final = "pilih-jobs-cli"
KEYRING_SERVICE: Final = "pilih-jobs"

#: Requested at every login (17 §5.1).
BASE_SCOPES: Final = (
    "jobs:read",
    "jobs:write",
    "discovery:write",
    "automation:execute",
    "cv:read",
    "files:read",
    "files:write",
    "ai:invoke",
    "offline_access",
)
#: Requested on demand with `pilih-jobs login --scope …` (17 §5.1, D-29).
STEP_UP_SCOPES: Final = ("automation:manage", "devices:manage", "cv:write")
ALL_SCOPES: Final = (*BASE_SCOPES, *STEP_UP_SCOPES)
