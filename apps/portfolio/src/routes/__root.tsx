import { createRootRoute } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { RootComponent, RootDocument } from "./-root-components";
import { jsonLd } from "./-root-helpers";

const BASE_URL = "https://portfolio.pilihpendidikan.com";

// Apply a saved Night Desk choice before the first paint, matching next-themes
// (`defaultTheme="light"`, `enableSystem={false}`): light unless the visitor
// picked dark with the toggle. The system preference is not consulted.
const themeScript = `(function(){try{var d=document.documentElement,k=localStorage.getItem("theme")==="dark";d.classList.toggle("dark",k);d.style.colorScheme=k?"dark":"light"}catch(_){}})()`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Zedative paper (light is canonical); the builder also offers Night Desk.
      { name: "theme-color", content: "#f4f4f2" },
      { name: "color-scheme", content: "light dark" },
    ],
    scripts: [
      { children: themeScript },
      { type: "application/ld+json", children: JSON.stringify(jsonLd) },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Warm DNS + TLS to the MCP API origin during HTML parse so the first
      // document fetch (loading an existing portfolio via `?id=`) reuses an
      // open connection instead of paying a full cross-origin handshake after
      // hydration. `crossOrigin: "anonymous"` matches the public (no-credential)
      // read; `dns-prefetch` is the universal fallback.
      {
        rel: "preconnect",
        href: "https://api.pilihpendidikan.com",
        crossOrigin: "anonymous",
      },
      { rel: "dns-prefetch", href: "https://api.pilihpendidikan.com" },
      // hreflang tags
      { rel: "alternate", hrefLang: "en", href: BASE_URL },
      { rel: "alternate", hrefLang: "id", href: `${BASE_URL}/id` },
      { rel: "alternate", hrefLang: "x-default", href: BASE_URL },
      // Favicons
      {
        rel: "icon",
        type: "image/x-icon",
        href: "/favicon-active/favicon.ico",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-active/favicon-32x32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-active/favicon-16x16.png",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/favicon-active/apple-touch-icon.png",
      },
      { rel: "manifest", href: "/favicon-active/site.webmanifest" },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});
