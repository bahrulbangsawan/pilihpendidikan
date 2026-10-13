// The PDF entry point: one @react-pdf document per template. The fonts and
// the print text helpers must be registered first (./print.ts).
import type { CVData, CVStyle } from "../types";
import { CVDocument as BasicDocument } from "./basic-pdf";
import { CVDocument as HarvardDocument } from "./harvard-pdf";
import { toPdfText } from "./print";
import { CVDocument as SimpleDocument } from "./simple-pdf";
import { CVDocument as StandardDocument } from "./standard-pdf";

export function CVDocument({ data, style }: { data: CVData; style: CVStyle }) {
  // Only characters the embedded Inter cuts can set reach the templates.
  const pdfData = toPdfText(data);
  switch (style) {
    case "harvard":
      return <HarvardDocument data={pdfData} />;
    case "simple":
      return <SimpleDocument data={pdfData} />;
    case "standard":
      return <StandardDocument data={pdfData} />;
    default:
      return <BasicDocument data={pdfData} />;
  }
}
