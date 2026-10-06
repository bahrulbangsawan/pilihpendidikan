import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { getInvoice, putInvoice, text } from "../helpers";
import { nullableIsoDateField, optionalEmail, optionalUrl } from "../schemas";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function registerInvoicePartiesTools(server: McpServer, env: Env): void {
  server.registerTool(
    "invoice_update_info",
    {
      description:
        "Update top-level invoice fields: number, dates, currency, accent color, notes, tax rate.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        invoice_number: z.string().optional(),
        date_of_issue: nullableIsoDateField.describe("YYYY-MM-DD"),
        date_due: nullableIsoDateField.describe("YYYY-MM-DD"),
        currency: z
          .enum(["USD", "EUR", "GBP", "IDR", "SGD", "AUD", "JPY", "MYR"])
          .optional(),
        accent_color: z
          .string()
          .regex(HEX_COLOR_RE, "Must be a 6-digit hex color, e.g. #2563eb")
          .optional()
          .describe("Hex color, e.g. #2563eb"),
        notes: z.string().optional(),
        tax_rate: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("Tax percentage, e.g. 11 for 11%"),
      },
    },
    async ({
      invoice_id,
      invoice_number,
      date_of_issue,
      date_due,
      currency,
      accent_color,
      notes,
      tax_rate,
    }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      if (invoice_number !== undefined) {
        invoice.invoiceNumber = invoice_number;
      }
      // `!= null` (not `!== undefined`): a client may send JSON null for "no
      // change"; nullableIsoDateField lets that through validation and the guard
      // treats it as a no-op so a date is never overwritten with null. [defect-1]
      if (date_of_issue != null) {
        invoice.dateOfIssue = date_of_issue;
      }
      if (date_due != null) {
        invoice.dateDue = date_due;
      }
      if (currency !== undefined) {
        invoice.currency = currency;
      }
      if (accent_color !== undefined) {
        invoice.accentColor = accent_color;
      }
      if (notes !== undefined) {
        invoice.notes = notes;
      }
      if (tax_rate !== undefined) {
        invoice.taxRate = tax_rate;
      }
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Invoice "${invoice_id}" info updated.`);
    }
  );

  server.registerTool(
    "invoice_update_sender",
    {
      description:
        "Update the sender (your company) information on an invoice.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        company_name: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        kecamatan: z
          .string()
          .optional()
          .describe("Subdistrict / kecamatan (Indonesian addresses)"),
        state: z.string().optional(),
        postal_code: z.string().optional(),
        country: z.string().optional(),
        email: optionalEmail.optional(),
        logo_url: optionalUrl.optional(),
      },
    },
    async ({
      invoice_id,
      company_name,
      address,
      city,
      kecamatan,
      state,
      postal_code,
      country,
      email,
      logo_url,
    }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      if (company_name !== undefined) {
        invoice.from.companyName = company_name;
      }
      if (address !== undefined) {
        invoice.from.address = address;
      }
      if (city !== undefined) {
        invoice.from.city = city;
      }
      if (kecamatan !== undefined) {
        invoice.from.kecamatan = kecamatan;
      }
      if (state !== undefined) {
        invoice.from.state = state;
      }
      if (postal_code !== undefined) {
        invoice.from.postalCode = postal_code;
      }
      if (country !== undefined) {
        invoice.from.country = country;
      }
      if (email !== undefined) {
        invoice.from.email = email;
      }
      if (logo_url !== undefined) {
        invoice.from.logoUrl = logo_url;
      }
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Sender info updated on invoice "${invoice_id}".`);
    }
  );

  server.registerTool(
    "invoice_update_recipient",
    {
      description: "Update the recipient (bill to) information on an invoice.",
      inputSchema: {
        invoice_id: z.string().default("default"),
        name: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        kecamatan: z
          .string()
          .optional()
          .describe("Subdistrict / kecamatan (Indonesian addresses)"),
        state_region: z.string().optional(),
        postal_code: z.string().optional(),
        country: z.string().optional(),
        email: optionalEmail.optional(),
      },
    },
    async ({
      invoice_id,
      name,
      address,
      city,
      kecamatan,
      state_region,
      postal_code,
      country,
      email,
    }) => {
      const invoice = await getInvoice(env.INVOICE_KV, invoice_id);
      if (!invoice) {
        return text(`Invoice "${invoice_id}" not found.`);
      }
      if (name !== undefined) {
        invoice.billTo.name = name;
      }
      if (address !== undefined) {
        invoice.billTo.address = address;
      }
      if (city !== undefined) {
        invoice.billTo.city = city;
      }
      if (kecamatan !== undefined) {
        invoice.billTo.kecamatan = kecamatan;
      }
      if (state_region !== undefined) {
        invoice.billTo.stateRegion = state_region;
      }
      if (postal_code !== undefined) {
        invoice.billTo.postalCode = postal_code;
      }
      if (country !== undefined) {
        invoice.billTo.country = country;
      }
      if (email !== undefined) {
        invoice.billTo.email = email;
      }
      await putInvoice(env.INVOICE_KV, invoice_id, invoice);
      return text(`Recipient info updated on invoice "${invoice_id}".`);
    }
  );
}
