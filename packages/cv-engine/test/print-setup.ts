// The print module exactly as apps/cv registers it (src/lib/pdf-fonts.ts):
// the shared Inter cuts and line-break policy, and the text normaliser.
// cv-engine cannot depend on @rulisme/ui (the UI library depends on it), so
// the tests read the module from its source, as the apps compile it.
import type { Font } from "@react-pdf/renderer";
import { registerPrintFonts } from "../../ui/src/print/pdf-fonts";
import {
  toPrintLine,
  toPrintLines,
  toPrintText,
} from "../../ui/src/print/pdf-text";
import { registerCvPrintText } from "../src/pdf/print";

export const PRINT_TEXT = { toPrintLine, toPrintLines, toPrintText };

/** What an app's `registerFonts` callback does. */
export function registerTestPrint(font: typeof Font): void {
  registerPrintFonts(font);
  registerCvPrintText(PRINT_TEXT);
}
