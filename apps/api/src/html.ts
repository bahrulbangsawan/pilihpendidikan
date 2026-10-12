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

// Zedative (the workspace's design system, DESIGN.md), rebuilt as plain CSS:
// the strict CSP allows inline styles only, so there are no web fonts (Inter
// renders when it is installed, else the system UI face) and no paper-grain
// image. Warm paper ruled by graph paper, a band header with a diamond
// wordmark, a ruled column with diamond nodes, square bordered cards, lipped
// buttons, one cobalt.
const PAGE_STYLES = `
:root { color-scheme: light; --bg: #f4f4f2; --bg-2: #fafafa; --fg: #000000; --ink: #393d45; --muted: #5a6170; --offgray: #727a89; --line: #cbcfd4; --border: #dadde2; --pane: #ebebec; --primary: #1348dc; --primary-deep: #053794; --on-primary: #ffffff; --error: #b42318; --node: 7px; --grid: 16px; --gridline: color-mix(in srgb, var(--offgray) 6%, transparent); --lip: inset 0 -2px 0 0 color-mix(in srgb, var(--offgray) 12%, transparent); --ease: cubic-bezier(0.4, 0, 0.2, 1); }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; min-height: 100vh; background-color: var(--bg); background-image: linear-gradient(to right, var(--gridline) 1px, transparent 1px), linear-gradient(to bottom, var(--gridline) 1px, transparent 1px); background-size: var(--grid) var(--grid); color: var(--ink); font: 400 13px/20px "Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-variation-settings: "opsz" 14; -webkit-font-smoothing: antialiased; }
.band { position: relative; border-bottom: 1px solid var(--line); background: var(--bg); }
.rail { position: relative; width: calc(100% - 24px); max-width: 44rem; margin: 0 auto; border-inline: 1px solid var(--line); background: var(--bg); }
.rail::before, .rail::after { content: ""; position: absolute; z-index: 3; top: calc(var(--node) / -2 - 0.5px); width: var(--node); height: var(--node); border: 1px solid var(--line); background: var(--bg-2); transform: rotate(45deg); }
.rail::before { left: calc(var(--node) / -2 - 0.5px); }
.rail::after { right: calc(var(--node) / -2 - 0.5px); }
header .rail { display: flex; align-items: center; height: 56px; padding: 0 24px; }
header .rail::before, header .rail::after { display: none; }
.brand { display: inline-flex; align-items: center; gap: 8px; margin: 0; color: var(--fg); font-size: 16px; line-height: 22px; font-weight: 550; font-variation-settings: "opsz" 18; }
.mark { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 2px; background: var(--primary); }
.mark span { width: 8px; height: 8px; border: 1px solid var(--on-primary); transform: rotate(45deg); }
main.rail { padding: 48px 24px 64px; }
h1 { margin: 0 0 12px; color: var(--primary); font-size: 28px; line-height: 34px; font-style: italic; font-weight: 700; font-variation-settings: "opsz" 25; }
h2 { margin: 0 0 12px; color: var(--fg); font-size: 16px; line-height: 22px; font-weight: 550; font-variation-settings: "opsz" 18; }
p { margin: 0 0 16px; color: var(--ink); }
main > p:first-of-type { font-size: 14px; line-height: 20px; }
a { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; transition: opacity 150ms var(--ease); }
a:hover { opacity: 0.8; }
strong { color: var(--fg); font-weight: 550; font-variation-settings: "opsz" 18; }
code { padding: 1px 4px; border-radius: 2px; background: var(--pane); color: var(--fg); font: inherit; font-size: 12px; line-height: 16px; overflow-wrap: anywhere; }
section.card { margin: 0 0 24px; padding: 20px; border: 1px solid var(--border); border-radius: 0; background: var(--bg-2); }
section.card > :last-child { margin-bottom: 0; }
label { display: block; margin: 0 0 6px; color: var(--fg); }
input[type=email], input[type=text], select { width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 4px; background: color-mix(in srgb, var(--bg-2) 60%, transparent); color: var(--fg); font: inherit; outline: none; transition: border-color 150ms var(--ease), box-shadow 150ms var(--ease); }
input::placeholder { color: var(--muted); }
input:focus-visible, select:focus-visible { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 20%, transparent); }
@media (pointer: coarse) { input[type=email], input[type=text], select { font-size: 16px; } }
.field { margin: 0 0 16px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 12px; border: 1px solid transparent; border-radius: 4px; background: var(--primary); color: var(--on-primary); font: inherit; white-space: nowrap; cursor: pointer; box-shadow: inset 0 -2px 0 0 var(--primary-deep), 0 1px 3px 0 color-mix(in srgb, var(--primary) 12%, transparent); transition: background-color 150ms var(--ease), box-shadow 150ms var(--ease), border-color 150ms var(--ease); }
button:hover { box-shadow: none; }
button:active { transform: translateY(1px) scale(0.99); }
button.secondary { border-color: color-mix(in srgb, var(--border) 60%, transparent); background: color-mix(in srgb, var(--bg-2) 60%, transparent); color: var(--fg); box-shadow: var(--lip); }
button.secondary:hover { background: color-mix(in srgb, var(--pane) 70%, transparent); box-shadow: none; }
button.danger { border-color: color-mix(in srgb, var(--error) 25%, transparent); background: color-mix(in srgb, var(--error) 10%, transparent); color: var(--error); box-shadow: var(--lip); }
button.danger:hover { background: color-mix(in srgb, var(--error) 15%, transparent); box-shadow: none; }
:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
input:focus-visible, select:focus-visible { outline: none; }
.msg { margin: 0 0 16px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 0; background: var(--bg-2); color: var(--fg); }
.msg.error { border-color: color-mix(in srgb, var(--error) 30%, transparent); background: color-mix(in srgb, var(--error) 5%, var(--bg-2)); color: var(--error); }
.msg.ok { border-color: color-mix(in srgb, var(--primary) 30%, transparent); background: color-mix(in srgb, var(--primary) 7%, var(--bg-2)); color: var(--fg); }
.secret { display: flex; gap: 8px; align-items: stretch; margin: 0 0 16px; }
.secret input { flex: 1; min-width: 0; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 8px 8px 8px 0; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { color: var(--muted); font-size: 12px; line-height: 16px; font-weight: 400; }
td form { display: inline; }
.meta { color: var(--muted); font-size: 12px; line-height: 16px; }
form + .meta { margin: 12px 0 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; } button:active { transform: none; } }
@media (max-width: 30rem) { table, thead, tbody, tr, th, td { display: block; } thead { display: none; } td { border: 0; padding: 4px 0; } tr { border-bottom: 1px solid var(--line); padding: 8px 0; } }`;

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
<header class="band">
<div class="rail"><p class="brand"><span class="mark" aria-hidden="true"><span></span></span>pilihpendidikan</p></div>
</header>
<div class="band">
<main class="rail">
${options.body}
</main>
</div>${script}
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
