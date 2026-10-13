// Links from untrusted text (postings, notes, interview locations) are
// rendered only for http(s) and mailto (11 §4.1); anything else — including
// `javascript:`, `data:` and relative paths — stays inert text.

const ALLOWED_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

/** The normalised href when `raw` is an absolute allowed URL, else null. */
export function safeHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return null;
  }
  if (url.username || url.password) {
    return null;
  }
  return url.href;
}

/** Display text for a URL: the host and path, without the scheme. */
export function displayUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol === "mailto:") {
      return url.pathname;
    }
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.host}${path}`;
  } catch {
    return href;
  }
}
