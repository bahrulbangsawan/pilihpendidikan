import { describe, expect, it } from "bun:test";

import type { InvoiceLineItem } from "./types";
import { invoiceLineTotal, invoiceSubtotal } from "./types";

// Regression tests for defect-2: the invoice subtotal must equal the true sum of
// every line's own (qty × unitPrice) PLUS its sub-items, computed authoritatively
// from first principles. A stale denormalized `item.amount` — e.g. written by a
// path that forgot to roll sub-items up (the old cv-lookup updateInvoiceItem, or
// a hand-edited JSON import) — must NOT under-report the subtotal.

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
  };
}

describe("invoiceLineTotal", () => {
  it("returns qty × unitPrice when there are no sub-items", () => {
    expect(invoiceLineTotal(line({ qty: 3, unitPrice: 3_500_000 }))).toBe(
      10_500_000
    );
  });

  it("adds sub-item amounts even when the stored parent amount is stale", () => {
    const item = line({
      qty: 1,
      unitPrice: 5_000_000,
      amount: 5_000_000, // STALE: excludes the sub-item below
      subItems: [
        {
          id: "s1",
          label: "pass-through",
          qty: 1,
          unitPrice: 15_000_000,
          amount: 15_000_000,
        },
      ],
    });
    // 5,000,000 (own) + 15,000,000 (sub) — not the stale 5,000,000.
    expect(invoiceLineTotal(item)).toBe(20_000_000);
  });
});

describe("invoiceSubtotal", () => {
  it("never trusts a stale item.amount (defect-2 reproduction)", () => {
    // Mirrors the reported invoice: 75,000,000 of value lives in sub-items whose
    // parent `amount` excludes them, so summing item.amount alone yields the
    // reported 25,500,000 while the true subtotal is 100,500,000.
    const items: InvoiceLineItem[] = [
      line({ id: "a", qty: 1, unitPrice: 9_000_000 }),
      line({ id: "b", qty: 1, unitPrice: 6_000_000 }),
      line({ id: "c", qty: 3, unitPrice: 3_500_000 }), // 10,500,000
      line({
        id: "d",
        qty: 1,
        unitPrice: 0,
        amount: 0, // stale parent — excludes its sub-item
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
    ];
    const staleSum = items.reduce((sum, i) => sum + i.amount, 0);
    expect(staleSum).toBe(25_500_000); // what the OLD Σ item.amount returned
    expect(invoiceSubtotal(items)).toBe(100_500_000); // authoritative result
  });

  it("equals the plain item.amount sum when every amount is already fresh", () => {
    const items: InvoiceLineItem[] = [
      line({ id: "a", qty: 1, unitPrice: 15_000_000 }),
      line({ id: "b", qty: 1, unitPrice: 28_000_000 }),
    ];
    expect(invoiceSubtotal(items)).toBe(43_000_000);
  });
});
