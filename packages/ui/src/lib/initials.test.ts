import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("takes the first letters of the first two words", () => {
    expect(initialsOf("Acme Robotics Inc")).toBe("AR");
    expect(initialsOf("stripe")).toBe("S");
  });

  it("falls back to the email's first letter, then ?", () => {
    expect(initialsOf("", "rina@example.com")).toBe("R");
    expect(initialsOf(null)).toBe("?");
  });
});
