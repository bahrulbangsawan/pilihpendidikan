#!/usr/bin/env bash
# Zedative style lint — enforces TYPOGRAPHY.md (and the DESIGN.md Don'ts it
# encodes) across every UI root. Run via `bun run lint:typography`. Exits
# non-zero on any violation.

set -uo pipefail

if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
else
  ROOT="$(pwd)"
fi
cd "$ROOT" || exit 2

SCOPE=()
for dir in apps/home/src apps/cv/src apps/invoice/src apps/portfolio/src apps/design/src packages/ui/src; do
  [[ -d "$dir" ]] && SCOPE+=("$dir")
done

# Print documents (TYPOGRAPHY.md § Exceptions): the on-screen CV and invoice
# pages mirror their @react-pdf twins, so they keep print sizes, line heights
# and the static Inter weights the PDF embeds. Only the size, leading and
# weight checks skip them; every other rule — one family, no uppercase, no
# letter-spacing, tokens instead of hex, no Warp — applies to them too. The
# PDF StyleSheets are checked by rules 17 and 18 below.
PRINT_GLOBS=(
  -g '!**/cv/src/components/templates/*-preview.tsx'
  -g '!**/cv/src/components/templates/preview-entries.tsx'
  -g '!**/invoice/src/components/invoice-preview.tsx'
)
TS_GLOBS=(-g '*.tsx' -g '*.ts' -g '!routeTree.gen.ts' -g '!*.test.ts' -g '!*.test.tsx')
# Size, leading and weight checks only: print documents keep print metrics.
SIZE_GLOBS=("${TS_GLOBS[@]}" "${PRINT_GLOBS[@]}")
# Syntax colours may only appear inside an editor mock or the design system
# page (DESIGN.md: "Don't let syntax colours leak out of the editor").
SYNTAX_GLOBS=("${TS_GLOBS[@]}" -g '!*editor-mock*' -g '!apps/design/src/**')

fail=0

run_check() {
  local label="$1"
  local hint="$2"
  shift 2
  local output
  local status
  output="$("$@" 2>&1)"
  status=$?
  if [[ -n "$output" || $status -gt 1 ]]; then
    fail=1
    printf '\n\033[31m✗ %s\033[0m\n' "$label"
    printf '  fix: %s\n' "$hint"
    if [[ -z "$output" ]]; then
      output="Checker exited with status $status"
    fi
    printf '%s\n' "$output" | sed 's/^/    /'
  else
    printf '\033[32m✓ %s\033[0m\n' "$label"
  fi
}

printf 'Zedative style lint — see TYPOGRAPHY.md for rules\n\n'

# 1) Generic Tailwind sizes. Zedative has six roles and nothing else.
run_check \
  "No generic text sizes (text-xs … text-9xl)" \
  "use a role: type-display / type-title / type-subtitle / type-body / type-caption / type-micro (or a -compact step)" \
  rg -n -P '(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])' "${SCOPE[@]}" "${SIZE_GLOBS[@]}"

# 2) Warp size tokens no longer exist; Tailwind would silently drop them.
run_check \
  "No Warp size tokens (text-body-sm, text-heading, text-micro …)" \
  "the Warp scale is gone; use the matching type-* role (TYPOGRAPHY.md)" \
  rg -n -P '(?<![\w-])text-(display|heading-lg|heading-sm|heading|subheading|body-sm|body|caption-tracked|micro)(?![\w-])' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 3) Arbitrary font-size — text-[10px], text-[0.625rem], text-[.5rem].
run_check \
  "No arbitrary font-size (text-[Npx], text-[Nrem])" \
  "use a type-* role" \
  rg -n -P 'text-\[(\d|\.|-\d)' "${SCOPE[@]}" "${SIZE_GLOBS[@]}"

# 4) Line height is baked into every role.
run_check \
  "No leading-* (line height comes from the role)" \
  "drop it; the type-* role sets a whole-pixel line height" \
  rg -n -P '(?<![\w-])leading-(\[|none|tight|snug|normal|relaxed|loose|\d)' "${SCOPE[@]}" "${SIZE_GLOBS[@]}"

# 5) No letter-spacing.
run_check \
  "No tracking-* (no letter-spacing)" \
  "drop it; hierarchy comes from size and weight" \
  rg -n -P '(?<![\w-])tracking-' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 6) No uppercase, in chrome and in print documents alike.
run_check \
  "No uppercase / capitalize" \
  "write the copy in sentence case" \
  rg -n -P '(?<![\w-])(uppercase|capitalize)(?![\w(-])' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 7) Three weights, paired with optical size, through weight-* only.
run_check \
  "No font-<weight> utilities (font-medium, font-semibold, font-bold …)" \
  "use the role's weight, or weight-normal / weight-semibold / weight-bold" \
  rg -n -P '(?<![\w-])font-(thin|extralight|light|normal|regular|medium|semibold|bold|extrabold|black)(?![\w-])' "${SCOPE[@]}" "${SIZE_GLOBS[@]}"

# 8) Arbitrary font-family.
run_check \
  "No arbitrary font-family (font-[…])" \
  "there is one family; drop it or use font-sans" \
  rg -n -P 'font-\[(?!var\(--font-)' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 9) Inline style font-* props.
run_check \
  "No inline style fontSize / fontFamily / fontWeight" \
  "pass className with a type-* role instead (recharts: tick={{ className: 'type-micro' }})" \
  bun scripts/check-inline-typography.ts "${SCOPE[@]}"

# 10) Cards and sections are square; only chips, controls and windows round.
run_check \
  "No rounded-xl and up" \
  "rounded-none (cards, sections) · rounded-sm 2px (chips) · rounded-md 4px (controls) · rounded-lg 6px (windows)" \
  rg -n -P '(?<![\w-])rounded(-[trblse]{1,2})?-(xl|[2-4]xl)(?![\w-])' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 11) No gradients, glows or glass.
run_check \
  "No gradients or glass (bg-gradient-*, bg-linear-*, backdrop-blur …)" \
  "use a flat token fill; graph-paper is the only ruled background" \
  rg -n -P '(?<![\w-])(bg-(gradient|linear|radial|conic)-|backdrop-blur)' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 12) Raw hex colours in classes.
run_check \
  "No hex colours in classes (bg-[#…], text-[#…])" \
  "use a token (DESIGN.md § Implementation › Token map)" \
  rg -n -P -e '-\[#[0-9a-fA-F]{3,8}\]' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 13) Nothing enters: no overlay or mount animations.
run_check \
  "No enter / exit animations (animate-in, fade-in-*, zoom-in-*, animate-pulse …)" \
  "remove it; overlays open instantly and nothing fades in (DESIGN.md § Motion)" \
  rg -n -P '(?<![\w-])(animate-(in|out|pulse|bounce|ping|accordion-(up|down)|collapsible-(up|down))(?![\w-])|(fade|zoom|slide)-(in|out)(?![\w])|(fade|zoom|slide)-(in|out)-)' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 14) Syntax colours live only inside the editor mock.
run_check \
  "No syntax colours outside an editor mock (text-syn-*, bg-syn-* …)" \
  "keep syn-1..4 inside *editor-mock*.tsx; elsewhere use text-primary or text-muted-foreground" \
  rg -n -P '(?<![\w-])(text|bg|border|fill|stroke|decoration|outline|ring)-syn-[1-4](?![\w-])' "${SCOPE[@]}" "${SYNTAX_GLOBS[@]}"

# 15) Warp palette classes no longer exist.
run_check \
  "No Warp palette classes (bg-deep-ember, text-gold-leaf …)" \
  "use the Zedative tokens (DESIGN.md § Implementation › Token map)" \
  rg -n -P '(?<![\w-])(bg|text|border|ring|fill|stroke|outline|decoration)-(warm-off-white|bone-gray|pale-stone|faint-linen|smoke-charcoal|iron-veil|slate-hearth|deep-ember|smoked-onyx|absolute|ink-black|gold-leaf|muted-cobalt|surface-(canvas|banded|card|control|floating))(?![\w-])' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 16) Semantic tokens already switch with the theme.
run_check \
  "No manual dark: colour overrides" \
  "use a semantic token; .dark (Night Desk) swaps every value" \
  rg -n -P '(?<![\w-])dark:(\S+:)?(bg|text|border|ring|fill|stroke|outline|shadow|from|to|via)-' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 17) Print documents use the one family too: Inter, the shared print cuts
#     (packages/ui/src/print/pdf-fonts.ts) in every PDF and --font-sans on the
#     on-screen paper. Catches a non-Inter family in a StyleSheet (also inside
#     a fallback list), in a Font.register call, a built-in PDF font named
#     anywhere in a PDF module, and a literal family in print CSS.
run_check \
  "One family in print documents (Inter only)" \
  "PDF StyleSheets: fontFamily PDF_FONT_FAMILY (the shared print family); print CSS: the --font-sans stack" \
  rg -n -P -i '(fontFamily:\s*\[?\s*"(?!Inter")|\bfamily:\s*"(?!Inter")|(?-i:"(Helvetica|Times|Courier)(-[A-Za-z]+)?")|font-family:[^;]*(helvetica|arial|times|georgia|menlo|courier))' apps packages/ui/src/print --glob '*-pdf.tsx' --glob '*pdf*.ts' --glob 'apps/*/src/styles.css' --glob '!**/node_modules/**' --glob '!*.test.ts'

# 18) …and no uppercase or letter-spacing on paper either (the on-screen
#     previews are held to that by the uppercase and tracking checks above).
run_check \
  "No uppercase or letter-spacing in print documents" \
  "drop textTransform / letterSpacing (PDF) and text-transform / letter-spacing (print CSS)" \
  rg -n -P -i '(textTransform:\s*"uppercase"|letterSpacing:|text-transform:\s*uppercase|letter-spacing:)' apps packages/ui/src/print --glob '*-pdf.tsx' --glob '*pdf*.ts' --glob 'apps/*/src/styles.css' --glob '!**/node_modules/**' --glob '!*.test.ts'

printf '\n'
if [[ $fail -ne 0 ]]; then
  printf '\033[31mZedative style lint FAILED.\033[0m See TYPOGRAPHY.md.\n'
  exit 1
fi
printf '\033[32mZedative style lint passed.\033[0m\n'
exit 0
