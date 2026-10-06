// /connect — the human-facing page the apps link to ("get a token"). It is
// plain server-rendered HTML with no framework:
//
//   signed out: an email form that sends a sign-in link
//   signed in:  mint a personal token (shown once, with a Copy button), list,
//               revoke and delete tokens, MCP connection details, sign out
//
// Every POST is a same-origin form submission. Besides the SameSite=Lax
// session cookie, each POST must carry an Origin (or Sec-Fetch-Site) proving
// it came from this page, so another site cannot drive these actions.

import type { Caller } from "../auth";
import type { McpTokenRow } from "../auth";
import { hashToken, readSessionCookie, resolveBearer } from "../auth";
import type { Env } from "../env";
import { escapeHtml, htmlPage, messageBanner } from "../html";
import { formString, isSameOriginPost, readForm } from "../http";
import { publicOrigin } from "../origins";
import type { PublicToken } from "../personal-tokens";
import {
  cleanLabel,
  deleteOwnedToken,
  listActiveSessions,
  listPersonalTokens,
  MAX_LABEL_LENGTH,
  mintPersonalToken,
  parseScope,
  revokeOwnedToken,
  toPublicToken,
} from "../personal-tokens";
import { clearSessionCookie, endBrowserSession } from "../session";
import { requestSignInLink } from "../sign-in";

const NOTICES: Readonly<Record<string, string>> = {
  revoked: "Access revoked. Anything using it is signed out.",
  deleted: "Token deleted.",
  "signed-out": "You are signed out.",
};

const COPY_SCRIPT = `document.querySelectorAll("[data-copy]").forEach(function (button) {
  button.addEventListener("click", function () {
    var field = document.getElementById(button.getAttribute("data-copy"));
    if (!field) { return; }
    var done = function () { button.textContent = "Copied"; };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(field.value).then(done, function () { field.select(); });
    } else {
      field.select();
      document.execCommand("copy");
      done();
    }
  });
});`;

async function sessionCaller(
  request: Request,
  env: Env
): Promise<Caller | null> {
  const token = readSessionCookie(request);
  if (!token) {
    return null;
  }
  const { caller } = await resolveBearer(token, env);
  return caller;
}

function formatDate(ms: number | null): string {
  return ms ? new Date(ms).toISOString().slice(0, 10) : "Never";
}

function signedOutPage(options: { error?: string; notice?: string } = {}) {
  const banner = options.error
    ? messageBanner("error", options.error)
    : (options.notice && messageBanner("ok", options.notice)) || "";
  return htmlPage(
    {
      title: "Connect · pilihpendidikan",
      body: `<h1>Save to the cloud and connect AI apps</h1>
<p>Sign in with your email to get a personal token. Paste it into the CV, invoice or portfolio builder to save your documents, or connect an AI app such as Claude to edit them for you.</p>
${banner}
<section class="card" aria-labelledby="signin-heading">
<h2 id="signin-heading">Sign in</h2>
<form method="post" action="/connect">
<input type="hidden" name="action" value="request" />
<div class="field">
<label for="email">Email address</label>
<input id="email" type="email" name="email" required autocomplete="email" inputmode="email" />
</div>
<button type="submit">Email me a sign-in link</button>
</form>
<p class="meta">No password. The link expires in 15 minutes.</p>
</section>`,
    },
    { status: options.error ? 400 : 200 }
  );
}

function tokenRow(token: PublicToken): string {
  const id = escapeHtml(token.id);
  const label = escapeHtml(token.label ?? "Untitled token");
  const action =
    token.status === "active"
      ? `<form method="post" action="/connect"><input type="hidden" name="action" value="revoke" /><input type="hidden" name="id" value="${id}" /><button type="submit" class="danger">Revoke<span class="visually-hidden"> ${label}</span></button></form>`
      : `<form method="post" action="/connect"><input type="hidden" name="action" value="delete" /><input type="hidden" name="id" value="${id}" /><button type="submit" class="secondary">Delete<span class="visually-hidden"> ${label}</span></button></form>`;
  return `<tr>
<td>${label}</td>
<td>${token.scope === "read" ? "Read only" : "Read and write"}</td>
<td>${token.status === "active" ? "Active" : "Revoked"}</td>
<td>${formatDate(token.createdAt)}</td>
<td>${formatDate(token.lastUsedAt)}</td>
<td>${action}</td>
</tr>`;
}

function newTokenBlock(origin: string, token: string): string {
  const personalUrl = `${origin}/mcp?token=${encodeURIComponent(token)}`;
  return `<section class="card" aria-labelledby="new-token-heading">
<h2 id="new-token-heading">Your new token</h2>
<p role="status">Copy it now. It is shown only once.</p>
<div class="secret">
<label class="visually-hidden" for="new-token">New token</label>
<input id="new-token" type="text" readonly value="${escapeHtml(token)}" />
<button type="button" data-copy="new-token">Copy</button>
</div>
<p class="meta">In the CV, invoice or portfolio builder, open <strong>Connect via MCP</strong> and paste it into <strong>Personal token</strong>.</p>
<p>Personal MCP URL, for AI apps that only accept a URL:</p>
<div class="secret">
<label class="visually-hidden" for="personal-url">Personal MCP URL</label>
<input id="personal-url" type="text" readonly value="${escapeHtml(personalUrl)}" />
<button type="button" data-copy="personal-url">Copy</button>
</div>
<p class="meta">Keep both private: anyone with them can edit your documents.</p>
</section>`;
}

function sessionRow(row: McpTokenRow, currentHash: string | null): string {
  const label = escapeHtml(row.label ?? "Session");
  const isCurrent = row.token_hash === currentHash;
  const action = isCurrent
    ? "This browser"
    : `<form method="post" action="/connect"><input type="hidden" name="action" value="revoke" /><input type="hidden" name="id" value="${escapeHtml(row.id)}" /><button type="submit" class="danger">Disconnect<span class="visually-hidden"> ${label}</span></button></form>`;
  return `<tr>
<td>${label}</td>
<td>${formatDate(row.created_at)}</td>
<td>${formatDate(row.last_used_at)}</td>
<td>${formatDate(row.expires_at)}</td>
<td>${action}</td>
</tr>`;
}

interface SignedInOptions {
  newToken?: string;
  error?: string;
  notice?: string;
}

async function signedInPage(
  request: Request,
  env: Env,
  caller: Caller,
  options: SignedInOptions = {}
): Promise<Response> {
  const origin = publicOrigin(request);
  const tokens = (await listPersonalTokens(env, caller)).map(toPublicToken);
  const rows = tokens.length
    ? tokens.map(tokenRow).join("\n")
    : `<tr><td colspan="6">No tokens yet.</td></tr>`;
  const cookie = readSessionCookie(request);
  const currentHash = cookie ? await hashToken(cookie) : null;
  const sessions = (await listActiveSessions(env, caller))
    .map((row) => sessionRow(row, currentHash))
    .join("\n");
  let banner = "";
  if (options.error) {
    banner = messageBanner("error", options.error);
  } else if (options.notice) {
    banner = messageBanner("ok", options.notice);
  }
  return htmlPage(
    {
      title: "Connect · pilihpendidikan",
      body: `<h1>Tokens and AI apps</h1>
<p>Signed in as <strong>${escapeHtml(caller.email)}</strong>.</p>
${banner}
${options.newToken ? newTokenBlock(origin, options.newToken) : ""}
<section class="card" aria-labelledby="create-heading">
<h2 id="create-heading">Create a token</h2>
<form method="post" action="/connect">
<input type="hidden" name="action" value="create" />
<div class="field">
<label for="label">Name</label>
<input id="label" type="text" name="label" maxlength="${MAX_LABEL_LENGTH}" placeholder="For example: My laptop" />
</div>
<div class="field">
<label for="scope">Access</label>
<select id="scope" name="scope">
<option value="write">Read and write (needed to save)</option>
<option value="read">Read only</option>
</select>
</div>
<button type="submit">Create token</button>
</form>
</section>
<section class="card" aria-labelledby="tokens-heading">
<h2 id="tokens-heading">Your tokens</h2>
<table>
<thead><tr><th scope="col">Name</th><th scope="col">Access</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</section>
<section class="card" aria-labelledby="sessions-heading">
<h2 id="sessions-heading">Connected apps and browsers</h2>
<table>
<thead><tr><th scope="col">Name</th><th scope="col">Since</th><th scope="col">Last used</th><th scope="col">Expires</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
<tbody>
${sessions}
</tbody>
</table>
</section>
<section class="card" aria-labelledby="mcp-heading">
<h2 id="mcp-heading">Connect an AI app</h2>
<p>Add a custom MCP connector with this URL. The app opens a sign-in page the first time.</p>
<div class="secret">
<label class="visually-hidden" for="mcp-url">MCP server URL</label>
<input id="mcp-url" type="text" readonly value="${escapeHtml(`${origin}/mcp`)}" />
<button type="button" data-copy="mcp-url">Copy</button>
</div>
<p class="meta">Older clients that only speak SSE use <code>${escapeHtml(`${origin}/sse`)}</code>. Clients without sign-in support can send a token as <code>Authorization: Bearer &lt;token&gt;</code>.</p>
</section>
<form method="post" action="/connect">
<input type="hidden" name="action" value="logout" />
<button type="submit" class="secondary">Sign out</button>
</form>`,
      script: COPY_SCRIPT,
    },
    { status: options.error ? 400 : 200 }
  );
}

function redirectToConnect(
  request: Request,
  notice: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${publicOrigin(request)}/connect?notice=${notice}`,
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

async function handleGet(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const noticeKey = url.searchParams.get("notice") ?? "";
  const notice = Object.hasOwn(NOTICES, noticeKey)
    ? NOTICES[noticeKey]
    : undefined;
  const caller = await sessionCaller(request, env);
  return caller
    ? await signedInPage(request, env, caller, { notice })
    : signedOutPage({ notice });
}

async function handleSignInRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  form: FormData | null
): Promise<Response> {
  const email = formString(form, "email");
  const result = await requestSignInLink(request, env, ctx, email, null);
  if (!result.ok) {
    return signedOutPage({ error: result.error });
  }
  return htmlPage({
    title: "Check your email",
    body: `<h1>Check your email</h1>
<p role="status">We sent a sign-in link to <strong>${escapeHtml(email.trim().toLowerCase())}</strong>. Open it on this device to continue.</p>
<p class="meta">The link expires in 15 minutes and works once. Nothing arrived? Check spam, or <a href="/connect">try again</a>.</p>`,
  });
}

async function handleSignedInAction(
  request: Request,
  env: Env,
  caller: Caller,
  action: string,
  form: FormData | null
): Promise<Response> {
  if (action === "create") {
    const scope = parseScope(formString(form, "scope"));
    if (!scope) {
      return signedInPage(request, env, caller, {
        error: "Choose an access level.",
      });
    }
    const result = await mintPersonalToken(
      env,
      caller,
      cleanLabel(formString(form, "label")),
      scope
    );
    return result.ok
      ? signedInPage(request, env, caller, { newToken: result.token })
      : signedInPage(request, env, caller, { error: result.error });
  }
  if (action === "revoke" || action === "delete") {
    const id = formString(form, "id");
    const change =
      action === "revoke"
        ? await revokeOwnedToken(env, caller, id)
        : await deleteOwnedToken(env, caller, id);
    return change.ok
      ? redirectToConnect(request, action === "revoke" ? "revoked" : "deleted")
      : signedInPage(request, env, caller, { error: change.error });
  }
  return signedInPage(request, env, caller, { error: "Unknown action." });
}

async function handlePost(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!isSameOriginPost(request)) {
    return htmlPage(
      {
        title: "Request blocked",
        body: `<h1>Request blocked</h1>
${messageBanner("error", "This form must be sent from the /connect page.")}
<p><a href="/connect">Go to /connect</a></p>`,
      },
      { status: 403 }
    );
  }
  const form = await readForm(request);
  const action = formString(form, "action");
  if (action === "request") {
    return await handleSignInRequest(request, env, ctx, form);
  }
  if (action === "logout") {
    const token = readSessionCookie(request);
    if (token) {
      await endBrowserSession(env, token);
    }
    return redirectToConnect(request, "signed-out", {
      "Set-Cookie": clearSessionCookie(request),
    });
  }
  const caller = await sessionCaller(request, env);
  if (!caller) {
    return signedOutPage({ error: "Your session ended. Sign in again." });
  }
  return await handleSignedInAction(request, env, caller, action, form);
}

export function routeConnect(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> | Response | null {
  if (url.pathname !== "/connect" && url.pathname !== "/") {
    return null;
  }
  if (url.pathname === "/") {
    return new Response(null, {
      status: 302,
      headers: { Location: `${publicOrigin(request)}/connect` },
    });
  }
  if (request.method === "GET" || request.method === "HEAD") {
    return handleGet(request, env, url);
  }
  if (request.method === "POST") {
    return handlePost(request, env, ctx);
  }
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD, POST" },
  });
}
