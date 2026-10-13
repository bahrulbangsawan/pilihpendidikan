// The Worker entry (job-tracker-spec 12 §1): the TanStack Start handler
// behind the edge policy — the Origin gate on server-function POSTs (CSRF,
// 11 §4.1), a per-response CSP nonce handed to the router, noindex and the
// security headers on every dynamic response.
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";
import { applyEdgePolicy } from "@/lib/edge-policy";

const appOrigin: string | undefined = env.JOBS_APP_ORIGIN;

export default createServerEntry({
  fetch: (request, opts) =>
    applyEdgePolicy(request, (forwarded) => handler.fetch(forwarded, opts), {
      appOrigin,
      dev: import.meta.env.DEV,
    }),
});
