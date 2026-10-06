import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getInvoice, putInvoice, text, uid } from "../helpers";
import type {
  InvoiceAdjustment,
  InvoiceCustomField,
  InvoiceLineItem,
  InvoiceSubItem,
} from "../types";
import { invoiceLineTotal } from "../types";

// Keep a line item's `amount` in sync with the canonical invoice model used by
// apps/invoice (`invoice-form.tsx`): the line total is its own
// qty × unitPrice PLUS the sum of its sub-item amounts. Both invoice_get_totals
// and the PDF/preview renderer read `item.amount` (the subtotal is the sum of
// line `amount`s), so sub-items only roll into the total when the parent amount
// is recomputed after every sub-item mutation. Without this, an invoice edited
// via the MCP sub-item tools would under-report its total versus the same
// invoice edited in the web UI.
function recomputeItemAmount(item: InvoiceLineItem): void {
  item.amount = invoiceLineTotal(item);
}

export function registerInvoiceItemsTools(server: McpServer, env: Env): void {
  server.registerTool(
    "invoice_add_item",
    {
      description: "Add a new line item to an invoice.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        description: z.string().describe("Item description"),
        qty: z.number().positive().describe("Quantity"),
        unit_price: z.number().min(0).describe("Price per unit"),
        period: z
          .string()
          .optional()
          .default("")
          .describe("e.g. 'Jan 2024' or 'Q1 2024'"),
      },
    },
    async ({ invoice_id, description, qty, unit_price, period }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const item: InvoiceLineItem = {
        id: uid(),
        description,
        period: period ?? "",
        qty,
        unitPrice: unit_price,
        amount: qty * unit_price,
        subItems: [],
      };
      invoice.items.push(item);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(
        `Line item added (id: ${item.id}). Amount: ${qty} × ${unit_price} = ${item.amount}`
      );
    }
  );

  server.registerTool(
    "invoice_remove_item",
    {
      description: "Remove a line item from an invoice by its ID.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        id: z.string().describe("Item ID from cv_list_section"),
      },
    },
    async ({ invoice_id, id }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const idx = invoice.items.findIndex((i) => i.id === id);
      if (idx === -1) {
        return text(`No item with id "${id}".`);
      }
      invoice.items.splice(idx, 1);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Item "${id}" removed.`);
    }
  );

  server.registerTool(
    "invoice_add_sub_item",
    {
      description: "Add a sub-item breakdown to an existing line item.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        item_id: z
          .string()
          .describe("Parent line item ID from cv_list_section"),
        label: z.string().describe("Sub-item label"),
        qty: z.number().positive(),
        unit_price: z.number().min(0),
      },
    },
    async ({ invoice_id, item_id, label, qty, unit_price }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const item = invoice.items.find((i) => i.id === item_id);
      if (!item) {
        return text(`No item with id "${item_id}".`);
      }
      const sub: InvoiceSubItem = {
        id: uid(),
        label,
        qty,
        unitPrice: unit_price,
        amount: qty * unit_price,
      };
      item.subItems.push(sub);
      recomputeItemAmount(item);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(
        `Sub-item added to item "${item_id}" (sub id: ${sub.id}). Item total is now ${item.amount}.`
      );
    }
  );

  server.registerTool(
    "invoice_remove_sub_item",
    {
      description: "Remove a sub-item from a line item.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        item_id: z.string().describe("Parent line item ID"),
        sub_id: z.string().describe("Sub-item ID"),
      },
    },
    async ({ invoice_id, item_id, sub_id }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const item = invoice.items.find((i) => i.id === item_id);
      if (!item) {
        return text(`No item with id "${item_id}".`);
      }
      const idx = item.subItems.findIndex((s) => s.id === sub_id);
      if (idx === -1) {
        return text(`No sub-item with id "${sub_id}".`);
      }
      item.subItems.splice(idx, 1);
      recomputeItemAmount(item);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Sub-item "${sub_id}" removed.`);
    }
  );

  server.registerTool(
    "invoice_add_adjustment",
    {
      description: "Add a discount or surcharge adjustment to an invoice.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        label: z.string().describe("e.g. 'Discount', 'Service fee'"),
        type: z
          .enum(["add", "deduct"])
          .describe("add = surcharge, deduct = discount"),
        mode: z
          .enum(["percentage", "fixed"])
          .describe("percentage or fixed amount"),
        value: z
          .number()
          .positive()
          .describe("Percentage (e.g. 10 for 10%) or fixed amount"),
      },
    },
    async ({ invoice_id, label, type, mode, value }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const adj: InvoiceAdjustment = { id: uid(), label, type, mode, value };
      invoice.adjustments.push(adj);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Adjustment "${label}" added (id: ${adj.id}).`);
    }
  );

  server.registerTool(
    "invoice_remove_adjustment",
    {
      description: "Remove an adjustment from an invoice.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        id: z.string().describe("Adjustment ID from cv_list_section"),
      },
    },
    async ({ invoice_id, id }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const idx = invoice.adjustments.findIndex((a) => a.id === id);
      if (idx === -1) {
        return text(`No adjustment with id "${id}".`);
      }
      invoice.adjustments.splice(idx, 1);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Adjustment "${id}" removed.`);
    }
  );

  server.registerTool(
    "invoice_add_custom_field",
    {
      description:
        "Add a custom label/value field to an invoice (e.g. PO Number, Project Code).",
      inputSchema: {
        invoice_id: z.string().default("default"),
        label: z.string().describe("Field label, e.g. 'PO Number'"),
        value: z.string().describe("Field value"),
      },
    },
    async ({ invoice_id, label, value }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const field: InvoiceCustomField = { id: uid(), label, value };
      invoice.customFields.push(field);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Custom field "${label}" added (id: ${field.id}).`);
    }
  );

  server.registerTool(
    "invoice_remove_custom_field",
    {
      description: "Remove a custom field from an invoice.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        id: z.string().describe("Field ID from cv_list_section"),
      },
    },
    async ({ invoice_id, id }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const idx = invoice.customFields.findIndex((f) => f.id === id);
      if (idx === -1) {
        return text(`No custom field with id "${id}".`);
      }
      invoice.customFields.splice(idx, 1);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Custom field "${id}" removed.`);
    }
  );

  server.registerTool(
    "invoice_update_item",
    {
      description:
        "Update a line item on an invoice by its ID. Recalculates amount when qty or unit_price change.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        id: z.string().describe("Item ID from cv_list_section"),
        description: z.string().optional(),
        qty: z.number().positive().optional(),
        unit_price: z.number().min(0).optional(),
        period: z.string().optional(),
      },
    },
    async ({ invoice_id, id, description, qty, unit_price, period }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const item = invoice.items.find((i) => i.id === id);
      if (!item) {
        return text(`No item with id "${id}".`);
      }
      if (description !== undefined) {
        item.description = description;
      }
      if (period !== undefined) {
        item.period = period;
      }
      if (qty !== undefined) {
        item.qty = qty;
      }
      if (unit_price !== undefined) {
        item.unitPrice = unit_price;
      }
      recomputeItemAmount(item);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Item "${id}" updated. Line total: ${item.amount}.`);
    }
  );

  server.registerTool(
    "invoice_update_sub_item",
    {
      description:
        "Update a sub-item inside a line item by its ID. Recalculates amount when qty or unit_price change.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        item_id: z.string().describe("Parent line item ID"),
        sub_id: z.string().describe("Sub-item ID"),
        label: z.string().optional(),
        qty: z.number().positive().optional(),
        unit_price: z.number().min(0).optional(),
      },
    },
    async ({ invoice_id, item_id, sub_id, label, qty, unit_price }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const item = invoice.items.find((i) => i.id === item_id);
      if (!item) {
        return text(`No item with id "${item_id}".`);
      }
      const sub = item.subItems.find((s) => s.id === sub_id);
      if (!sub) {
        return text(`No sub-item with id "${sub_id}".`);
      }
      if (label !== undefined) {
        sub.label = label;
      }
      if (qty !== undefined) {
        sub.qty = qty;
      }
      if (unit_price !== undefined) {
        sub.unitPrice = unit_price;
      }
      sub.amount = sub.qty * sub.unitPrice;
      recomputeItemAmount(item);
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(
        `Sub-item "${sub_id}" updated. Amount: ${sub.qty} × ${sub.unitPrice} = ${sub.amount}`
      );
    }
  );

  server.registerTool(
    "invoice_update_adjustment",
    {
      description: "Update an adjustment on an invoice by its ID.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        id: z.string().describe("Adjustment ID from cv_list_section"),
        label: z.string().optional(),
        type: z
          .enum(["add", "deduct"])
          .optional()
          .describe("add = surcharge, deduct = discount"),
        mode: z
          .enum(["percentage", "fixed"])
          .optional()
          .describe("percentage or fixed amount"),
        value: z.number().positive().optional(),
      },
    },
    async ({ invoice_id, id, label, type, mode, value }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const adj = invoice.adjustments.find((a) => a.id === id);
      if (!adj) {
        return text(`No adjustment with id "${id}".`);
      }
      if (label !== undefined) {
        adj.label = label;
      }
      if (type !== undefined) {
        adj.type = type;
      }
      if (mode !== undefined) {
        adj.mode = mode;
      }
      if (value !== undefined) {
        adj.value = value;
      }
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Adjustment "${id}" updated.`);
    }
  );

  server.registerTool(
    "invoice_update_custom_field",
    {
      description: "Update a custom field on an invoice by its ID.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        id: z.string().describe("Field ID from cv_list_section"),
        label: z.string().optional(),
        value: z.string().optional(),
      },
    },
    async ({ invoice_id, id, label, value }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      const field = invoice.customFields.find((f) => f.id === id);
      if (!field) {
        return text(`No custom field with id "${id}".`);
      }
      if (label !== undefined) {
        field.label = label;
      }
      if (value !== undefined) {
        field.value = value;
      }
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Custom field "${id}" updated.`);
    }
  );
}
