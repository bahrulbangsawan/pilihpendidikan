import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { NotFoundPage } from "@/components/not-found";
import type { SessionState } from "@/functions/session.functions";
import { NONCE_HEADER } from "@/lib/edge-policy";
import { createQueryClient, queryKeys } from "@/lib/query";
import { routeTree } from "./routeTree.gen";

// The CSP nonce src/server.ts minted for this response; the router stamps it
// on every script it renders. The browser needs none (it never re-renders
// the document's scripts).
const readNonce = createIsomorphicFn()
  .server(() => getRequestHeader(NONCE_HEADER) ?? undefined)
  .client(() => undefined);

export function getRouter() {
  const queryClient = createQueryClient();
  const nonce = readNonce();
  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
    defaultNotFoundComponent: NotFoundPage,
    // The server renders the signed-in shell from the session the root
    // beforeLoad loaded; hand that same state (signed in, email, locale —
    // never the bearer) to the browser's fresh QueryClient so its first
    // render matches the HTML (no hydration mismatch, no flash of sign-in).
    dehydrate: () => ({
      session:
        queryClient.getQueryData<SessionState>(queryKeys.session) ?? null,
    }),
    hydrate: (dehydrated: { session: SessionState | null }) => {
      if (dehydrated.session) {
        queryClient.setQueryData(queryKeys.session, dehydrated.session);
      }
    },
    ...(nonce ? { ssr: { nonce } } : {}),
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
