import { describe, expect, it } from "vitest";
import styles from "../styles.css?raw";
import { LIMITS } from "./portfolio-data-model";

// The locked layout's rules in the preview's stylesheet (CLAUDE.md § Locked
// layout). How a browser lays them out is checked in a browser; the PDF's
// clamps and the preview's markup are tested as rendered in
// deck-render.test.tsx.

// The body of the first rule that starts with `head`, up to its closing
// brace.
function block(source: string, head: string): string {
  const start = source.indexOf(head);
  expect(start, `${head} exists`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("}", start));
}

const PRINT = "@media print {";

describe("portfolio deck stylesheet", () => {
  it("lets Scope of Work give way when the rail is full", () => {
    // The field shrinks and the list wraps an item that no longer fits into
    // a second column the clip hides, so it sheds whole items.
    expect(block(styles, ".pf-field--sow {")).toContain("min-height: 0;");
    expect(block(styles, ".pf-sow {")).toContain("flex-wrap: wrap;");
  });

  it("sizes the Scope of Work list for every item LIMITS allows", () => {
    const item = block(styles, ".pf-sow li {");
    expect(item).toContain("font-size: 13px;");
    expect(item).toContain("line-height: 1.45;");
    expect(item).toContain("margin-bottom: 2px;");
    expect(block(styles, ".pf-sow {")).toContain(
      `max-height: calc(${LIMITS.project.scopeOfWork.maxItems} * (13px * 1.45 + 2px));`
    );
  });

  it("clamps each cover footer entry as its own block", () => {
    // The line count is set inline per entry (src/lib/cover-foot.ts).
    const line = block(styles, ".pf-cover__line {");
    expect(line).toContain("display: -webkit-box;");
    expect(line).toContain("-webkit-box-orient: vertical;");
    expect(line).toContain("overflow: hidden;");
    expect(block(styles, ".pf-cover__foot p {")).not.toContain(
      "-webkit-line-clamp"
    );
  });

  it("prints each sheet laid out whole, as on screen", () => {
    // Laid out across pages, a full rail kept every Scope of Work item and
    // pushed Technologies over the Impact strip; size containment makes the
    // sheet monolithic.
    const print = styles.slice(styles.indexOf(PRINT));
    expect(print.length).toBeGreaterThan(PRINT.length);
    expect(block(print, ".pf-page {")).toContain("contain: strict;");
  });
});
