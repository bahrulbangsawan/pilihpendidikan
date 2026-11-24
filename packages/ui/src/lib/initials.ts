// Initials for letter avatars (EntityAvatar, the UserMenu): up to two
// letters from the first words of a name, falling back to the first letter
// of `fallback` (an email), then "?".

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** "Acme Robotics" → "AR", "stripe" → "S", ("", "rina@x.id") → "R". */
export function initialsOf(
  name: string | null | undefined,
  fallback = ""
): string {
  const words = (name ?? "").match(WORD_RE) ?? [];
  const letters = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase())
    .join("");
  return letters || fallback.charAt(0).toLocaleUpperCase() || "?";
}
