import { createRootRoute } from "@tanstack/react-router";
import { SERVICES } from "@/config/services";
import { BASE_URL } from "@/i18n";
import { buildJsonLd } from "@/lib/discovery";
import appCss from "../styles.css?url";
import { RootComponent, RootDocument } from "./-root-components";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#f4f4f2" },
      { name: "color-scheme", content: "light" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(buildJsonLd(SERVICES)),
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // hreflang tags
      { rel: "alternate", hrefLang: "en", href: BASE_URL },
      { rel: "alternate", hrefLang: "id", href: `${BASE_URL}/id` },
      { rel: "alternate", hrefLang: "x-default", href: BASE_URL },
      // Favicons
      { rel: "icon", type: "image/x-icon", href: "/favicon/favicon.ico" },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon/favicon-32x32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon/favicon-16x16.png",
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
