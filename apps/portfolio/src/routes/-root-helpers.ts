// Sibling file extracted to satisfy only-export-components:
// jsonLd, FAVICON_SELECTORS, and useFaviconVisibility are not components.

import { useEffect } from "react";

export const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Bahrul Bangsawan — Portfolio Builder",
  description:
    "Create, preview, and download a locked Apple Developer Academy portfolio as PDF. Bilingual portfolio builder with a fixed A4-landscape layout and real-time preview.",
  url: "https://portfolio.bahrul.me",
  applicationCategory: "BusinessApplication",
  operatingSystem: "All",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  inLanguage: ["en", "id"],
  author: {
    "@type": "Person",
    name: "Bahrul Bangsawan",
    url: "https://bahrul.me",
    sameAs: [
      "https://www.linkedin.com/in/bahrulbangsawan",
      "https://github.com/bahrulbangsawan",
    ],
  },
};

export const FAVICON_SELECTORS = [
  { selector: 'link[rel="icon"][sizes="32x32"]', file: "favicon-32x32.png" },
  { selector: 'link[rel="icon"][sizes="16x16"]', file: "favicon-16x16.png" },
  {
    selector: 'link[rel="icon"][type="image/x-icon"]',
    file: "favicon.ico",
  },
  { selector: 'link[rel="apple-touch-icon"]', file: "apple-touch-icon.png" },
];

export function useFaviconVisibility() {
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
