// biome-ignore-all lint/performance/noBarrelFile: the package's ./pdf entry point (browser-only)
// @pilihpendidikan/cv-engine/pdf: the @react-pdf side of the CV engine.
// Browser-only: load it with a dynamic import behind an SSR guard, never from
// a module a Worker evaluates (the api bundle test asserts the Worker stays
// free of @react-pdf and yoga-layout).
export { CVDocument } from "./cv-document";
export type { CvPrintText } from "./print";
export {
  getTextLines,
  PDF_FONT_FAMILY,
  registerCvPrintText,
  toPdfText,
} from "./print";
export type { CvPdfFontStore, RenderCvPdfOptions } from "./render";
export { renderCvPdfBlob } from "./render";
