import { describe, expect, it } from "vitest";
import {
  TYPE_ROLES,
  TYPE_UTILITIES,
  TYPE_WEIGHTS,
  typeClass,
} from "./type-scale";

describe("typeClass()", () => {
  it("returns the default step of a role", () => {
    expect(typeClass("body")).toBe("type-body");
    expect(typeClass("display")).toBe("type-display");
  });

  it("returns the compact step of a role", () => {
    expect(typeClass("caption", "compact")).toBe("type-caption-compact");
    expect(typeClass("title", "compact")).toBe("type-title-compact");
  });

  it("names every role at both steps, and nothing else", () => {
    expect(TYPE_ROLES).toEqual([
      "display",
      "title",
      "subtitle",
      "body",
      "caption",
      "micro",
    ]);
    const fromHelper = TYPE_ROLES.flatMap((role) => [
      typeClass(role).replace("type-", ""),
      typeClass(role, "compact").replace("type-", ""),
    ]);
    expect(TYPE_UTILITIES).toEqual(fromHelper);
    expect(TYPE_UTILITIES).toHaveLength(12);
  });

  it("offers exactly the three Zedative weights", () => {
    expect(TYPE_WEIGHTS).toEqual(["normal", "semibold", "bold"]);
  });
});
