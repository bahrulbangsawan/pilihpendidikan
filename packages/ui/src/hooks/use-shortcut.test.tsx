// @vitest-environment happy-dom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcut } from "./use-shortcut";

declare global {
  // React's flag for tests that drive updates with act().
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function Harness({
  onKey,
  enabled = true,
}: {
  onKey: () => void;
  enabled?: boolean;
}) {
  useShortcut("d", onKey, enabled);
  return (
    <div>
      <input aria-label="Invoice number" />
      <button
        aria-controls="currency-options"
        aria-expanded={false}
        aria-label="Currency"
        role="combobox"
        type="button"
      />
    </div>
  );
}

function press(target: EventTarget, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "d", bubbles: true, ...init })
  );
}

let container: HTMLDivElement;
let root: Root;

function render(onKey: () => void, enabled = true) {
  act(() => {
    root.render(<Harness enabled={enabled} onKey={onKey} />);
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("useShortcut()", () => {
  it("runs on its key, in either case", () => {
    const onKey = vi.fn();
    render(onKey);
    press(document.body);
    press(document.body, { key: "D" });
    expect(onKey).toHaveBeenCalledTimes(2);
  });

  it("ignores modified keys and key repeats", () => {
    const onKey = vi.fn();
    render(onKey);
    press(document.body, { metaKey: true });
    press(document.body, { ctrlKey: true });
    press(document.body, { altKey: true });
    press(document.body, { repeat: true });
    expect(onKey).not.toHaveBeenCalled();
  });

  it("ignores typing in a field and letters on a combobox trigger", () => {
    const onKey = vi.fn();
    render(onKey);
    const input = container.querySelector("input");
    const trigger = container.querySelector("[role='combobox']");
    if (!(input && trigger)) {
      throw new Error("Harness did not render its controls");
    }
    press(input);
    press(trigger);
    expect(onKey).not.toHaveBeenCalled();
  });

  it("ignores keys pressed behind an open window", () => {
    const onKey = vi.fn();
    render(onKey);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.append(dialog);
    press(document.body);
    expect(onKey).not.toHaveBeenCalled();
    dialog.remove();
    press(document.body);
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it("does not treat an always-present inline list as a window", () => {
    const onKey = vi.fn();
    render(onKey);
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    document.body.append(list);
    press(document.body);
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while disabled", () => {
    const onKey = vi.fn();
    render(onKey, false);
    press(document.body);
    expect(onKey).not.toHaveBeenCalled();
  });
});
