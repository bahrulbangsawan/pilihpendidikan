// The CV PDF's type, exactly as apps/cv registers it (apps/cv/src/lib/
// pdf-fonts.ts): the shared print module's merged Inter cuts and the text
// normaliser, handed to the very `Font` the CV engine renders with. Browser
// only: loaded by src/lib/render-cv.ts through a dynamic import, so neither
// the fonts nor @react-pdf ever enter the Worker bundle.
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
