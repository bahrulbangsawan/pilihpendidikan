// The server-rendered pages (/connect, the sign-in confirm pages and the
// OAuth consent screens) share one small, dependency-free shell. Every page
// response carries a strict CSP: no external resources, inline styles only,
// scripts only with the per-response nonce, forms may post only to this
// origin, and the page cannot be framed.

const HTML_AMP_RE = /&/g;
const HTML_LT_RE = /</g;
const HTML_GT_RE = />/g;
const HTML_QUOT_RE = /"/g;
const HTML_APOS_RE = /'/g;

export function escapeHtml(value: string): string {
  return value
    .replace(HTML_AMP_RE, "&amp;")
    .replace(HTML_LT_RE, "&lt;")
    .replace(HTML_GT_RE, "&gt;")
    .replace(HTML_QUOT_RE, "&quot;")
    .replace(HTML_APOS_RE, "&#39;");
}

const PAGE_STYLES = `
:root { color-scheme: dark; --bg: #121212; --card: #1e1e1d; --line: rgba(250,249,246,.14); --ink: #faf9f6; --muted: #b4b4b2; --faint: #9a9a98; --field: #2a2a29; --ok: #8fd19e; --err: #f3a6a0; --focus: #8fb4ff; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink); font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
main { width: 100%; max-width: 40rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
.brand { margin: 0 0 1.5rem; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
h1 { margin: 0 0 .75rem; font-size: 24px; line-height: 1.25; font-weight: 500; }
h2 { margin: 2rem 0 .75rem; font-size: 18px; line-height: 1.3; font-weight: 500; }
p { margin: 0 0 1rem; color: var(--muted); }
a { color: var(--ink); text-underline-offset: 3px; }
strong { font-weight: 500; color: var(--ink); }
code { font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; background: var(--field); padding: .1rem .35rem; border-radius: 4px; color: var(--ink); overflow-wrap: anywhere; }
section.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 1.25rem; margin: 0 0 1rem; }
label { display: block; margin: 0 0 .375rem; font-size: 14px; color: var(--muted); }
input[type=email], input[type=text], select { width: 100%; min-height: 2.5rem; padding: .5rem .625rem; font: inherit; color: var(--ink); background: var(--field); border: 1px solid var(--line); border-radius: 4px; }
.field { margin: 0 0 1rem; }
.row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
button { min-height: 2.5rem; padding: .5rem 1rem; font: inherit; font-size: 14px; font-weight: 500; color: #121212; background: var(--ink); border: 0; border-radius: 4px; cursor: pointer; }
button.secondary { color: var(--ink); background: transparent; border: 1px solid var(--line); }
button.danger { color: var(--err); background: transparent; border: 1px solid rgba(243,166,160,.4); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.msg { padding: .75rem 1rem; border-radius: 4px; margin: 0 0 1rem; border: 1px solid var(--line); color: var(--ink); }
.msg.error { border-color: rgba(243,166,160,.5); color: var(--err); }
.msg.ok { border-color: rgba(143,209,158,.5); color: var(--ok); }
.secret { display: flex; gap: .5rem; align-items: stretch; margin: 0 0 1rem; }
.secret input { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: .5rem .5rem .5rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 500; color: var(--muted); }
td form { display: inline; }
.meta { font-size: 14px; color: var(--faint); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 30rem) { table, thead, tbody, tr, th, td { display: block; } thead { display: none; } td { border: 0; padding: .25rem 0; } tr { border-bottom: 1px solid var(--line); padding: .5rem 0; } }`;

export interface PageOptions {
  // Plain-text <title>; escaped here.
  title: string;
  // Pre-escaped HTML for <main>. Callers escape every user-derived value.
  body: string;
  // Inline script, run with the response nonce. Static, trusted code only.
  script?: string;
  // Extra origins a form on this page may submit to or be redirected to
  // (CSP `form-action` also governs the redirect that follows a POST).
  formActionOrigins?: string[];
}

export function renderPage(options: PageOptions, nonce: string): string {
  const script = options.script
    ? `\n<script nonce="${nonce}">${options.script}</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="same-origin" />
<title>${escapeHtml(options.title)}</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
<main>
<p class="brand">pilihpendidikan</p>
${options.body}
</main>${script}
</body>
</html>`;
}

export function htmlPage(
  options: PageOptions,
  init: ResponseInit = {}
): Response {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const formAction = ["'self'", ...(options.formActionOrigins ?? [])].join(" ");
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  // `same-origin`, not `no-referrer`: with no-referrer, browsers send
  // `Origin: null` on same-origin form POSTs, which the CSRF check rejects.
  headers.set("Referrer-Policy", "same-origin");
  headers.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`
  );
  return new Response(renderPage(options, nonce), { ...init, headers });
}

export function messageBanner(kind: "error" | "ok", message: string): string {
  const role = kind === "error" ? "alert" : "status";
  return `<p class="msg ${kind}" role="${role}">${escapeHtml(message)}</p>`;
}
