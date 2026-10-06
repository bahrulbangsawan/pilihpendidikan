# QA Test Report: Line Items Section and Period Picker

**Date:** 2026-03-25
**URL:** http://localhost:5004/
**Component:** Invoice Form - Line Items Section

---

## Test Summary

| #   | Test                          | Result                    |
| --- | ----------------------------- | ------------------------- |
| 1   | Line Items fields on same row | PASS                      |
| 2   | Period picker popover opens   | PASS                      |
| 3   | Date range selection works    | FAIL                      |
| 4   | Console errors                | FAIL (critical bug found) |

---

## Test 1: Line Items Layout (PASS)

**Scenario:** Check that Period, Qty, Unit Price, and Amount fields appear on the same row.

**Steps:**

1. Opened http://localhost:5004/
2. Clicked "Add Item" in the Line Items section
3. Expanded "Item 1"
4. Inspected the layout

**Result:** The fields are arranged correctly in a single row using CSS Grid:

- Layout uses `grid grid-cols-[1fr_auto_auto_auto] items-end gap-3`
- **Period** (1fr - flexible width) | **Qty** (auto) | **Unit Price** (auto) | **Amount** (auto, disabled)
- Description field is above on its own full-width row

**Screenshot:** `line-items-form.png`

---

## Test 2: Period Picker Popover Opens (PASS)

**Scenario:** Click the Period field and verify a date range picker popover opens.

**Steps:**

1. Clicked the "Select period..." button
2. Observed the popover content

**Result:** A popover opens successfully with:

- Filter type tabs: "is", "before", "after", "between" (default: "between")
- Period type toggle: "Day" (selected by default)
- Full calendar for March 2026
- Navigation arrows (prev/next month)
- Today (March 25) highlighted distinctly
- Next month days (April 1-4) shown in lighter style

**Screenshot:** `period-picker-open.png`

---

## Test 3: Date Range Selection (FAIL)

**Scenario:** Select a date range by clicking two dates in the calendar.

**Steps:**

1. Opened the period picker (popover opens in "between" mode)
2. Clicked March 10, 2026 (start date)
3. Clicked March 20, 2026 (end date)

**Expected:** Days 10-20 should highlight as a range, and the Period button should update to show "Mar 10-Mar 20, 2026".

**Actual:**

- No visible range highlighting between the two selected dates
- The trigger button text remains "Select period..." (never updates)
- The popover stays open indefinitely (no auto-close after range completion)
- The data attributes (`data-range-start`, `data-range-end`, `data-range-middle`) are never applied to any day button elements

**Root Cause Analysis:**
The issue appears to be in the data flow between `DateSelector` and `PeriodRangePicker`. When a day is clicked:

1. `handleDayClick` in `date-selector.tsx:362` sets `selectedDate` / `selectedEndDate` state
2. The `useEffect` at line 501-503 fires `onChange(currentValue)` when `currentValue` changes
3. `PeriodRangePicker.handleChange` calls `setSelectorValue(val)` and `onChange(formatPeriod(val))`
4. The parent updates `item.period`, causing PeriodRangePicker to re-render with a new `value` prop
5. The `useEffect` at line 132-135 in `period-range-picker.tsx` calls `parsePeriodString(value)` and `setSelectorValue(parsed)`
6. This can create a feedback loop where Date objects are recreated on every render

**Files involved:**

- `/src/components/reui/date-selector.tsx` (lines 362-382, 477-492, 501-503)
- `/src/components/form/period-range-picker.tsx` (lines 132-135, 137-147)

**Screenshot:** `period-picker-range-selected.png`

---

## Test 4: Console Errors (FAIL - Critical Bug)

**Scenario:** Monitor console for errors during date selection.

### Bug 1: Maximum Update Depth Exceeded (CRITICAL)

**Error:**

```
Error: Maximum update depth exceeded. This can happen when a component repeatedly
calls setState inside componentWillUpdate or componentDidUpdate. React limits the
number of nested updates to prevent infinite loops.
```

**How to reproduce:** Trigger a `.click()` on a calendar day button (e.g., via JavaScript `document.querySelector('button[data-day="3/10/2026"]').click()`). The app crashes entirely, showing "Something went wrong!" error screen.

**Stack trace points to:**

- `setRef` in `chunk-4ZTLQCY3.js:70` (a base-ui or radix dependency)
- `dispatchSetState` in `react-dom_client.js:6803`

**Root cause:** The `useEffect` at `date-selector.tsx:501-503` calls `onChange(currentValue)` whenever `currentValue` changes. Combined with the parent component's `useEffect` at `period-range-picker.tsx:132-135` that syncs incoming `value` back to `setSelectorValue`, this creates an infinite state update loop:

```
Day click -> setSelectedDate -> currentValue changes -> useEffect fires onChange
-> parent re-renders -> value prop changes -> useEffect sets selectorValue
-> DateSelector re-renders with new value -> useEffect at 477 sets state
-> currentValue changes again -> infinite loop
```

The native Playwright clicks do not trigger this crash (likely due to different event timing), but the app still fails to properly register and display the date selection.

**Screenshot:** `error-state.png`

### Bug 2: Hydration Mismatch (Pre-existing, Low Priority)

```
Hydration failed because the server rendered HTML didn't match the client.
```

This is a pre-existing SSR hydration issue, not related to the date picker. Likely caused by date/time-dependent rendering or browser-specific features during server rendering.

---

## Recommendations

### Critical Fix: Date Selector Infinite Loop

The `useEffect` in `date-selector.tsx` at lines 501-503 that fires `onChange` on every `currentValue` change should be refactored:

```tsx
// CURRENT (problematic):
useEffect(() => {
  onChange?.(currentValue)
}, [currentValue, onChange])

// This creates a bidirectional sync loop when the parent
// re-renders with a new value derived from onChange
```

Suggested approaches:

1. Remove the `useEffect`-based onChange and only call `onChange` from explicit user actions (handleDayClick, handlePeriodSelect, handleYearSelect)
2. Add a ref-based guard to prevent re-triggering onChange when the value was just set from the parent
3. Use a "controlled vs uncontrolled" pattern with a stable value comparison to break the loop

### Secondary Fix: Range Selection Visual Feedback

The calendar does not show range highlighting (`data-range-start`, `data-range-end`, `data-range-middle` attributes) even when clicks are processed without crashing. The `selected` prop passed to the `Calendar` component in `DateSelectorDayPicker` may not be receiving the correct `DateRange` object after a click.

---

## Screenshots Index

| File                               | Description                                                         |
| ---------------------------------- | ------------------------------------------------------------------- |
| `line-items-form.png`              | Line items section with Period, Qty, Unit Price, Amount on same row |
| `period-picker-open.png`           | Date range picker popover opened with March 2026 calendar           |
| `period-picker-range-selected.png` | Calendar after clicking two dates (no range highlight visible)      |
| `error-state.png`                  | App crash screen showing "Maximum update depth exceeded"            |
