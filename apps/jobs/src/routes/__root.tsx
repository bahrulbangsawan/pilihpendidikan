import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/hooks/use-session";
import appCss from "../styles.css?url";
import { RootComponent, RootDocument } from "./-root-components";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Who is signed in and the UI locale (cookie / Accept-Language, D-27).
  // Cached for a minute on the client; never carries the bearer.
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions()
    );
    return { session };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#f4f4f2" },
      { name: "color-scheme", content: "light dark" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "same-origin" },
      { title: "Pilih Jobs" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/x-icon", href: "/favicon/favicon.ico" },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon/favicon-32x32.png",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/favicon/apple-touch-icon.png",
      },
      { rel: "manifest", href: "/favicon/site.webmanifest" },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});
