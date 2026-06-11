import { describe, expect, it } from "vitest"
import type { InvoiceLineItem } from "./invoice-form-utils"
import {
  calcSubtotal,
  formatInvoiceDate,
  lineItemTotal,
} from "./invoice-form-utils"

// Regression tests mirroring the mcp `invoice-totals.test.ts`: the rendered
// subtotal must equal the true sum of every line's own (qty × unitPrice) plus
// its sub-items, never trusting a stale denormalized `item.amount`. [defect-2]
// Also covers the ISO-canonical date display helper. [defect-1]

function line(
  partial: Partial<InvoiceLineItem> & Pick<InvoiceLineItem, "qty" | "unitPrice">
): InvoiceLineItem {
  return {
    id: partial.id ?? "x",
    description: partial.description ?? "",
    period: partial.period ?? "",
    qty: partial.qty,
    unitPrice: partial.unitPrice,
    amount: partial.amount ?? partial.qty * partial.unitPrice,
    subItems: partial.subItems ?? [],
  }
}

describe("lineItemTotal", () => {
  it("rolls sub-items into the line total even when item.amount is stale", () => {
    const item = line({
      qty: 1,
      unitPrice: 5_000_000,
      amount: 5_000_000, // stale: excludes the sub-item
      subItems: [
        {
          id: "s1",
          label: "pass-through",
          qty: 1,
          unitPrice: 15_000_000,
          amount: 15_000_000,
        },
      ],
    })
    expect(lineItemTotal(item)).toBe(20_000_000)
  })
})

describe("calcSubtotal", () => {
  it("matches the true line-item sum despite stale parent amounts", () => {
    const items: InvoiceLineItem[] = [
      line({ id: "a", qty: 1, unitPrice: 9_000_000 }),
      line({ id: "b", qty: 1, unitPrice: 6_000_000 }),
      line({ id: "c", qty: 3, unitPrice: 3_500_000 }),
      line({
        id: "d",
        qty: 1,
        unitPrice: 0,
        amount: 0,
        subItems: [
          {
            id: "s",
            label: "work",
            qty: 1,
            unitPrice: 75_000_000,
            amount: 75_000_000,
          },
        ],
      }),
    ]
    expect(calcSubtotal(items)).toBe(100_500_000)
  })
})

describe("formatInvoiceDate", () => {
  it("renders canonical ISO as a friendly date", () => {
    expect(formatInvoiceDate("2026-07-11")).toBe("11 Jul 2026")
  })

  it("tolerates a legacy 'dd MMM yyyy' value", () => {
    expect(formatInvoiceDate("11 Jul 2026")).toBe("11 Jul 2026")
  })

  it("returns an empty string unchanged", () => {
    expect(formatInvoiceDate("")).toBe("")
  })
})
