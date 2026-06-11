const DEFAULT_OG_ORIGIN = "https://og.bahrul.me"

export const OG_ORIGIN: string =
  (import.meta.env?.VITE_OG_ORIGIN as string | undefined) ?? DEFAULT_OG_ORIGIN

export type OgTheme = "dark" | "light"

export interface BuildOgUrlOptions {
  title: string
  subtitle: string
  theme?: OgTheme
  // Stored D1 template id (see apps/mcp-ui/src/lib/og-builtins/). When
  // absent, the worker falls back to the default `renderOg` renderer
  // tuned to look good both at full social-share size and when downscaled
  // into in-page card thumbnails.
  template?: string
}

export function buildOgUrl({
  title,
  subtitle,
  theme = "dark",
  template,
}: BuildOgUrlOptions): string {
  const params = new URLSearchParams({ title, subtitle, theme })
  if (template) {
    params.set("id", template)
  }
  return `${OG_ORIGIN}/?${params.toString()}`
}
