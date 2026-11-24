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

// The Cursor design system (DESIGN.md), rebuilt as plain CSS: cursor.com's
// dark theme. The strict CSP allows inline styles only, so there are no web
// fonts (Geist renders when it is installed, else the system UI face). Warm
// near-black page, a 48px header over a 10% rule, cards one step lighter with
// a 2.5% hairline and 4px corners, 36px fields with 8px corners, pill
// buttons (the light pill is the one main action), orange only for text
// links, colour-only transitions in 140ms.
const PAGE_STYLES = `
:root { color-scheme: dark; --bg: #14120b; --card: #1b1913; --pane: #201e18; --pane-2: #26241e; --pane-3: #2b2923; --fg: #edecec; --muted: color-mix(in oklab, #edecec 60%, transparent); --border: color-mix(in oklab, #edecec 10%, transparent); --input: color-mix(in oklab, #edecec 20%, transparent); --hairline: color-mix(in oklab, #edecec 2.5%, transparent); --primary: #edecec; --primary-hover: #d7d6d5; --on-primary: #14120b; --link: #f54e00; --error: #e0607f; --success: #4cc79b; --ease: cubic-bezier(0.4, 0, 0.2, 1); }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--fg); font: 400 14px/1.5 "Geist Variable", "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: 0.01em; -webkit-font-smoothing: antialiased; }
header { border-bottom: 1px solid var(--border); }
.rail { width: calc(100% - 40px); max-width: 44rem; margin: 0 auto; }
header .rail { display: flex; align-items: center; height: 48px; }
.brand { margin: 0; color: var(--fg); font-size: 16px; letter-spacing: 0.005em; }
main.rail { padding: 48px 0 64px; }
h1 { margin: 0 0 12px; color: var(--fg); font-size: 26px; line-height: 1.25; letter-spacing: -0.0125em; font-weight: 400; }
h2 { margin: 0 0 12px; color: var(--fg); font-size: 16px; letter-spacing: 0.005em; font-weight: 500; }
p { margin: 0 0 16px; }
main > p:first-of-type { font-size: 16px; letter-spacing: 0.005em; }
a { color: var(--link); text-decoration: none; transition: color 140ms var(--ease); }
a:hover { color: color-mix(in oklab, var(--link) 75%, transparent); }
strong { color: var(--fg); font-weight: 500; }
code { padding: 1px 6px; border-radius: 4px; background: var(--pane); color: var(--fg); font: 400 12px/1.5 "Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0; overflow-wrap: anywhere; }
section.card { margin: 0 0 24px; padding: 17.5px; border-radius: 4px; background: var(--card); box-shadow: inset 0 0 0 1px var(--hairline); }
section.card > :last-child { margin-bottom: 0; }
label { display: block; margin: 0 0 6px; color: var(--fg); }
input[type=email], input[type=text], select { width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; outline: none; transition: border-color 140ms var(--ease); }
input[type=email]:hover, input[type=text]:hover, select:hover { border-color: var(--input); }
input::placeholder { color: var(--muted); }
input:focus-visible, select:focus-visible { border-color: var(--input); outline: 2px solid var(--fg); outline-offset: 0; }
@media (pointer: coarse) { input[type=email], input[type=text], select { font-size: 16px; } }
.field { margin: 0 0 16px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 16px; border: 1px solid transparent; border-radius: 9999px; background: var(--primary); color: var(--on-primary); font: inherit; line-height: 1; white-space: nowrap; cursor: pointer; transition: background-color 140ms var(--ease), border-color 140ms var(--ease), color 140ms var(--ease); }
button:hover { background: var(--primary-hover); }
button.secondary { border-color: var(--hairline); background: var(--pane-2); color: var(--fg); }
button.secondary:hover { background: var(--pane-3); }
button.danger { background: color-mix(in oklab, var(--error) 10%, transparent); color: var(--error); }
button.danger:hover { background: color-mix(in oklab, var(--error) 15%, transparent); }
button.link { display: inline; height: auto; padding: 0; border: 0; border-radius: 0; background: none; color: var(--link); font: inherit; }
button.link:hover { background: none; color: color-mix(in oklab, var(--link) 75%, transparent); }
ul.scopes { margin: 0 0 16px; padding: 0; list-style: none; border-top: 1px solid var(--border); }
ul.scopes li { position: relative; padding: 8px 0 8px 18px; border-bottom: 1px solid var(--border); color: var(--fg); }
ul.scopes li::before { content: ""; position: absolute; left: 4px; top: 15.5px; width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
:focus-visible { outline: 2px solid var(--fg); outline-offset: 0.3ch; }
.msg { margin: 0 0 16px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--fg); }
.msg.error { border-color: color-mix(in oklab, var(--error) 30%, transparent); background: color-mix(in oklab, var(--error) 10%, var(--bg)); color: var(--error); }
.msg.ok { border-color: color-mix(in oklab, var(--success) 30%, transparent); background: color-mix(in oklab, var(--success) 8%, var(--bg)); color: var(--fg); }
.secret { display: flex; gap: 8px; align-items: stretch; margin: 0 0 16px; }
.secret input { flex: 1; min-width: 0; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 8px 8px 8px 0; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
th { color: var(--muted); font-size: 13px; font-weight: 400; }
td form { display: inline; }
.meta { color: var(--muted); font-size: 12px; }
form + .meta { margin: 12px 0 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; } }
@media (max-width: 30rem) { table, thead, tbody, tr, th, td { display: block; } thead { display: none; } td { border: 0; padding: 4px 0; } tr { border-bottom: 1px solid var(--border); padding: 8px 0; } }`;

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
<header>
<div class="rail"><p class="brand">pilihpendidikan</p></div>
</header>
<main class="rail">
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
