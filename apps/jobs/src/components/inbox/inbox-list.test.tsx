// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOW } from "@/test/fixtures";
import { makeInboxItem } from "@/test/fixtures-rest";
import { render } from "@/test/render";
import { InboxList, LONG_PRESS_MS } from "./inbox-list";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const items = [
  makeInboxItem({ company: "Acme", title: "Frontend", score: 91 }),
  makeInboxItem({ company: "Globex", title: "Data", score: null }),
];

function setup(selecting: boolean, selected: ReadonlySet<string> = new Set()) {
  const props = {
    items,
    selected,
    focusedId: null,
    nowMs: NOW,
    selecting,
    onFocusRow: vi.fn(),
    onOpen: vi.fn(),
    onToggleSelect: vi.fn(),
    onStartSelecting: vi.fn(),
    rowRef: vi.fn(),
  };
  const rendered = render(<InboxList {...props} />);
  const rows = [
    ...rendered.container.querySelectorAll<HTMLAnchorElement>("a[data-row-id]"),
  ];
  return { ...rendered, props, rows };
}

function pointer(type: string, element: Element, x = 10, y = 10) {
  element.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
  );
}

describe("TW-INBOX phone inbox (12 §4: stacked rows, long-press selection)", () => {
  it("TW-INBOX a 500 ms press starts selecting and the click that ends it does not open the job", async () => {
    vi.useFakeTimers();
    const { rows, props, unmount } = setup(false);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Frontend");
    expect(
      rows[0]?.querySelector("[data-score='high']")?.textContent
    ).toContain("91");
    const first = rows[0] as HTMLAnchorElement;
    await act(async () => {
      pointer("pointerdown", first);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      await Promise.resolve();
    });
    expect(props.onStartSelecting).toHaveBeenCalledWith(items[0]?.user_job.id);
    await act(async () => {
      pointer("pointerup", first);
      first.click();
      await Promise.resolve();
    });
    expect(props.onOpen).not.toHaveBeenCalled();
    // A short tap opens the job; moving the finger (a scroll) cancels.
    const second = rows[1] as HTMLAnchorElement;
    await act(async () => {
      pointer("pointerdown", second);
      pointer("pointermove", second, 10, 40);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      second.click();
      await Promise.resolve();
    });
    expect(props.onStartSelecting).toHaveBeenCalledTimes(1);
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("TW-INBOX in selection mode a tap toggles the row instead of opening it", async () => {
    const selected = new Set([items[0]?.user_job.id ?? ""]);
    const { rows, props, unmount } = setup(true, selected);
    expect(rows[0]?.getAttribute("data-state")).toBe("selected");
    await act(async () => {
      rows[1]?.click();
      await Promise.resolve();
    });
    expect(props.onToggleSelect).toHaveBeenCalledWith(
      items[1]?.user_job.id,
      true
    );
    expect(props.onOpen).not.toHaveBeenCalled();
    unmount();
  });
});
