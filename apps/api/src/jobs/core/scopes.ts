// Credential → OAuth scope map (05 §1.2, 17 §5).
//
// | credential                                   | scopes                                             |
// |----------------------------------------------|----------------------------------------------------|
// | browser session (KV or `kind='session'` row  | every scope except `automation:execute`            |
// |   labelled "Browser session")                |   (device-bound only); includes `ai:invoke`        |
// | personal token, scope `write`                | every scope except `automation:execute`,           |
// |                                              |   `ai:invoke`, `automation:manage`                 |
// | personal token, scope `read`                 | `jobs:read cv:read files:read`                     |
// | MCP OAuth (`kind='session'` rows that are    | same as a `write` personal token                   |
// |   not browser sessions; `mcp` ceiling)       |                                                    |
// | `kind='oauth'` rows (CLI and other clients)  | exactly the row's `scopes` column (`mcp` ⇒ the     |
// |                                              |   MCP set above)                                   |

import type {
  CredentialKind,
  OAuthScope,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  MCP_CLIENT_SCOPE,
  OAUTH_SCOPES,
} from "@pilihpendidikan/jobs-contracts/enums";

function without(excluded: readonly OAuthScope[]): readonly OAuthScope[] {
  return Object.freeze(OAUTH_SCOPES.filter((s) => !excluded.includes(s)));
}

/** Browser-session bearers (the BFF and the other apps). */
export const BROWSER_SESSION_SCOPES: readonly OAuthScope[] = without([
  "automation:execute",
]);

/** `write` personal tokens: no AI spend, no automation from long-lived tokens. */
export const PERSONAL_WRITE_SCOPES: readonly OAuthScope[] = without([
  "automation:execute",
  "ai:invoke",
  "automation:manage",
]);

/** `read` personal tokens. */
export const PERSONAL_READ_SCOPES: readonly OAuthScope[] = Object.freeze([
  "jobs:read",
  "cv:read",
  "files:read",
] as const);

/** MCP OAuth tokens (`allowed_scopes = 'mcp'`, 17 §3.2). */
export const MCP_OAUTH_SCOPES: readonly OAuthScope[] = PERSONAL_WRITE_SCOPES;

/** The CLI base login set (17 §5.1); step-up adds manage scopes (D-29). */
export const CLI_BASE_SCOPES: readonly OAuthScope[] = Object.freeze([
  "jobs:read",
  "jobs:write",
  "discovery:write",
  "automation:execute",
  "cv:read",
  "files:read",
  "files:write",
  "ai:invoke",
  "offline_access",
] as const);

const KNOWN = new Set<string>(OAUTH_SCOPES);
const WHITESPACE_RE = /\s+/;

export function isOAuthScope(value: string): value is OAuthScope {
  return KNOWN.has(value);
}

/**
 * Parses a space-delimited scope string (an `mcp_tokens.scopes` or
 * `oauth_grants.scopes` value). Unknown names are dropped; the legacy `mcp`
 * ceiling expands to the MCP set. The result keeps the 05 §1.2 order and has
 * no duplicates.
 */
export function parseScopeList(value: string | null | undefined): OAuthScope[] {
  if (!value) {
    return [];
  }
  const requested = new Set<string>();
  for (const part of value.trim().split(WHITESPACE_RE)) {
    if (part === MCP_CLIENT_SCOPE) {
      for (const scope of MCP_OAUTH_SCOPES) {
        requested.add(scope);
      }
    } else if (KNOWN.has(part)) {
      requested.add(part);
    }
  }
  return OAUTH_SCOPES.filter((s) => requested.has(s));
}

/** Space-delimited form, in 05 §1.2 order. */
export function formatScopeList(scopes: readonly string[]): string {
  const set = new Set(scopes);
  return OAUTH_SCOPES.filter((s) => set.has(s)).join(" ");
}

/** The scopes a credential carries (05 §1.2). */
export function scopesForCredential(
  kind: CredentialKind,
  storedScopes: string | null = null
): readonly OAuthScope[] {
  switch (kind) {
    case "browser_session":
      return BROWSER_SESSION_SCOPES;
    case "personal_write":
      return PERSONAL_WRITE_SCOPES;
    case "personal_read":
      return PERSONAL_READ_SCOPES;
    case "oauth_mcp":
      return MCP_OAUTH_SCOPES;
    case "oauth_cli":
      return parseScopeList(storedScopes);
    default:
      return [];
  }
}

/**
 * The legacy `write`/`read` scope of a scoped credential: `write` iff it can
 * write jobs (17 §5.2: a CLI token on /mcp is `read` unless it has jobs:write).
 */
export function legacyScopeFor(scopes: readonly string[]): "write" | "read" {
  return scopes.includes("jobs:write") ? "write" : "read";
}

/** True when every scope in `needed` is granted. */
export function hasScopes(
  granted: readonly string[],
  needed: readonly string[]
): boolean {
  return needed.every((scope) => granted.includes(scope));
}

/** Scopes from `needed` that `granted` lacks, in 05 §1.2 order. */
export function missingScopes(
  granted: readonly string[],
  needed: readonly string[]
): OAuthScope[] {
  return OAUTH_SCOPES.filter(
    (scope) => needed.includes(scope) && !granted.includes(scope)
  );
}
