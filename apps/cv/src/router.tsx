import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { NotFoundPage } from "@/components/not-found";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,

    scrollRestoration: true,
    // Hover/focus/touchstart warms the destination's code chunk before the
    // click. These routes have no loaders, so 30s keeps a preloaded match from
    // being rebuilt on the click that follows.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
    // Path changes cross-fade the page (`route-view` in
    // @bahrul/config/motion.css); the first load and search/hash-only
    // changes swap instantly.
    defaultViewTransition: {
      types: ({ fromLocation, pathChanged }) =>
        fromLocation && pathChanged ? ["route"] : false,
    },
    // Unknown URLs render NotFoundPage (also thrown by the `/$` catch-all).
    defaultNotFoundComponent: NotFoundPage,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
