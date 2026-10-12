// Registers Inter with @react-pdf/renderer before any template renders.
import "@/lib/pdf-fonts";
import type { CVData, CVStyle } from "@/components/cv-form";
import { CVDocument as BasicDocument } from "@/components/templates/basic-pdf";
import { CVDocument as HarvardDocument } from "@/components/templates/harvard-pdf";
import { CVDocument as SimpleDocument } from "@/components/templates/simple-pdf";
import { CVDocument as StandardDocument } from "@/components/templates/standard-pdf";
import { toPdfText } from "@/components/templates/template-utils";

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
