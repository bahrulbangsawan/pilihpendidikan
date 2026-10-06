import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { getInvoice, json, pdfUrl, putInvoice, text } from "../helpers";
import { APP_ORIGINS } from "../origins";
import { nullableIsoDateField } from "../schemas";
import { createEmptyInvoice, invoiceSubtotal } from "../types";

export function registerInvoiceManagementTools(
  server: McpServer,
  env: Env,
  caller: Caller | null
): void {
  server.registerTool(
    "invoice_list",
    {
      description:
        "List all stored invoices with their IDs, invoice numbers, and client names.",
      inputSchema: {},
    },
    async () => {
      const list = await env.INVOICE_KV.list<{
        invoiceNumber: string;
        client: string;
      }>({ prefix: "invoice:" });
      let invoices = list.keys.map((k) => ({
        id: k.name.replace("invoice:", ""),
        invoiceNumber: k.metadata?.invoiceNumber ?? "",
        client: k.metadata?.client ?? "",
      }));
      // Non-admins only see invoices they own (owner stamped at create time).
      if (caller && !caller.isAdmin) {
        const email = caller.email;
        const checked = await Promise.all(
          invoices.map(async (inv) => ({
            inv,
            owner: await env.INVOICE_KV.get(`owner:inv:${inv.id}`),
          }))
        );
        invoices = checked.filter((c) => c.owner === email).map((c) => c.inv);
      }
      if (invoices.length === 0) {
        return text("No invoices found. Use invoice_create to create one.");
      }
      return json(invoices);
    }
  );

  server.registerTool(
    "invoice_get",
    {
      description: "Get the full data of an invoice by its ID.",
      inputSchema: {
        invoice_id: z
          .string()
          .default("default")
          .describe("Invoice identifier"),
      },
    },
    async ({ invoice_id }) => {
      const data = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!data) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      return json(data);
    }
  );

  server.registerTool(
    "invoice_create",
    {
      description: "Create a new blank invoice with optional initial values.",
      inputSchema: {
        invoice_id: z
          .string()
          .default("default")
          .describe("Invoice identifier (use a slug like 'client-name-2024')"),
        invoice_number: z
          .string()
          .optional()
          .describe("Invoice number, e.g. INV-001"),
        client_name: z.string().optional().describe("Client/recipient name"),
        currency: z
          .enum(["USD", "EUR", "GBP", "IDR", "SGD", "AUD", "JPY", "MYR"])
          .optional(),
        date_of_issue: nullableIsoDateField.describe("YYYY-MM-DD"),
        date_due: nullableIsoDateField.describe("YYYY-MM-DD"),
      },
    },
    async ({
      invoice_id,
      invoice_number,
      client_name,
      currency,
      date_of_issue,
      date_due,
    }) => {
      const existing = await getInvoice(env.INVOICE_KV, invoice_id);
      if (existing) {
        return text(
          `Invoice "${invoice_id}" already exists. Use a different ID or delete it first.`
        );
      }
      const invoice = createEmptyInvoice();
      if (invoice_number) {
        invoice.invoiceNumber = invoice_number;
      }
      if (client_name) {
        invoice.billTo.name = client_name;
      }
      if (currency) {
        invoice.currency = currency;
      }
      if (date_of_issue) {
        invoice.dateOfIssue = date_of_issue;
      }
      if (date_due) {
        invoice.dateDue = date_due;
      }
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      if (caller) {
        await env.INVOICE_KV.put(`owner:inv:${invoice_id}`, caller.email);
      }
      return text(
        `Invoice "${invoice_id}" created.\n\nInvoice number: ${invoice.invoiceNumber}\nView: ${APP_ORIGINS.invoice}/?invoice=${encodeURIComponent(invoice_id)}`
      );
    }
  );

  server.registerTool(
    "invoice_delete",
    {
      description: "Permanently delete an invoice by its ID.",
      inputSchema: {
        invoice_id: z.string().describe("Invoice identifier to delete"),
      },
    },
    async ({ invoice_id }) => {
      const existing = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!existing) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      await env.INVOICE_KV.delete(`invoice:${invoice_id}`);
      await env.INVOICE_KV.delete(`owner:inv:${invoice_id}`);
      return text(`Invoice "${invoice_id}" deleted.`);
    }
  );

  server.registerTool(
    "invoice_get_totals",
    {
      description:
        "Calculate and return the invoice totals: subtotal, tax, adjustments, and grand total.",
      inputSchema: { invoice_id: z.string().default("default") },
    },
    async ({ invoice_id }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      // Authoritative: derive each line total from qty × unitPrice + sub-items
      // rather than trusting the persisted `item.amount`, so a stale amount
      // written elsewhere can never under-report the subtotal. [defect-2]
      const subtotal = invoiceSubtotal(invoice.items);
      const tax = subtotal * (invoice.taxRate / 100);
      const adjustmentsTotal = invoice.adjustments.reduce((s, adj) => {
        const raw =
          adj.mode === "percentage" ? subtotal * (adj.value / 100) : adj.value;
        return s + (adj.type === "deduct" ? -raw : raw);
      }, 0);
      const total = subtotal + tax + adjustmentsTotal;
      return json({
        subtotal,
        tax,
        taxRate: invoice.taxRate,
        adjustmentsTotal,
        total,
        currency: invoice.currency,
      });
    }
  );

  server.registerTool(
    "invoice_get_url",
    {
      description:
        "Get the shareable URLs for an invoice: the editable web URL (auto-saves under your token) and the print-to-PDF URL.",
      inputSchema: { invoice_id: z.string().default("default") },
    },
    async ({ invoice_id }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      // Canonical `?id=` edit URL (the legacy `?invoice=` still resolves in-app)
      // plus the canonical print/PDF route served from the api host.
      const editUrl = `${APP_ORIGINS.invoice}/?id=${encodeURIComponent(invoice_id)}`;
      return text(
        `Edit URL (opens the invoice builder, auto-saves under your token):\n${editUrl}\n\nPrint / PDF URL:\n${pdfUrl("invoice", invoice_id)}`
      );
    }
  );
}
