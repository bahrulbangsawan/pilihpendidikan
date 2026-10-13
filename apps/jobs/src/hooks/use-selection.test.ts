// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Rendered } from "@/test/render";
import { render } from "@/test/render";
import type { Selection } from "./use-selection";
import { useSelection } from "./use-selection";

interface Probe {
  current: Selection;
  setIds: (ids: string[]) => void;
}

let rendered: Rendered | null = null;

afterEach(() => {
  rendered?.unmount();
  rendered = null;
});

/** Mounts `useSelection` over `initial` and exposes it plus an ids setter. */
function mount(initial: string[]): Probe {
  const probe = {} as Probe;
  function Harness() {
    const [ids, setIds] = useState(initial);
    probe.current = useSelection(ids);
    probe.setIds = setIds;
    return null;
  }
  rendered = render(createElement(Harness));
  return probe;
}

function step(work: () => void) {
  act(work);
}

describe("useSelection", () => {
  it("toggles single ids and keeps the visible order", () => {
    const probe = mount(["a", "b", "c"]);
    expect(probe.current.size).toBe(0);
    step(() => probe.current.toggle("c", true));
    step(() => probe.current.toggle("a", true));
    expect(probe.current.selectedIds).toEqual(["a", "c"]);
    expect(probe.current.isSelected("a")).toBe(true);
    step(() => probe.current.toggle("a", false));
    expect(probe.current.selectedIds).toEqual(["c"]);
  });

  it("toggleAll selects every visible id and clears them again", () => {
    const probe = mount(["a", "b"]);
    step(() => probe.current.toggleAll(true));
    expect(probe.current.allSelected).toBe(true);
    expect(probe.current.someSelected).toBe(false);
    expect(probe.current.size).toBe(2);
    step(() => probe.current.toggleAll(false));
    expect(probe.current.size).toBe(0);
    expect(probe.current.allSelected).toBe(false);
  });

  it("is indeterminate (someSelected) with a partial selection", () => {
    const probe = mount(["a", "b", "c"]);
    step(() => probe.current.toggle("b", true));
    expect(probe.current.someSelected).toBe(true);
    expect(probe.current.allSelected).toBe(false);
    step(() => probe.current.clear());
    expect(probe.current.someSelected).toBe(false);
    expect(probe.current.size).toBe(0);
  });

  it("prunes ids that are no longer visible", () => {
    const probe = mount(["a", "b", "c"]);
    step(() => probe.current.toggleAll(true));
    step(() => probe.setIds(["a", "c", "d"]));
    expect(probe.current.selectedIds).toEqual(["a", "c"]);
    expect(probe.current.someSelected).toBe(true);
    // A pruned id does not come back when it reappears.
    step(() => probe.setIds(["a", "b", "c", "d"]));
    expect(probe.current.isSelected("b")).toBe(false);
    expect(probe.current.selectedIds).toEqual(["a", "c"]);
  });

  it("is never all-selected over an empty list", () => {
    const probe = mount([]);
    step(() => probe.current.toggleAll(true));
    expect(probe.current.allSelected).toBe(false);
    expect(probe.current.size).toBe(0);
  });
});
