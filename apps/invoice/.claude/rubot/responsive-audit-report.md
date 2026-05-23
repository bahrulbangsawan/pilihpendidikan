# Responsive Audit Report

**Date**: 2026-03-25
**Scope**: Full codebase audit (invoice generator)
**Overall Score**: 57/100

---

## Unit Violation Summary

| Category           | Violations Found | Files Affected                                            |
| ------------------ | ---------------- | --------------------------------------------------------- |
| Font sizes (px)    | 3                | `invoice-preview.tsx`                                     |
| Spacing (px)       | 1                | `tabs.tsx` (UI lib)                                       |
| Dimensions (px)    | 3                | `invoice-preview.tsx`, `date-selector.tsx`                |
| Border radius (px) | 3                | `phone-input.tsx`, `language-switcher.tsx`, `tooltip.tsx` |
| **Total**          | **10**           | **5 files**                                               |

### Font Size Violations

| File                  | Line | Current       | Fix                |
| --------------------- | ---- | ------------- | ------------------ |
| `invoice-preview.tsx` | 105  | `text-[10px]` | `text-[0.625rem]`  |
| `invoice-preview.tsx` | 122  | `text-[10px]` | `text-[0.625rem]`  |
| `invoice-preview.tsx` | 138  | `text-[11px]` | `text-[0.6875rem]` |

### Dimension Violations

| File                  | Line | Current         | Fix                       |
| --------------------- | ---- | --------------- | ------------------------- |
| `invoice-preview.tsx` | 16   | `min-h-[600px]` | `min-h-[37.5rem]`         |
| `date-selector.tsx`   | 1203 | `w-[470px]`     | `w-full sm:w-[29.375rem]` |
| `date-selector.tsx`   | 1273 | `h-[200px]`     | `h-[12.5rem]`             |

### Border Radius Violations

| File                    | Line | Current         | Fix                              |
| ----------------------- | ---- | --------------- | -------------------------------- |
| `phone-input.tsx`       | 215  | `rounded-[5px]` | `rounded-[0.3125rem]`            |
| `language-switcher.tsx` | 85   | `rounded-[1px]` | Acceptable (fine optical detail) |
| `tooltip.tsx`           | 49   | `rounded-[2px]` | Acceptable (fine optical detail) |

---

## Component Audit

### Main Layout (`invoice-generator.tsx`)

- Status: **Pass**
- Uses `min-h-svh` (correct viewport unit)
- `flex-col md:flex-row` mobile-first split layout
- Floating FAB download button on mobile (`md:hidden`)
- Toolbar buttons hide text on mobile (`hidden sm:inline`)
- Touch target on FAB: `size-12 rounded-full` (3rem = 48px)

### Invoice Form (`invoice-form.tsx`)

- Status: **CRITICAL - Failing**
- **Invoice Details** (line 406): `grid-cols-[1fr_auto_1fr_1fr_auto]` — 5 cols, NO mobile breakpoint
- **Line Item Fields** (line 651): `grid-cols-[1fr_3.5rem_auto_auto]` — 4 cols, no mobile stacking
- **Sub-Item Fields** (line 685): `grid-cols-[1fr_3.5rem_auto_auto_auto]` — 5 cols, no mobile stacking
- **Adjustments** (line 756): `grid-cols-[1fr_auto_auto_auto_auto]` — 5 cols, no mobile stacking
- **Custom Fields** (line 832): `grid-cols-[1fr_1fr_auto]` — 3 cols, no mobile stacking
- **From/BillTo** (lines 493, 578): `grid-cols-2` — no `grid-cols-1` mobile base

### Invoice Preview (`invoice-preview.tsx`)

- Status: **Issues (low priority — print-style layout)**
- Uses px font sizes (`text-[10px]`, `text-[11px]`) — should be rem
- `grid-cols-2` sender/recipient (line 54) — no mobile stacking
- `min-h-[600px]` empty state — should be rem
- `w-64` totals section — OK (Tailwind rem value = 16rem)

### Address Fields (`address-fields.tsx`)

- Status: **Pass**
- `grid-cols-2 gap-3 lg:grid-cols-5` — reasonable mobile-first
- Combobox inputs are `w-full` on mobile

### Assistant Modal (`assistant-modal.tsx`)

- Status: **Pass**
- `w-[min(26rem,calc(100vw-2rem))]` — responsive width capping
- `h-[28rem]` — rem-based height
- Fixed bottom-right positioning with adequate touch target

### Mobile Download FAB

- Status: **Pass**
- `size-12` touch target (3rem = 48px) exceeds 2.75rem minimum
- Properly hidden on desktop (`md:hidden`)

---

## Breakpoint Configuration

- **Custom breakpoints**: Not configured — using Tailwind v4 defaults (640, 768, 1024, 1280)
- **Base font size**: Pass — no explicit px override on `html`, inherits browser 100% default
- **use-mobile.ts hook**: Uses 768px breakpoint, consistent with `md:` prefix
- **Viewport units**: `svh` used correctly (accounts for mobile browser chrome)

---

## Scoring Breakdown

| Category            | Weight   | Score      | Details                                                 |
| ------------------- | -------- | ---------- | ------------------------------------------------------- |
| Unit Compliance     | 30%      | 18/30      | 10 px violations (3 fonts, 3 dims, 1 spacing, 3 radius) |
| Mobile Layout       | 25%      | 10/25      | 6 form grids have no mobile breakpoints — critical      |
| Card Consistency    | 10%      | 9/10       | No custom card radius issues                            |
| Breakpoint Behavior | 20%      | 10/20      | Main layout OK, all form sections missing breakpoints   |
| Typography Scaling  | 15%      | 10/15      | Static heading sizes, px fonts in preview               |
| **Total**           | **100%** | **57/100** |                                                         |

---

## Priority Fixes

### 1. CRITICAL: Form grid layouts need mobile breakpoints

**File**: `src/components/invoice-form.tsx`

| Section          | Line | Current                                 | Fix                                                                 |
| ---------------- | ---- | --------------------------------------- | ------------------------------------------------------------------- |
| Invoice Details  | 406  | `grid-cols-[1fr_auto_1fr_1fr_auto]`     | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_1fr_auto]`   |
| From fields      | 493  | `grid-cols-2`                           | `grid-cols-1 sm:grid-cols-2`                                        |
| BillTo fields    | 578  | `grid-cols-2`                           | `grid-cols-1 sm:grid-cols-2`                                        |
| Line item row    | 651  | `grid-cols-[1fr_3.5rem_auto_auto]`      | `grid-cols-2 sm:grid-cols-[1fr_3.5rem_auto_auto]`                   |
| Sub-item row     | 685  | `grid-cols-[1fr_3.5rem_auto_auto_auto]` | `grid-cols-2 sm:grid-cols-[1fr_3.5rem_auto_auto_auto]`              |
| Adjustment row   | 756  | `grid-cols-[1fr_auto_auto_auto_auto]`   | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]` |
| Custom field row | 832  | `grid-cols-[1fr_1fr_auto]`              | `grid-cols-1 sm:grid-cols-[1fr_1fr_auto]`                           |

### 2. HIGH: Convert px units to rem

**Files**: `invoice-preview.tsx`, `date-selector.tsx`

Replace all `px` arbitrary values with `rem` equivalents (divide by 16).

### 3. MEDIUM: Preview sender/recipient stacking

**File**: `invoice-preview.tsx:54`

Change `grid-cols-2 gap-8` to `grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-8`.

### 4. LOW: Border radius px to rem

**File**: `phone-input.tsx:215`

Convert `rounded-[5px]` to `rounded-[0.3125rem]`.
