import {
  ensureUrl as engineEnsureUrl,
  formatPhoneDisplay as engineFormatPhoneDisplay,
} from "@pilihpendidikan/cv-engine/format";
import { describe, expect, it } from "vitest";
import { cn, ensureUrl, formatPhoneDisplay } from "./utils";

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

describe("the CV engine's format helpers, re-exported", () => {
  it("are the engine's own functions", () => {
    expect(ensureUrl).toBe(engineEnsureUrl);
    expect(formatPhoneDisplay).toBe(engineFormatPhoneDisplay);
  });

  it("add a missing scheme to a link and keep an existing one", () => {
    expect(ensureUrl("bengkele.com")).toBe("https://bengkele.com");
    expect(ensureUrl("http://example.org")).toBe("http://example.org");
    expect(ensureUrl("")).toBe("");
  });

  it("group a phone number in fours from the right", () => {
    expect(formatPhoneDisplay("+6281234567890")).toBe("+62812-3456-7890");
    expect(formatPhoneDisplay("0812 3456 789")).toBe("081-2345-6789");
    expect(formatPhoneDisplay("1234")).toBe("1234");
  });
});
