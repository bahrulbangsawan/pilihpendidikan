/**
 * The Zedative type scale (DESIGN.md § Typography): one family, six roles,
 * each at a default and a compact step. Compact is for dense regions
 * (toolbars, filter bars, sidebars). The utilities live in
 * `@rulisme/ui/styles/theme.css`; every class is spelled out here so
 * Tailwind's scanner finds it.
 */

export const TYPE_ROLES = [
  "display",
  "title",
  "subtitle",
  "body",
  "caption",
  "micro",
] as const;

export type TypeRole = (typeof TYPE_ROLES)[number];
export type TypeVariant = "default" | "compact";

const TYPE_CLASS: Record<TypeRole, Record<TypeVariant, string>> = {
  display: { default: "type-display", compact: "type-display-compact" },
  title: { default: "type-title", compact: "type-title-compact" },
  subtitle: { default: "type-subtitle", compact: "type-subtitle-compact" },
  body: { default: "type-body", compact: "type-body-compact" },
  caption: { default: "type-caption", compact: "type-caption-compact" },
  micro: { default: "type-micro", compact: "type-micro-compact" },
};

/** Every `type-*` utility name without its prefix, for tailwind-merge. */
export const TYPE_UTILITIES = TYPE_ROLES.flatMap((role) => [
  role,
  `${role}-compact`,
]);

/** The three weights, each paired with an optical size. */
export const TYPE_WEIGHTS = ["normal", "semibold", "bold"] as const;

/** The utility class for a role, e.g. `typeClass("body", "compact")`. */
export function typeClass(
  role: TypeRole,
  variant: TypeVariant = "default"
): string {
  return TYPE_CLASS[role][variant];
}
