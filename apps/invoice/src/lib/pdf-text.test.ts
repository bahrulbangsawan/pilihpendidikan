import { describe, expect, it } from "vitest";
import type { InvoiceData } from "@/components/invoice-form-utils";
import sample from "@/data/sample-invoice.json";
import { toPdfText } from "./pdf-text";

const SAMPLE = sample as InvoiceData;

describe("toPdfText", () => {
  it("keeps the user's line breaks in the addresses and the notes", () => {
    const pdf = toPdfText({
      ...SAMPLE,
      from: { ...SAMPLE.from, address: "Jl. Veteran 17\r\nRT 2 / RW 3" },
      notes: "Bank BCA Payable within 30 days",
    });
    expect(pdf.from.address).toBe("Jl. Veteran 17\nRT 2 / RW 3");
    expect(pdf.notes).toBe("Bank BCA\nPayable within 30 days");
  });

  it("sets one-line fields as the sheet does: one space, no ends", () => {
    const pdf = toPdfText({
      ...SAMPLE,
      invoiceNumber: " INV\t001 ",
      billTo: { ...SAMPLE.billTo, name: "PT Maju\n\nJaya" },
    });
    expect(pdf.invoiceNumber).toBe("INV 001");
    expect(pdf.billTo.name).toBe("PT Maju Jaya");
  });

  it("composes accents the print cuts have only precomposed", () => {
    const pdf = toPdfText({
      ...SAMPLE,
      billTo: { ...SAMPLE.billTo, name: "École Supérieure" },
    });
    expect(pdf.billTo.name).toBe("École Supérieure");
  });

  it("leaves numbers and the rest of the invoice alone", () => {
    expect(toPdfText(SAMPLE)).toEqual(SAMPLE);
  });
});
