import { useEffect, useLayoutEffect, useRef } from "react";

// Typing never triggers a shortcut, and neither does a letter pressed on a
// select or combobox trigger (it jumps to the matching option).
const EDITABLE =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox']";

// Nor does a key pressed behind an open window: a dialog, alert dialog,
// drawer, popover, menu or open list (Radix marks them data-state="open",
// Base UI data-open). An inline, always-present listbox (cmdk) does not count.
const OPEN_WINDOW = [
  "[role='dialog'][data-state='open']",
  "[role='alertdialog'][data-state='open']",
  "[role='menu'][data-state='open']",
  "[role='listbox'][data-state='open']",
  "[role='dialog'][data-open]",
  "[role='listbox'][data-open]",
].join(", ");

/**
 * Runs `handler` when `key` is pressed on its own — no Ctrl, Meta or Alt,
 * not a repeat, not while an IME is composing — and focus is not in an
 * editable field or behind an open window. These are the single-letter
 * shortcuts that Zedative's `<Kbd>` hints advertise inside primary actions
 * (DESIGN.md § Components): render the hint and register the key together,
 * never one without the other.
 */
export function useShortcut(
  key: string,
  handler: (event: KeyboardEvent) => void,
  enabled = true
) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const target = key.toLowerCase();
    function onKeyDown(event: KeyboardEvent) {
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      if (event.defaultPrevented || event.repeat || event.isComposing) {
        return;
      }
      if (modified || event.key.toLowerCase() !== target) {
        return;
      }
      const element = event.target;
      if (element instanceof Element && element.closest(EDITABLE)) {
        return;
      }
      if (document.querySelector(OPEN_WINDOW)) {
        return;
      }
      event.preventDefault();
      handlerRef.current(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, enabled]);
}
