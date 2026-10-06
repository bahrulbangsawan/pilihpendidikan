#!/usr/bin/env bash
# Typography lint — enforces TYPOGRAPHY.md rules across the Warp UI apps.
# Run via `bun run lint:typography`. Exits non-zero on any violation.

set -uo pipefail

if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
else
  ROOT="$(pwd)"
fi
cd "$ROOT" || exit 2

SCOPE=(apps/cv/src apps/invoice/src apps/portfolio/src packages/ui/src)
# Print artifacts are exempt (TYPOGRAPHY.md § Exceptions): the rendered CV,
# invoice and portfolio documents are ink-on-paper "light islands" whose type
# mirrors the @react-pdf output (Helvetica, print sizes and bold weights), not
# Warp editor chrome. The @react-pdf renderers (`*-pdf.tsx`) stay under these
# class checks; only their StyleSheet font props are exempt, in
# check-inline-typography.ts.
PRINT_GLOBS=(
  -g '!**/cv/src/components/templates/*-preview.tsx'
  -g '!**/cv/src/components/templates/preview-entries.tsx'
  -g '!**/invoice/src/components/invoice-preview.tsx'
)
TS_GLOBS=(-g '*.tsx' -g '*.ts' -g '!routeTree.gen.ts' "${PRINT_GLOBS[@]}")

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

printf 'Typography lint — see TYPOGRAPHY.md for rules\n\n'

# 1) Arbitrary font-size — text-[10px], text-[0.625rem], text-[.5rem], text-[-1em]
#    Negative-lookbehind via Rust regex isn't supported, so we use a positive
#    pattern: text-[ followed by digit, dot, or minus (font-size shapes), which
#    skips text-[var(...)] color references.
run_check \
  "No arbitrary font-size (text-[Npx], text-[Nrem], text-[.Nrem])" \
  "use a Warp named token: text-display / text-heading-lg / text-heading / text-heading-sm / text-subheading / text-body / text-body-sm / text-caption-tracked / text-micro (or text-xs for chrome)" \
  rg -n -P 'text-\[(\d|\.|-\d)' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 2) Arbitrary leading
run_check \
  "No arbitrary line-height (leading-[…])" \
  "use a paired or standalone --leading-* token, or Tailwind leading-tight/normal/relaxed/snug" \
  rg -n 'leading-\[' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 3) Arbitrary font-family
run_check \
  "No arbitrary font-family (font-[…])" \
  "use font-sans or font-mono" \
  rg -n -P 'font-\[(?!var\(--font-)' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 4) Arbitrary tracking
run_check \
  "No arbitrary tracking (tracking-[…])" \
  "use a --tracking-* token (display / heading / heading-sm / body / body-sm / caption / eyebrow)" \
  rg -n 'tracking-\[' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 5) Inline style font-* props
run_check \
  "No inline style fontSize / fontFamily / fontWeight" \
  "pass className with a typography token instead (recharts: tick={{ className: 'text-micro' }})" \
  bun scripts/check-inline-typography.ts "${SCOPE[@]}"

# 6) font-bold AND font-semibold — Warp is 400/500 only
run_check \
  "No font-bold / font-semibold (Warp weights are 400/500 only)" \
  "replace with font-medium; if 600/700 is truly needed, add a --font-weight token first" \
  rg -n -P '\bfont-(bold|semibold)\b' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 7) Generic Tailwind text utilities — text-xs is allowed (chrome default)
run_check \
  "No generic text-sm/base/lg/xl/2xl/3xl/4xl/5xl/6xl" \
  "use Warp named tokens: text-sm→text-body-sm, text-base→text-body, text-lg/xl→text-subheading, text-2xl→text-heading-sm, text-3xl→text-heading, text-4xl/5xl→text-heading-lg, text-6xl→text-display. See DESIGN.md." \
  rg -n -P '\btext-(sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b' "${SCOPE[@]}" "${TS_GLOBS[@]}"

# 8) Generic font-normal — prefer the token utility
run_check \
  "No font-normal (use font-regular token)" \
  "replace font-normal with font-regular" \
  rg -n '\bfont-normal\b' "${SCOPE[@]}" "${TS_GLOBS[@]}"

printf '\n'
if [[ $fail -ne 0 ]]; then
  printf '\033[31mTypography lint FAILED.\033[0m See TYPOGRAPHY.md.\n'
  exit 1
fi
printf '\033[32mTypography lint passed.\033[0m\n'
exit 0
