import { createRootRoute } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { RootComponent, RootDocument } from "./__root.components";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Bahrul Bangsawan — CV Builder & Resume Generator" },
      {
        name: "description",
        content:
          "Create, preview, and download professional resumes as PDF. Free online CV builder by Bahrul Bangsawan with real-time preview and ATS-friendly formatting.",
      },
      // Open Graph
      {
        property: "og:title",
        content: "Bahrul Bangsawan — CV Builder & Resume Generator",
      },
      {
        property: "og:description",
        content:
          "Create, preview, and download professional resumes as PDF. Free online CV builder with real-time preview.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://cv.bahrul.me" },
      {
        property: "og:image",
        content: "https://cv.bahrul.me/og-image.png",
      },
      { name: "theme-color", content: "#ffffff" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "Bahrul Bangsawan — CV Builder & Resume Generator",
      },
      {
        name: "twitter:description",
        content:
          "Create, preview, and download professional resumes as PDF. Free online CV builder with real-time preview.",
      },
      {
        name: "twitter:image",
        content: "https://cv.bahrul.me/og-image.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: "https://cv.bahrul.me" },
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
