// The PDF's type: the shared print module (@rulisme/ui/print/*, DESIGN.md §
// Implementation › Print artifacts) handed to the CV engine's renderer
// (@pilihpendidikan/cv-engine/pdf): the merged Inter cuts with their repair
// and line-break policy, registered with the react-pdf `Font` that renders,
// and the text normaliser every string passes through. Loaded only by the
// Download PDF handler, in the browser, so the font files never enter the
// Worker.
import type { CvPdfFontStore } from "@pilihpendidikan/cv-engine/pdf";
import { registerCvPrintText } from "@pilihpendidikan/cv-engine/pdf";
import { registerPrintFonts } from "@rulisme/ui/print/pdf-fonts";
import {
  toPrintLine,
  toPrintLines,
  toPrintText,
} from "@rulisme/ui/print/pdf-text";

/** The `registerFonts` step of renderCvPdfBlob; safe to run on every render. */
export function registerCvPrint(font: CvPdfFontStore): void {
  registerPrintFonts(font);
  registerCvPrintText({ toPrintLine, toPrintLines, toPrintText });
}
