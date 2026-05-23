import { TooltipProvider } from "@rulisme/ui/ui/tooltip";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";

import appCss from "../styles.css?url";

const LazyAgentation = lazy(() =>
  import("agentation").then((mod) => ({ default: mod.PageFeedbackToolbarCSS }))
);

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

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Bahrul Bangsawan — CV Builder",
  description:
    "Create, preview, and download professional resumes as PDF. Free online CV builder with real-time preview and ATS-friendly formatting.",
  url: "https://cv.bahrul.me",
  applicationCategory: "BusinessApplication",
  operatingSystem: "All",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: {
    "@type": "Person",
    name: "Bahrul Bangsawan",
    url: "https://linkedin.com/in/bahrulbangsawan",
  },
};

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html className="light" lang="en" style={{ colorScheme: "light" }}>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          type="application/ld+json"
        />
      </head>
      <body>
        {children}
        <Scripts />
        {import.meta.env.DEV && (
          <Suspense>
            <LazyAgentation />
          </Suspense>
        )}
      </body>
    </html>
  );
}

const FAVICON_SELECTORS = [
  { selector: 'link[rel="icon"][sizes="32x32"]', file: "favicon-32x32.png" },
  { selector: 'link[rel="icon"][sizes="16x16"]', file: "favicon-16x16.png" },
  {
    selector: 'link[rel="icon"][type="image/x-icon"]',
    file: "favicon.ico",
  },
  { selector: 'link[rel="apple-touch-icon"]', file: "apple-touch-icon.png" },
];

function useFaviconVisibility() {
  useEffect(() => {
    function swapFavicons() {
      const folder = document.hidden ? "favicon-inactive" : "favicon-active";
      for (const { selector, file } of FAVICON_SELECTORS) {
        const link = document.querySelector<HTMLLinkElement>(selector);
        if (link) {
          link.href = `/${folder}/${file}`;
        }
      }
    }

    document.addEventListener("visibilitychange", swapFavicons);
    return () => document.removeEventListener("visibilitychange", swapFavicons);
  }, []);
}

function RootComponent() {
  useFaviconVisibility();
  return (
    <TooltipProvider>
      <Outlet />
    </TooltipProvider>
  );
}
