// Renders a CV to a PDF Blob in a browser runtime: the Download PDF button of
// apps/cv and the Job Tracker's render page (D-14). Load this subpath with a
// dynamic import; it must not enter a Workers module graph.
import { Font, pdf } from "@react-pdf/renderer";
import type { CVData, CVStyle } from "../types";
import { CVDocument } from "./cv-document";
import { requirePrintText } from "./print";

/** The `Font` store of the react-pdf instance that renders. */
export type CvPdfFontStore = typeof Font;

export interface RenderCvPdfOptions {
  /**
   * Prepares the print module before the render: registers the Inter print
   * cuts with the given `Font` (registerPrintFonts from
   * @rulisme/ui/print/pdf-fonts) and the text helpers with
   * registerCvPrintText. It receives the very `Font` this renderer uses, so
   * the registration cannot land on another copy of react-pdf. Must be safe
   * to call more than once. Omit it when the caller has done both already.
   */
  registerFonts?: (font: CvPdfFontStore) => void | Promise<void>;
}

/** The CV as a PDF, exactly as the "Download PDF" button produces it. */
export async function renderCvPdfBlob(
  data: CVData,
  style: CVStyle,
  options: RenderCvPdfOptions = {}
): Promise<Blob> {
  await options.registerFonts?.(Font);
  // Fail before react-pdf starts rather than from inside its render.
  requirePrintText();
  return await pdf(<CVDocument data={data} style={style} />).toBlob();
}
