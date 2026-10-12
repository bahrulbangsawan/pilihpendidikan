import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn() with the Zedative type utilities", () => {
  it("lets a role replace a generic size and line height", () => {
    expect(cn("text-xs leading-none", "type-body")).toBe("type-body");
  });

  it("keeps a role next to a text colour", () => {
    expect(cn("type-body", "text-muted-foreground")).toBe(
      "type-body text-muted-foreground"
    );
  });

  it("keeps only the last role", () => {
    expect(cn("type-body", "type-caption-compact")).toBe(
      "type-caption-compact"
    );
  });

  it("keeps a weight next to the role it overrides", () => {
    expect(cn("type-title", "weight-normal")).toBe("type-title weight-normal");
  });

  it("resolves weights against each other and Tailwind's font weights", () => {
    expect(cn("weight-bold", "weight-normal")).toBe("weight-normal");
    expect(cn("font-medium", "weight-semibold")).toBe("weight-semibold");
    expect(cn("weight-semibold", "font-medium")).toBe("font-medium");
  });

  it("leaves the lip and glint shadows to compose", () => {
    expect(
      cn("inset-shadow-lip", "hover:inset-shadow-none", "shadow-primary")
    ).toBe("inset-shadow-lip hover:inset-shadow-none shadow-primary");
  });
});
