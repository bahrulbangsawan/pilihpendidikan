// The authorization request (17 §4.1) as every consent step sees it: read
// from the query (GET /oauth/authorize), a form (POST /oauth/authorize, the
// decision POST) or a pending email link, and validated the same way each
// time (17 §4.3 step 3: "re-validate every parameter").
//
// Invalid client_id / redirect_uri never redirect: they render an error page,
// so no step can be used as an open redirector.

import type { OAuthScope } from "@pilihpendidikan/jobs-contracts/enums";
import { isId } from "@pilihpendidikan/jobs-contracts/ids";
import { hashToken } from "../auth";
import type { Env } from "../env";
import { escapeHtml, htmlPage, messageBanner } from "../html";
import { CLI_BASE_SCOPES } from "../jobs/core/scopes";
import { getFeatureFlags } from "../jobs/core/flags";
import type { OAuthClientRow } from "./shared";
import {
  cleanDeviceName,
  findClient,
  formatScopes,
  grantableScopes,
  isFirstParty,
  isValidCodeChallenge,
  MAX_STATE_LENGTH,
  MIN_FIRST_PARTY_STATE_LENGTH,
  redirectMatches,
} from "./shared";

export interface AuthorizeParams {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  /** First-party: `dev_…` of the device to sign in again (17 §6 step 6). */
  deviceHint: string;
  /** First-party: shown on consent, carries no authority (17 §4.1). */
  deviceName: string;
  redirectUri: string;
  resource: string;
  responseType: string;
  scope: string;
  state: string;
}

export const PARAM_NAMES: ReadonlyArray<
  readonly [keyof AuthorizeParams, string]
> = [
  ["clientId", "client_id"],
  ["redirectUri", "redirect_uri"],
  ["state", "state"],
  ["codeChallenge", "code_challenge"],
  ["codeChallengeMethod", "code_challenge_method"],
  ["responseType", "response_type"],
  ["scope", "scope"],
  ["resource", "resource"],
  ["deviceName", "device_name"],
  ["deviceHint", "device_hint"],
];

export function readParams(get: (name: string) => string): AuthorizeParams {
  const params = {} as AuthorizeParams;
  for (const [key, name] of PARAM_NAMES) {
    params[key] = get(name);
  }
  return params;
}

/** The parameters as hidden form fields (every value escaped). */
export function hiddenParamInputs(params: AuthorizeParams): string {
  return PARAM_NAMES.filter(([key]) => params[key] !== "")
    .map(
      ([key, name]) =>
        `<input type="hidden" name="${name}" value="${escapeHtml(params[key])}" />`
    )
    .join("\n");
}

/** The parameters as a query string (the "switch account" redirect). */
export function paramsQuery(params: AuthorizeParams): string {
  const query = new URLSearchParams();
  for (const [key, name] of PARAM_NAMES) {
    if (params[key] !== "") {
      query.set(name, params[key]);
    }
  }
  return query.toString();
}

export function errorPage(
  message: string,
  status = 400,
  firstParty = false
): Response {
  const restart = firstParty
    ? "<p>Start the sign-in again from your terminal: <code>pilih-jobs login</code>.</p>"
    : "<p>Start the connection again from your AI app.</p>";
  return htmlPage(
    {
      title: firstParty ? "Cannot sign in" : "Cannot connect",
      body: `<h1>${firstParty ? "This sign-in request is not valid" : "This connection request is not valid"}</h1>
${messageBanner("error", message)}
${restart}`,
    },
    { status }
  );
}

export interface ValidatedAuthorize {
  client: OAuthClientRow;
  firstParty: boolean;
  /** Normalized: cleaned device name, a well-formed device hint or "". */
  params: AuthorizeParams;
  /** First-party: requested ∩ allowed (17 §5). DCR clients: empty (`mcp`). */
  scopes: OAuthScope[];
}

function checkPkce(params: AuthorizeParams, firstParty: boolean) {
  if (params.responseType !== "code") {
    return errorPage("Only response_type=code is supported.", 400, firstParty);
  }
  if (params.codeChallengeMethod !== "S256") {
    return errorPage(
      "PKCE with code_challenge_method=S256 is required.",
      400,
      firstParty
    );
  }
  if (!isValidCodeChallenge(params.codeChallenge)) {
    return errorPage(
      "code_challenge is missing or malformed.",
      400,
      firstParty
    );
  }
  return null;
}

async function checkFirstParty(
  env: Env,
  client: OAuthClientRow,
  params: AuthorizeParams
): Promise<Response | OAuthScope[]> {
  const flags = await getFeatureFlags(env);
  if (!flags.JOBS_CLI_LOGIN_ENABLED) {
    return errorPage("CLI sign-in is not available yet.", 403, true);
  }
  if (params.state.length < MIN_FIRST_PARTY_STATE_LENGTH) {
    return errorPage(
      `state is required (at least ${MIN_FIRST_PARTY_STATE_LENGTH} characters).`,
      400,
      true
    );
  }
  // No scope parameter = the CLI base set (17 §5.1).
  const requested = params.scope.trim()
    ? params.scope
    : formatScopes(CLI_BASE_SCOPES);
  const scopes = grantableScopes(client, requested);
  if (scopes.length === 0) {
    return errorPage("None of the requested scopes can be granted.", 400, true);
  }
  return scopes;
}

/** Validates an authorization request (17 §4); an error page otherwise. */
export async function validateAuthorize(
  env: Env,
  raw: AuthorizeParams
): Promise<ValidatedAuthorize | Response> {
  const params = { ...raw };
  if (!(params.clientId && params.redirectUri)) {
    return errorPage("client_id and redirect_uri are required.");
  }
  const client = await findClient(env.DB, params.clientId);
  if (!client) {
    return errorPage("Unknown client. Register the client first.", 401);
  }
  const firstParty = isFirstParty(client);
  if (!redirectMatches(client, params.redirectUri)) {
    return errorPage(
      "redirect_uri is not registered for this client.",
      400,
      firstParty
    );
  }
  const pkce = checkPkce(params, firstParty);
  if (pkce) {
    return pkce;
  }
  if (params.state.length > MAX_STATE_LENGTH) {
    return errorPage("state is too long.", 400, firstParty);
  }
  if (!firstParty) {
    // DCR (MCP) clients keep the legacy behaviour: `scope`, `device_name`
    // and `device_hint` are ignored, the grant is the `mcp` ceiling.
    return {
      client,
      firstParty,
      params: { ...params, deviceName: "", deviceHint: "" },
      scopes: [],
    };
  }
  const scopes = await checkFirstParty(env, client, params);
  if (scopes instanceof Response) {
    return scopes;
  }
  params.scope = formatScopes(scopes);
  params.deviceName = cleanDeviceName(params.deviceName);
  params.deviceHint = isId("dev", params.deviceHint) ? params.deviceHint : "";
  return { client, firstParty, params, scopes };
}

/** SHA-256 over the normalized parameters (what a CSRF token is bound to). */
export async function paramsHash(params: AuthorizeParams): Promise<string> {
  return await hashToken(
    JSON.stringify(PARAM_NAMES.map(([key]) => params[key]))
  );
}
