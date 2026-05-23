# Responsive Audit Report

**Date**: 2026-03-24
**Scope**: Full codebase audit
**Priority**: All breakpoints equally
**Overall Score**: 78/100

## Unit Violation Summary

| Category | Violations Found | Files Affected |
|----------|-----------------|----------------|
| Font sizes (px) | 7 | cv-form.tsx, thread.tsx |
| Spacing (px) | 0 | -- |
| Dimensions (px) | 1 | switch.tsx (shadcn) |
| Card radius (px) | 2 | phone-input.tsx, tooltip.tsx (shadcn) |
| **Total** | **10** | **4 files** |

### Font Size Violations Detail

All 7 violations are `text-[10px]` (should be `text-[0.625rem]`):

| File | Line | Context |
|------|------|---------|
| `src/components/cv-form.tsx` | 940 | Experience duration label |
| `src/components/cv-form.tsx` | 1124 | Education duration label |
| `src/components/cv-form.tsx` | 1415 | Certificate expiry warning |
| `src/components/cv-form.tsx` | 1421 | Certificate duration label |
| `src/components/cv-form.tsx` | 1605 | Volunteer duration label |
| `src/components/assistant-ui/thread.tsx` | 199 | Suggestion description |
| `src/components/assistant-ui/thread.tsx` | 367 | Thread metadata |

### Border Radius Violations Detail

| File | Line | Value | Context |
|------|------|-------|---------|
| `src/components/reui/phone-input.tsx` | 215 | `rounded-[5px]` | Flag icon container |
| `src/components/ui/tooltip.tsx` | 49 | `rounded-[2px]` | Tooltip arrow |

Both are shadcn/ui library components — low priority.

## Component Audit

### Main Layout (index.tsx)
- Status: **Pass**
- Uses `min-h-svh` for outer container
- `flex-col md:flex-row` — correct mobile-first pattern
- Both panels use `h-svh` with `overflow-y-auto` — proper scrolling
- Floating download FAB with `fixed bottom-6 left-6 z-50 md:hidden` — correct

### Toolbar Buttons
- Status: **Warning**
- "Import JSON" and "Pre-Fill Example" show full text on all screen sizes
- On very narrow phones (<360px), these could crowd the toolbar
- Recommendation: Consider icon-only on xs, text on sm+

### Grid Layouts
- Status: **Warning** (1 issue)
- `cv-form.tsx:1038` — `grid-cols-2` **without responsive prefix** forces 2 columns on mobile
- All other grids correctly use `sm:grid-cols-2`, `sm:grid-cols-3` pattern

### Cards
- Status: **Pass**
- Card component uses `rounded-lg` with `overflow-hidden` (shadcn default)
- Consistent across all instances
- Note: Not using `rounded-[10%]` pattern but consistent within project

### Assistant Modal
- Status: **Pass**
- Uses `rem` for dimensions: `h-[28rem] w-[26rem]`
- Fixed positioning: `right-4 bottom-4`
- Has close affordance via ChevronDown icon
- Note: Modal width (26rem = 416px) could overflow on phones <420px wide

### CV Preview
- Status: **Pass**
- `.cv-page` uses `max-width: 42rem`, `padding: 2rem 3rem` — all rem
- Preview templates render inside scrollable container

### Typography
- Status: **Pass**
- Uses Tailwind text classes throughout (rem-based)
- Body text uses `text-sm`, `text-xs` — appropriate for form UI
- No responsive heading scale needed (single-page app builder)

## Breakpoint Configuration

- Custom breakpoints: **Not configured** — using Tailwind v4 defaults (640, 768, 1024, 1280)
- Using `@import "tailwindcss"` with v4 CSS-first config
- Base font size: **100% (default)** — no override on `html`

## Viewport Height Usage

| File | Class | Assessment |
|------|-------|------------|
| `index.tsx:225` | `min-h-svh` | Correct (dynamic small viewport) |
| `index.tsx:227` | `h-svh` | Correct |
| `index.tsx:257` | `h-svh` | Correct |

Using `svh` instead of `screen` — accounts for mobile browser chrome.

## Scoring Breakdown

| Category | Weight | Score | Details |
|----------|--------|-------|---------|
| Unit Compliance | 30% | 22/30 | 7x `text-[10px]` violations, 2 shadcn radius violations |
| Mobile Layout | 25% | 20/25 | 1 non-responsive grid, toolbar could overflow on xs |
| Card Consistency | 10% | 8/10 | Consistent `rounded-lg`, not `10%` but project-consistent |
| Breakpoint Behavior | 20% | 17/20 | Good mobile-first patterns, default breakpoints |
| Typography Scaling | 15% | 11/15 | All rem via Tailwind, no responsive heading scale |
| **Total** | **100%** | **78/100** | |

## Priority Fixes

1. **High**: Convert 7x `text-[10px]` to `text-[0.625rem]` in cv-form.tsx and thread.tsx
2. **High**: Add responsive prefix to `grid-cols-2` at cv-form.tsx:1038 → `grid-cols-1 sm:grid-cols-2`
3. **Medium**: Consider icon-only toolbar buttons on mobile (<sm) for Import/Pre-Fill
4. **Low**: Assistant modal width (26rem) may overflow on phones <420px — consider `w-[min(26rem,calc(100vw-2rem))]`
5. **Low**: Customize Tailwind breakpoints to match 576/768/992/1200 system (optional)
