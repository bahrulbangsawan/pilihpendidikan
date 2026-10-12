import { toPrintLine, toPrintText } from "@rulisme/ui/print/pdf-text";
import type { InvoiceData } from "@/components/invoice-form-utils";

// Fields whose newlines are the user's own line breaks (the address and notes
// textareas): the sheet shows them with `whitespace-pre-line`, and the PDF
// sets each line as its own Text (`toPrintLines`). Every other field is one
// line, as the sheet shows it.
const MULTILINE_FIELDS = new Set(["address", "notes"]);

function toPdfValue(value: unknown, field: string): unknown {
  if (typeof value === "string") {
    return MULTILINE_FIELDS.has(field)
      ? toPrintText(value)
      : toPrintLine(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => toPdfValue(item, field));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toPdfValue(item, key)])
    );
  }
  return value;
}

/**
 * The invoice with every string made safe for the PDF's print cuts and set as
 * the sheet sets it (`@rulisme/ui/print/pdf-text`): characters the cuts lack
 * never reach react-pdf's unembedded fallback font, and one-line fields
 * collapse their spaces and line breaks. The addresses and the notes keep the
 * user's line breaks.
 */
export function toPdfText(data: InvoiceData): InvoiceData {
  return toPdfValue(data, "") as InvoiceData;
}
