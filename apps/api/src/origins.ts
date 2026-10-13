// Every host this Worker talks about, in one place: the app origins
// (production and their local dev ports), the API's own public origin, and
// the trust policy for `X-Forwarded-Host`.
//
// `jobs` (the Job Tracker dashboard, 05 §1.8) calls the API server-to-server
// through its BFF, but its origin is still needed here: the magic-link
// `returnTo` allowlist (sign-in.ts) and credentialed CORS read this table.

export type DocumentKind = "cv" | "invoice" | "portfolio" | "jobs";

export const API_ORIGIN = "https://api.pilihpendidikan.com";

export const APP_ORIGINS: Readonly<Record<DocumentKind, string>> = {
  cv: "https://cv.pilihpendidikan.com",
  invoice: "https://invoice.pilihpendidikan.com",
  portfolio: "https://portfolio.pilihpendidikan.com",
  jobs: "https://jobs.pilihpendidikan.com",
};

// `bun dev` ports for apps/cv, apps/invoice, apps/portfolio and apps/jobs.
export const DEV_APP_ORIGINS: Readonly<Record<DocumentKind, string>> = {
  cv: "http://localhost:4003",
  invoice: "http://localhost:4004",
  portfolio: "http://localhost:4005",
  jobs: "http://localhost:4007",
};

// `wrangler dev` serves on localhost (wrangler.jsonc `dev.host` keeps the
// request URL on localhost instead of the route's host). Decided by hostname
// only: a plain-http request that reaches production is NOT local — app.ts
// upgrades it to https instead.
export function isLocalRequest(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  );
}

// The app a PDF / edit link should open: the local Vite server when this
// Worker runs under `wrangler dev`, the production host otherwise.
export function appOrigin(kind: DocumentKind, url: URL): string {
  return isLocalRequest(url) ? DEV_APP_ORIGINS[kind] : APP_ORIGINS[kind];
}

const LOCAL_HOSTNAMES: Record<string, true> = {
  localhost: true,
  "127.0.0.1": true,
};

// Public origin of this Worker for links it emails and metadata it publishes.
// In production that is always the request's own origin (the custom domain);
// `X-Forwarded-Host` is honoured only under local dev, and only for a
// localhost host, so a forged header can never point an emailed sign-in link
// or the OAuth issuer at another host.
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  if (!isLocalRequest(url)) {
    return url.origin;
  }
  const host = request.headers.get("x-forwarded-host");
  const hostname = host?.split(":", 1)[0].toLowerCase() ?? "";
  if (host && Object.hasOwn(LOCAL_HOSTNAMES, hostname)) {
    return `http://${host}`;
  }
  return url.origin;
}
