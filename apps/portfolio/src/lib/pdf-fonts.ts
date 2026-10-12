// The PDF's type: the shared print cuts, their repair and line-break policy
// (@rulisme/ui/print/pdf-fonts, DESIGN.md § Implementation › Print
// artifacts), registered with this app's react-pdf before the first render.
// Imported only by the PDF modules, which load in the browser at download
// time, so the font files never enter the Worker.
import { Font } from "@react-pdf/renderer";
import {
  PRINT_FONT_FAMILY,
  registerPrintFonts,
} from "@rulisme/ui/print/pdf-fonts";

registerPrintFonts(Font);

/** The family every page of the PDF sets. */
export const PDF_FONT_FAMILY = PRINT_FONT_FAMILY;
