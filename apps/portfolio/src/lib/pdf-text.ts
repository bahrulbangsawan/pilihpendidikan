import { toPrintLine } from "@rulisme/ui/print/pdf-text";
import type { Portfolio } from "@/components/portfolio-data-model";

// Every field of the deck is one line or one flowing paragraph: the preview's
// clamped <p> collapses spaces and line breaks (`white-space: normal`), and
// so does the PDF.
function toPdfValue(value: unknown): unknown {
  if (typeof value === "string") {
    return toPrintLine(value);
  }
  if (Array.isArray(value)) {
    return value.map(toPdfValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toPdfValue(item)])
    );
  }
  return value;
}

/**
 * The portfolio with every string made safe for the PDF's print cuts and set
 * as the preview sets it (`@rulisme/ui/print/pdf-text`): characters the cuts
 * lack never reach react-pdf's unembedded fallback font, and spaces and line
 * breaks collapse to one space.
 */
export function toPdfText(data: Portfolio): Portfolio {
  return toPdfValue(data) as Portfolio;
}
