# QA Test Report: Period Date Range Picker - Crash on Open

**Date:** 2026-03-25
**Feature:** Period Date Range Picker in Line Items Section
**URL:** http://localhost:5004/
**Overall Status:** FAIL - CRITICAL BUG

---

## Test Summary

Clicking the Period date range picker button ("Feb 23-Mar 22, 2026") in an expanded Line Item causes the entire application to crash with a **"Maximum update depth exceeded"** React error. The error boundary catches it and displays "Something went wrong!" replacing the entire page content.

---

## Test Scenarios

### Test 1: Page Load - Console Errors

**Status:** PASS

- Page loads without errors
- Only non-critical messages: React DevTools info, React Grab version warning

### Test 2: Load Sample Invoice

**Status:** PASS

- "Load Sample Invoice" button populates all form fields
- Line items appear correctly (4 items)
- No console errors

### Test 3: Expand Line Item

**Status:** PASS

- Clicking a line item accordion expands it
- Shows: Description, Period button ("Feb 23-Mar 22, 2026"), Quantity, Rate, Amount
- No console errors

### Test 4: Click Period Date Range Picker Button

**Status:** FAIL - CRITICAL

- Clicking the "Feb 23-Mar 22, 2026" button crashes the entire application
- Error: "Maximum update depth exceeded"
- Full error message: "Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops."
- The error boundary catches the error and displays "Something went wrong!" replacing the entire page
- All form data is lost (cannot be recovered without reloading)

### Test 5: Select Date Range

**Status:** BLOCKED

- Cannot test date selection because the popover never opens (crash occurs first)

### Test 6: Verify Selected Range in Button Text

**Status:** BLOCKED

- Cannot test because of the crash in Test 4

---

## Error Details

### Error Message

```
Maximum update depth exceeded. This can happen when a component repeatedly calls setState
inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates
to prevent infinite loops.
```

### Stack Trace (from console)

```
at getRootForUpdatedFiber (react-dom_client.js:3526:128)
at enqueueConcurrentHookUpdate (react-dom_client.js:3510:16)
at dispatchSetStateInternal (react-dom_client.js:6832:20)
at dispatchSetState (react-dom_client.js:6803:9)
at setRef (chunk-4ZTLQCY3.js:70:12)
at chunk-4ZTLQCY3.js:79:23
at Array.map (<anonymous>)
at chunk-4ZTLQCY3.js:78:27
at setRef (chunk-4ZTLQCY3.js:70:12)
at chunk-4ZTLQCY3.js:79:23
```

### Affected Files

- `/src/components/reui/date-selector.tsx` (lines 477-503) - Root cause
- `/src/components/form/period-range-picker.tsx` - Consumer component

---

## Root Cause Analysis

The infinite update loop is caused by the interaction between two `useEffect` hooks in the `useDateSelector` hook inside `date-selector.tsx`:

**Effect 1 (lines 477-492):** Syncs external `value` prop to internal state

```typescript
useEffect(() => {
  if (value) {
    setPeriodType(value.period || validDefaultPeriodType)
    setFilterType(...)
    setSelectedDate(value.startDate)
    setSelectedEndDate(value.endDate)
    // ... sets many state variables
  }
}, [value, validDefaultPeriodType, defaultFilterType, presetMode])
```

**Effect 2 (lines 501-503):** Fires onChange whenever internal state changes

```typescript
useEffect(() => {
  onChange?.(currentValue)
}, [currentValue, onChange])
```

**The cycle:**

1. Parent (PeriodRangePicker) passes `value` prop (parsed Date objects)
2. Effect 1 syncs value to internal state (multiple setState calls)
3. Internal state changes cause `currentValue` (useMemo) to recalculate
4. Effect 2 fires `onChange(currentValue)` with the new value
5. Parent's `onChange` formats the dates to a string, calls parent onChange
6. Parent receives new string, PeriodRangePicker re-parses to new Date objects
7. New Date objects have different object references, triggering Effect 1 again
8. Go to step 2 -> INFINITE LOOP

The `PeriodRangePicker` component attempts to mitigate this with `useRef` (initialRef, lastValueRef), but the mitigation is insufficient because the DateSelector's Effect 2 fires unconditionally on mount, and the resulting onChange callback creates new Date objects (from re-parsing the formatted string) which have different references than the original ones.

---

## Screenshots

- `screenshot-01-initial-load.png` - Page loaded successfully
- `screenshot-04-line-item-expanded.png` - Line item expanded with Period button visible
- `screenshot-06-period-popover.png` - CRASH: "Something went wrong!" error page

---

## Recommendations

The fix should address the infinite loop in `date-selector.tsx`. Possible approaches:

1. **Remove Effect 2 entirely** (lines 501-503): Instead of using a useEffect to call onChange, call onChange directly in the event handlers (handleDayClick, handlePeriodSelect, etc.) after state updates. This avoids the feedback loop.

2. **Add a comparison guard in Effect 2**: Before calling `onChange(currentValue)`, compare the new value with the previous value using deep equality (comparing date timestamps, not object references). Only call onChange if the values actually changed.

3. **Make the value prop controlled without re-syncing**: Instead of having Effect 1 re-sync from value on every change, only initialize from value on mount. Use a controlled/uncontrolled pattern properly.

The most robust fix is option 1: remove the automatic onChange effect and instead call onChange explicitly from user-initiated actions only.
