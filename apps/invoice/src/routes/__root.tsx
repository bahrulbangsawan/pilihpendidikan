import { createRootRoute } from "@tanstack/react-router";
import { jsonLd } from "@/routes/-root-helpers";
import { RootComponent, RootDocument } from "@/routes/-root-shell";
import appCss from "../styles.css?url";

const BASE_URL = "https://invoice.pilihpendidikan.com";

// Runs in the document head before paint, matching next-themes in
// `-root-shell.tsx`: light by default (Zedative's canonical scheme), Night
// Desk only when the visitor chose it with the toggle. The system theme is
// not followed.
const themeScript = `(function(){try{var d=document.documentElement,k=localStorage.getItem("theme")==="dark";d.classList.toggle("dark",k);d.style.colorScheme=k?"dark":"light"}catch(_){}})()`;

export const Route = createRootRoute({
  head: () => ({
    scripts: [
      { children: themeScript, suppressHydrationWarning: true },
      { type: "application/ld+json", children: JSON.stringify(jsonLd) },
    ],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#f4f4f2" },
      { name: "color-scheme", content: "light dark" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
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
