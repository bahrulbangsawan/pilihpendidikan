import { LINES } from "@/components/portfolio-data-model";

// The lines a cover footer column may fill (the column's body under its
// heading).
const COLUMN_LINES = LINES.cover.contactValue;

/**
 * The lines each entry of a cover footer column may fill, in order, for a
 * column of `entries` entries. Every entry keeps a line of its own and the
 * first may wrap into the lines the others leave: a long institution takes
 * two lines beside its status and a target alone takes three. Entries past
 * the column's lines get none, so a column never runs past its lines.
 *
 * Both renderers clamp each entry to its share, the preview with
 * `-webkit-line-clamp` and the PDF with `maxLines`, so a column shows the
 * same lines on screen and on paper.
 */
export function coverFootLines(entries: number): number[] {
  const shown = Math.max(0, Math.min(entries, COLUMN_LINES));
  return Array.from({ length: shown }, (_, index) =>
    index === 0 ? COLUMN_LINES - shown + 1 : 1
  );
}
