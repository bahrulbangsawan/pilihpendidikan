// What T8-01 compares between two renders of the same CV: the page count,
// the text of every page as a PDF reader extracts it, and the fonts the file
// embeds. The baseline in ./fixtures/pdf-baseline.json was taken from the
// apps/cv templates before they moved into this package.
import { extractText, getDocumentProxy } from "unpdf";

export interface PdfSnapshot {
  fonts: string[];
  pages: number;
  text: string[];
}

export type PdfBaseline = Record<string, PdfSnapshot>;

// Font dictionaries sit outside the compressed content streams, so their
// names can be read straight from the file. PDFKit derives the six-letter
// subset tag from the font's resource name, which keeps it stable.
const BASE_FONT = /\/BaseFont\s*\/([^\s/<>[\]()]+)/g;

function embeddedFonts(bytes: Uint8Array): string[] {
  const source = new TextDecoder("latin1").decode(bytes);
  const names = new Set<string>();
  for (const match of source.matchAll(BASE_FONT)) {
    if (match[1]) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

export async function snapshotPdf(bytes: Uint8Array): Promise<PdfSnapshot> {
  const fonts = embeddedFonts(bytes);
  // pdf.js takes ownership of the buffer it reads, so it gets a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { fonts, pages: totalPages, text };
}
