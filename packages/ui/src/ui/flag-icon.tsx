import { cn } from "../lib/utils";

// Flag icons for the locales the apps ship (English, Bahasa Indonesia): a
// 2:1 SVG at 20 × 12px with 2px corners, in its real colours (a third-party
// mark, TYPOGRAPHY.md § Exceptions). `label` names it for screen readers;
// leave it out when the language name sits beside it.

type FlagCode = "gb" | "id";

function FlagIcon({
  code,
  label,
  className,
}: {
  code: FlagCode;
  label?: string;
  className?: string;
}) {
  const a11y = label
    ? { "aria-label": label, role: "img" as const }
    : { "aria-hidden": true as const };
  const classes = cn("h-3 w-5 shrink-0 rounded-xs", className);
  if (code === "id") {
    return (
      <svg
        className={classes}
        data-slot="flag-icon"
        viewBox="0 0 60 30"
        xmlns="http://www.w3.org/2000/svg"
        {...a11y}
      >
        <rect fill="#CE1126" height="15" width="60" />
        <rect fill="#fff" height="15" width="60" y="15" />
      </svg>
    );
  }
  return (
    <svg
      className={classes}
      data-slot="flag-icon"
      viewBox="0 0 60 30"
      xmlns="http://www.w3.org/2000/svg"
      {...a11y}
    >
      <clipPath id="flag-gb-clip">
        <rect height="30" width="60" />
      </clipPath>
      <g clipPath="url(#flag-gb-clip)">
        <rect fill="#012169" height="30" width="60" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

export { FlagIcon };
export type { FlagCode };
