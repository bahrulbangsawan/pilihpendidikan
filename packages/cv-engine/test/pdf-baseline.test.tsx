// T8-01: the extraction is behaviour-neutral. Every template renders the
// sample CV (and a document that reaches the sections and characters the
// sample leaves out) to the same pages, text and fonts as the apps/cv
// templates did before they moved here (./fixtures/pdf-baseline.json).
//
// After an intentional change to a template, rewrite the baseline with
// `CV_PDF_BASELINE=update bun test test/pdf-baseline.test.tsx` and review
// the diff of the fixture.
import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { Font, renderToBuffer } from "@react-pdf/renderer";
import { CV_STYLES } from "../src/document";
import { CVDocument } from "../src/pdf/cv-document";
import { renderCvPdfBlob } from "../src/pdf/render";
import { PDF_CASES, SAMPLE } from "./cases";
import baselineJson from "./fixtures/pdf-baseline.json";
import type { PdfBaseline, PdfSnapshot } from "./pdf-snapshot";
import { snapshotPdf } from "./pdf-snapshot";
import { registerTestPrint } from "./print-setup";

const BASELINE_PATH = new URL("./fixtures/pdf-baseline.json", import.meta.url);
const UPDATE = process.env.CV_PDF_BASELINE === "update";
const baseline = baselineJson as PdfBaseline;
// A render takes a few hundred milliseconds; the long sample, more.
const RENDER_TIMEOUT_MS = 30_000;

registerTestPrint(Font);

const rendered: PdfBaseline = {};

describe("T8-01 PDF output matches the pre-extraction baseline", () => {
  for (const [name, data] of Object.entries(PDF_CASES)) {
    for (const style of CV_STYLES) {
      const key = `${name}/${style}`;
      it(
        `T8-01 ${key}: same page count, text and fonts`,
        async () => {
          const bytes = await renderToBuffer(
            <CVDocument data={data} style={style} />
          );
          const snapshot = await snapshotPdf(new Uint8Array(bytes));
          rendered[key] = snapshot;
          if (UPDATE) {
            return;
          }
          const expected: PdfSnapshot | undefined = baseline[key];
          expect(expected).toBeDefined();
          expect(snapshot.pages).toBe(expected?.pages ?? -1);
          expect(snapshot.fonts).toEqual(expected?.fonts ?? []);
          expect(snapshot.text).toEqual(expected?.text ?? []);
        },
        RENDER_TIMEOUT_MS
      );
    }
  }

  it("T8-01 the baseline covers every template and case", () => {
    if (UPDATE) {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(rendered, null, 2)}\n`);
      return;
    }
    const keys = Object.keys(PDF_CASES).flatMap((name) =>
      CV_STYLES.map((style) => `${name}/${style}`)
    );
    expect(Object.keys(baseline).sort()).toEqual(keys.sort());
    for (const snapshot of Object.values(baseline)) {
      expect(
        snapshot.fonts.some((font) => font.endsWith("+Inter-Regular"))
      ).toBe(true);
    }
  });

  it(
    "T8-01 renderCvPdfBlob, the Download PDF path, gives the same PDF",
    async () => {
      let registeredWith: unknown = null;
      const blob = await renderCvPdfBlob(SAMPLE, "harvard", {
        registerFonts: (font) => {
          registeredWith = font;
          registerTestPrint(font);
        },
      });
      expect(registeredWith).toBe(Font);
      expect(blob.size).toBeGreaterThan(0);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      const snapshot = await snapshotPdf(bytes);
      expect(snapshot).toEqual(baseline["sample/harvard"] as PdfSnapshot);
    },
    RENDER_TIMEOUT_MS
  );
});
