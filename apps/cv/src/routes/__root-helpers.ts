// Sibling file extracted to satisfy only-export-components:
// jsonLd, FAVICON_SELECTORS, and useFaviconVisibility are not components.

import { useEffect } from "react"

export const jsonLd = {
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
}

export const FAVICON_SELECTORS = [
  { selector: 'link[rel="icon"][sizes="32x32"]', file: "favicon-32x32.png" },
  { selector: 'link[rel="icon"][sizes="16x16"]', file: "favicon-16x16.png" },
  {
    selector: 'link[rel="icon"][type="image/x-icon"]',
    file: "favicon.ico",
  },
  { selector: 'link[rel="apple-touch-icon"]', file: "apple-touch-icon.png" },
]

export function useFaviconVisibility() {
  useEffect(() => {
    function swapFavicons() {
      const folder = document.hidden ? "favicon-inactive" : "favicon-active"
      for (const { selector, file } of FAVICON_SELECTORS) {
        const link = document.querySelector<HTMLLinkElement>(selector)
        if (link) {
          link.href = `/${folder}/${file}`
        }
      }
    }

    document.addEventListener("visibilitychange", swapFavicons)
    return () => document.removeEventListener("visibilitychange", swapFavicons)
  }, [])
}
