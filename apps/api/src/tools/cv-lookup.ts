import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getCV, getInvoice, json, putInvoice, text } from "../helpers";
import type { InvoiceData } from "../types";
import { invoiceLineTotal } from "../types";

interface InvoiceUpdateInput {
  description?: string;
  qty?: number;
  unit_price?: number;
  period?: string;
  label?: string;
  type?: "add" | "deduct";
  mode?: "percentage" | "fixed";
  value?: number;
  field_value?: string;
}

async function updateInvoiceItem(
  kv: KVNamespace,
  invoiceId: string,
  invoice: InvoiceData,
  id: string,
  input: InvoiceUpdateInput
) {
  const item = invoice.items.find((i) => i.id === id);
  if (!item) {
    return text(`No item with id "${id}".`);
  }
  if (input.description !== undefined) {
    item.description = input.description;
  }
  if (input.period !== undefined) {
    item.period = input.period;
  }
  if (input.qty !== undefined) {
    item.qty = input.qty;
  }
  if (input.unit_price !== undefined) {
    item.unitPrice = input.unit_price;
  }
  // Roll sub-item amounts into the parent line total. Previously this set
  // `item.amount = qty × unitPrice`, silently dropping any sub-items from the
  // line — and therefore from every subtotal that trusts item.amount. [defect-2]
  item.amount = invoiceLineTotal(item);
  await putInvoice(kv, invoiceId, invoice);
  return text(`Item "${id}" updated. Line total: ${item.amount}`);
}

async function updateInvoiceAdjustment(
  kv: KVNamespace,
  invoiceId: string,
  invoice: InvoiceData,
  id: string,
  input: InvoiceUpdateInput
) {
  const adj = invoice.adjustments.find((a) => a.id === id);
  if (!adj) {
    return text(`No adjustment with id "${id}".`);
  }
  if (input.label !== undefined) {
    adj.label = input.label;
  }
  if (input.type !== undefined) {
    adj.type = input.type;
  }
  if (input.mode !== undefined) {
    adj.mode = input.mode;
  }
  if (input.value !== undefined) {
    adj.value = input.value;
  }
  await putInvoice(kv, invoiceId, invoice);
  return text(`Adjustment "${id}" updated.`);
}

async function updateInvoiceCustomField(
  kv: KVNamespace,
  invoiceId: string,
  invoice: InvoiceData,
  id: string,
  input: InvoiceUpdateInput
) {
  const field = invoice.customFields.find((f) => f.id === id);
  if (!field) {
    return text(`No custom field with id "${id}".`);
  }
  if (input.label !== undefined) {
    field.label = input.label;
  }
  if (input.field_value !== undefined) {
    field.value = input.field_value;
  }
  await putInvoice(kv, invoiceId, invoice);
  return text(`Custom field "${id}" updated.`);
}

const INVOICE_SECTIONS: Record<string, true> = {
  items: true,
  adjustments: true,
  customFields: true,
};

const ALL_SECTIONS = z.enum([
  "experience",
  "education",
  "skills",
  "awards",
  "certificates",
  "languages",
  "projects",
  "volunteer",
  "items",
  "adjustments",
  "customFields",
]);

type CvSection =
  | "experience"
  | "education"
  | "skills"
  | "awards"
  | "certificates"
  | "languages"
  | "projects"
  | "volunteer";

type InvoiceSection = "items" | "adjustments" | "customFields";

export function registerCvLookupTools(server: McpServer, env: Env): void {
  server.registerTool(
    "cv_list_section",
    {
      description:
        "List all entries in a CV or invoice section with their IDs. Use this before update or remove operations to find entry IDs. For CV sections provide cv_id; for invoice sections (items, adjustments, customFields) provide invoice_id.",
      inputSchema: {
        cv_id: z.string().default("default"),
        invoice_id: z.string().optional(),
        section: ALL_SECTIONS,
      },
    },
    async ({ cv_id, invoice_id, section }) => {
      if (Object.hasOwn(INVOICE_SECTIONS, section)) {
        const id = invoice_id ?? "default";
        const invoice = await getInvoice(env.INVOICE_KV, id);
        if (!invoice) {
          return text(`Invoice "${id}" not found.`);
        }
        const entries = invoice[section as InvoiceSection] as unknown[];
        if (entries.length === 0) {
          return text(`Section "${section}" is empty.`);
        }
        return json(entries);
      }
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const entries = cv[section as CvSection] as unknown[];
      if (entries.length === 0) {
        return text(`Section "${section}" is empty.`);
      }
      return json(entries);
    }
  );

  server.registerTool(
    "cv_get_entry_by_id",
    {
      description: "Get a single entry from a CV or invoice section by its ID.",
      inputSchema: {
        cv_id: z.string().default("default"),
        invoice_id: z.string().optional(),
        section: ALL_SECTIONS,
        id: z.string().describe("The entry's id field"),
      },
    },
    async ({ cv_id, invoice_id, section, id }) => {
      if (Object.hasOwn(INVOICE_SECTIONS, section)) {
        const invId = invoice_id ?? "default";
        const invoice = await getInvoice(env.INVOICE_KV, invId);
        if (!invoice) {
          return text(`Invoice "${invId}" not found.`);
        }
        const arr = invoice[section as InvoiceSection] as { id: string }[];
        const entry = arr.find((e) => e.id === id);
        if (!entry) {
          return text(`No entry with id "${id}" in section "${section}".`);
        }
        return json(entry);
      }
      const cv = await getCV(env.CV_KV, cv_id);
      if (!cv) {
        return text(`CV "${cv_id}" not found.`);
      }
      const arr = cv[section as CvSection] as { id: string }[];
      const entry = arr.find((e) => e.id === id);
      if (!entry) {
        return text(`No entry with id "${id}" in section "${section}".`);
      }
      return json(entry);
    }
  );

  server.registerTool(
    "invoice_typed_update_by_id",
    {
      description:
        "Deprecated. Prefer invoice_update_item, invoice_update_sub_item, invoice_update_adjustment, or invoice_update_custom_field. Update an invoice section entry by its ID with type-validated fields. Use cv_list_section to find IDs. Only provided fields are changed.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        section: z.enum(["items", "adjustments", "customFields"]),
        id: z.string().describe("Entry ID from cv_list_section"),
        description: z
          .string()
          .optional()
          .describe("Line item description (items)"),
        qty: z.number().positive().optional().describe("Quantity (items)"),
        unit_price: z.number().min(0).optional().describe("Unit price (items)"),
        period: z
          .string()
          .optional()
          .describe("Period label, e.g. 'Jan 2024' (items)"),
        label: z
          .string()
          .optional()
          .describe("Label text (adjustments or customFields)"),
        type: z
          .enum(["add", "deduct"])
          .optional()
          .describe("Surcharge or discount (adjustments)"),
        mode: z
          .enum(["percentage", "fixed"])
          .optional()
          .describe("Calculation mode (adjustments)"),
        value: z
          .number()
          .positive()
          .optional()
          .describe("Numeric amount or percentage (adjustments)"),
        field_value: z
          .string()
          .optional()
          .describe("Field value string (customFields)"),
      },
    },
    async (input) => {
      const { invoice_id, section, id } = input;
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      if (section === "items") {
        return updateInvoiceItem(
          env.INVOICE_KV,
          invoice_id,
          invoice,
          id,
          input
        );
      }
      if (section === "adjustments") {
        return updateInvoiceAdjustment(
          env.INVOICE_KV,
          invoice_id,
          invoice,
          id,
          input
        );
      }
      return updateInvoiceCustomField(
        env.INVOICE_KV,
        invoice_id,
        invoice,
        id,
        input
      );
    }
  );
}
