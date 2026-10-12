import { describe, expect, it } from "vitest";
import { hyphenateForPrint, hyphenateWithin } from "./pdf-fonts";

// In the pieces the callback returns, "" is a break without a hyphen (textkit
// turns it into zero-width space); between two non-empty pieces react-pdf
// breaks with a hyphen.
const breaks = (pieces: string[]) => pieces.join("|");

describe("hyphenateForPrint", () => {
  it("keeps ordinary words whole, long Indonesian compounds included", () => {
    for (const word of ["Zedative", "dipertanggungjawabkan,", "Ševčík"]) {
      expect(hyphenateForPrint(word)).toEqual([word]);
    }
  });

  it("breaks after hyphens, dashes and slashes without adding a hyphen", () => {
    expect(breaks(hyphenateForPrint("full-stack"))).toBe("full-||stack");
    expect(breaks(hyphenateForPrint("2020–2022"))).toBe("2020–||2022");
    expect(breaks(hyphenateForPrint("and/or"))).toBe("and/||or");
  });

  it("breaks long addresses after their separators, without a hyphen", () => {
    expect(
      breaks(hyphenateForPrint("maximilian.wiryawan@universitas.ac.id"))
    ).toBe("maximilian.||wiryawan@||universitas.||ac.||id");
    expect(breaks(hyphenateForPrint("linkedin.com/in/budi"))).toBe(
      "linkedin.com/||in/||budi"
    );
  });

  it("leaves short addresses whole but for their slashes", () => {
    expect(hyphenateForPrint("ana@ui.ac.id")).toEqual(["ana@ui.ac.id"]);
  });

  it("breaks a run with no separator anywhere, never before its hyphen", () => {
    const iban = "NL91ABNA0417164300NL91ABNA0417";
    expect(hyphenateForPrint(iban)).toEqual([...iban]);
    const pieces = hyphenateWithin(4)("abcdefg-hi");
    expect(pieces.join("")).toBe("abcdefg-hi");
    expect(pieces).toContain("g-");
    expect(pieces).not.toContain("-");
  });

  it("keeps accents with their letters", () => {
    const decomposed = "é".repeat(30);
    expect(hyphenateForPrint(decomposed).every((p) => p === "é")).toBe(true);
  });

  it("returns whitespace untouched", () => {
    expect(hyphenateForPrint("  ")).toEqual(["  "]);
  });
});
