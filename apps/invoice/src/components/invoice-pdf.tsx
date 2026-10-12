import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { hyphenateWithin } from "@rulisme/ui/print/pdf-fonts";
import { toPrintLines } from "@rulisme/ui/print/pdf-text";
import type { InvoiceData } from "@/components/invoice-form-utils";
import {
  calcAdjustmentAmount,
  calcSubtotal,
  calcTax,
  calcTotal,
  formatCurrency,
  formatInvoiceDate,
  lineItemTotal,
} from "@/components/invoice-form-utils";
import type { Locale } from "@/i18n";
import { getT } from "@/i18n";
// Registers Inter (400 / 600 / 700) before any document renders.
import { PDF_FONT_FAMILY } from "@/lib/pdf-fonts";
import { toPdfText } from "@/lib/pdf-text";

// ── Date formatting ───────────────────────────────────────

function formatDate(dateStr: string): string {
  // Stored ISO yyyy-MM-dd → friendly "dd MMM yyyy" (legacy formats tolerated).
  return formatInvoiceDate(dateStr);
}

// ── Zedative on paper ─────────────────────────────────────
// The PDF cannot read CSS tokens, so the print palette is literal here; the
// on-screen sheet (`.invoice-page` in styles.css) re-scopes the same values.
// Paper is never themed: Night Desk does not recolour the invoice. The user's
// accent colour (the top rule) is document content and stays as chosen.

const PRINT = {
  foreground: "#000000", // the title, party names, the amount due
  ink: "#393d45", // running text and figures
  muted: "#5a6170", // labels, column headers, periods, sub-items, page number
  line: "#cbcfd4", // hairline rules
} as const;

// Inter's default figures are proportional; amounts line up in columns, so
// they take its tabular figures (the preview's `tabular-nums`).
const TABULAR_FIGURES = ["tnum"];

// ── Pagination ────────────────────────────────────────────
// Sections carry their own 30pt side padding; the page adds a top and a
// bottom margin on every page. The top margin shows on continuation pages:
// on page 1 the accent rule bleeds into it, so the header sits where it
// always has. The bottom margin ends the body about 20pt above the page
// number (itself 20pt up from the edge), so the two never share a line.
const PAGE_MARGIN_TOP = 30;
const PAGE_MARGIN_BOTTOM = 48;
// The notes heading never ends a page without two lines of the paragraph
// (8pt at 1.4) under it; a shorter paragraph moves whole with its heading.
const NOTES_LINE = 8 * 1.4;
const NOTES_MIN_PRESENCE = NOTES_LINE * 2;
// A block (an item with its sub-items, the totals, the custom fields) stays
// on one page only while it surely fits one: react-pdf squeezes a
// wrap={false} block taller than a page into overlapping text. Past this many
// rows, each row is kept whole on its own instead.
const MAX_KEPT_ROWS = 20;
// The custom-field label column is 90pt at 8pt semibold: a one-word label
// longer than this breaks in it instead of running into its value.
const LABEL_HYPHENATION = hyphenateWithin(14);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    fontFamily: PDF_FONT_FAMILY,
    fontWeight: 400,
    fontSize: 9,
    color: PRINT.ink,
    paddingTop: PAGE_MARGIN_TOP,
    paddingBottom: PAGE_MARGIN_BOTTOM,
  },

  // Accent bar (the user's accent colour), flush with the top edge of page 1
  accentBar: {
    height: 4,
    marginTop: -PAGE_MARGIN_TOP,
    backgroundColor: "#f48120",
    width: "100%",
  },

  // Header
  header: {
    padding: 30,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  invoiceTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: PRINT.foreground,
  },
  logo: {
    maxHeight: 40,
    objectFit: "contain",
  },
  metaBlock: {
    marginTop: 16,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  // Label and value side by side, as on the sheet: the label keeps its
  // column, the value takes the rest of the row and wraps in it.
  metaLabel: {
    fontSize: 8,
    fontWeight: 600,
    width: 90,
    flexShrink: 0,
    color: PRINT.muted,
  },
  metaValue: {
    flex: 1,
    fontSize: 8,
    color: PRINT.ink,
  },

  // From / Bill To
  partiesSection: {
    flexDirection: "row",
    paddingHorizontal: 30,
    paddingBottom: 20,
    gap: 30,
  },
  partyColumn: {
    flex: 1,
  },
  partyTitle: {
    fontSize: 8,
    fontWeight: 600,
    color: PRINT.muted,
    marginBottom: 4,
  },
  partyName: {
    fontSize: 9,
    fontWeight: 600,
    color: PRINT.foreground,
    marginBottom: 2,
  },
  partyText: {
    fontSize: 8,
    color: PRINT.ink,
    lineHeight: 1.4,
  },

  // Amount due
  amountDueSection: {
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: PRINT.line,
    borderBottomWidth: 1,
    borderBottomColor: PRINT.line,
    marginBottom: 10,
  },
  amountDueText: {
    fontSize: 13,
    fontWeight: 600,
    color: PRINT.foreground,
  },

  // Line items table
  table: {
    paddingHorizontal: 30,
    paddingTop: 10,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PRINT.line,
    paddingBottom: 6,
    marginBottom: 2,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontWeight: 600,
    color: PRINT.muted,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PRINT.line,
    paddingVertical: 8,
    alignItems: "flex-start",
  },
  colDescription: {
    flex: 1,
  },
  colQty: {
    width: 40,
    flexShrink: 0,
    textAlign: "right",
    paddingLeft: 8,
  },
  colUnitPrice: {
    width: 110,
    flexShrink: 0,
    textAlign: "right",
    paddingLeft: 8,
  },
  colAmount: {
    width: 110,
    flexShrink: 0,
    textAlign: "right",
    paddingLeft: 8,
  },
  itemDescription: {
    fontSize: 8,
    color: PRINT.ink,
  },
  itemPeriod: {
    fontSize: 8,
    color: PRINT.muted,
    marginTop: 2,
  },
  itemNumber: {
    fontSize: 8,
    color: PRINT.ink,
    textAlign: "right",
    fontFeatureSettings: TABULAR_FIGURES,
  },

  // Sub-items
  subItemRow: {
    flexDirection: "row",
    paddingVertical: 4,
    alignItems: "flex-start",
  },
  subItemLabel: {
    fontSize: 8,
    color: PRINT.muted,
    paddingLeft: 14,
  },
  subItemNumber: {
    fontSize: 8,
    color: PRINT.muted,
    textAlign: "right",
    fontFeatureSettings: TABULAR_FIGURES,
  },

  // Footer totals
  footer: {
    paddingHorizontal: 30,
    paddingTop: 16,
    alignItems: "flex-end",
  },
  totalsBlock: {
    width: 220,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  // A long adjustment label wraps beside its amount instead of running into
  // it; the amount keeps its width.
  totalLabel: {
    flex: 1,
    paddingRight: 8,
    fontSize: 8,
    color: PRINT.ink,
  },
  totalValue: {
    flexShrink: 0,
    fontSize: 8,
    color: PRINT.ink,
    textAlign: "right",
    fontFeatureSettings: TABULAR_FIGURES,
  },
  totalDueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: PRINT.line,
    marginTop: 4,
  },
  totalDueLabel: {
    flex: 1,
    paddingRight: 8,
    fontSize: 8,
    fontWeight: 600,
    color: PRINT.foreground,
  },
  totalDueValue: {
    flexShrink: 0,
    fontSize: 8,
    fontWeight: 600,
    color: PRINT.foreground,
    textAlign: "right",
    fontFeatureSettings: TABULAR_FIGURES,
  },

  // Custom fields (bank details and the like), then the notes. Each is its
  // own page-level block so it paginates on its own: the fields never split,
  // and the notes heading stays with its paragraph.
  customFields: {
    paddingHorizontal: 30,
    paddingTop: 24,
  },
  notesTitle: {
    paddingHorizontal: 30,
    marginTop: 24,
    fontSize: 8,
    fontWeight: 600,
    color: PRINT.muted,
    marginBottom: 4,
  },
  notesTitleAfterFields: {
    marginTop: 6,
  },
  notesText: {
    paddingHorizontal: 30,
    fontSize: 8,
    color: PRINT.ink,
    lineHeight: 1.4,
  },

  // Page number
  pageNumber: {
    position: "absolute",
    bottom: 20,
    right: 30,
    fontSize: 7,
    color: PRINT.muted,
  },
});

// ── Component ─────────────────────────────────────────────

export function InvoiceDocument({
  data: invoice,
  locale = "en",
}: {
  data: InvoiceData;
  locale?: Locale;
}) {
  const t = getT(locale);
  const data = toPdfText(invoice);
  const subtotal = calcSubtotal(data.items);
  const tax = calcTax(subtotal, data.taxRate);
  const total = calcTotal(data.items, data.taxRate, data.adjustments);
  // Subtotal, tax, each adjustment, total and amount due.
  const totalRows = 3 + (data.taxRate > 0 ? 1 : 0) + data.adjustments.length;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Accent bar in the user's accent colour */}
        <View
          style={[
            styles.accentBar,
            { backgroundColor: data.accentColor || "#f48120" },
          ]}
        />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.invoiceTitle}>{t("preview.invoice")}</Text>
            {data.from.logoUrl ? (
              <Image src={data.from.logoUrl} style={styles.logo} />
            ) : null}
          </View>

          <View style={styles.metaBlock}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{t("preview.invoiceNumber")}</Text>
              <Text style={styles.metaValue}>{data.invoiceNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{t("preview.dateOfIssue")}</Text>
              <Text style={styles.metaValue}>
                {formatDate(data.dateOfIssue)}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{t("preview.dateDue")}</Text>
              <Text style={styles.metaValue}>{formatDate(data.dateDue)}</Text>
            </View>
          </View>
        </View>

        {/* From / Bill To */}
        <View style={styles.partiesSection}>
          {/* From */}
          <View style={styles.partyColumn}>
            <Text style={styles.partyName}>{data.from.companyName}</Text>
            {data.from.address
              ? toPrintLines(data.from.address).map((line) => (
                  <Text key={line.key} style={styles.partyText}>
                    {line.text}
                  </Text>
                ))
              : null}
            <Text style={styles.partyText}>
              {(data.from.country === "Indonesia"
                ? [
                    data.from.kecamatan,
                    data.from.city,
                    data.from.state,
                    data.from.postalCode,
                  ]
                : [data.from.city, data.from.state, data.from.postalCode]
              )
                .filter(Boolean)
                .join(", ")}
            </Text>
            {data.from.country ? (
              <Text style={styles.partyText}>{data.from.country}</Text>
            ) : null}
            {data.from.email ? (
              <Text style={styles.partyText}>{data.from.email}</Text>
            ) : null}
          </View>

          {/* Bill To */}
          <View style={styles.partyColumn}>
            <Text style={styles.partyTitle}>{t("preview.billTo")}</Text>
            <Text style={styles.partyName}>{data.billTo.name}</Text>
            {data.billTo.address
              ? toPrintLines(data.billTo.address).map((line) => (
                  <Text key={line.key} style={styles.partyText}>
                    {line.text}
                  </Text>
                ))
              : null}
            <Text style={styles.partyText}>
              {(data.billTo.country === "Indonesia"
                ? [
                    data.billTo.kecamatan,
                    data.billTo.city,
                    data.billTo.stateRegion,
                    data.billTo.postalCode,
                  ]
                : [
                    data.billTo.city,
                    data.billTo.stateRegion,
                    data.billTo.postalCode,
                  ]
              )
                .filter(Boolean)
                .join(", ")}
            </Text>
            {data.billTo.country ? (
              <Text style={styles.partyText}>{data.billTo.country}</Text>
            ) : null}
            {data.billTo.email ? (
              <Text style={styles.partyText}>{data.billTo.email}</Text>
            ) : null}
          </View>
        </View>

        {/* Amount due */}
        <View style={styles.amountDueSection}>
          <Text style={styles.amountDueText}>
            {formatCurrency(total, data.currency)} {data.currency}{" "}
            {t("preview.due")} {formatDate(data.dateDue)}
          </Text>
        </View>

        {/* Line items table */}
        <View style={styles.table}>
          {/* Header row */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colDescription]}>
              {t("preview.description")}
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>
              {t("preview.qty")}
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colUnitPrice]}>
              {t("preview.unitPrice")}
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colAmount]}>
              {t("preview.amount")}
            </Text>
          </View>

          {/* Item rows */}
          {data.items.map((item) => (
            <View key={item.id} wrap={item.subItems.length + 1 > MAX_KEPT_ROWS}>
              <View style={styles.tableRow} wrap={false}>
                <View style={styles.colDescription}>
                  <Text style={styles.itemDescription}>{item.description}</Text>
                  {item.period ? (
                    <Text style={styles.itemPeriod}>{item.period}</Text>
                  ) : null}
                </View>
                <Text style={[styles.itemNumber, styles.colQty]}>
                  {item.qty}
                </Text>
                <Text style={[styles.itemNumber, styles.colUnitPrice]}>
                  {formatCurrency(item.unitPrice, data.currency)}
                </Text>
                <Text style={[styles.itemNumber, styles.colAmount]}>
                  {formatCurrency(lineItemTotal(item), data.currency)}
                </Text>
              </View>

              {/* Sub-items */}
              {item.subItems.map((sub) => (
                <View key={sub.id} style={styles.subItemRow} wrap={false}>
                  <View style={styles.colDescription}>
                    <Text style={styles.subItemLabel}>{sub.label}</Text>
                  </View>
                  <Text style={[styles.subItemNumber, styles.colQty]}>
                    {sub.qty}
                  </Text>
                  <Text style={[styles.subItemNumber, styles.colUnitPrice]}>
                    {formatCurrency(sub.unitPrice, data.currency)}
                  </Text>
                  <Text style={[styles.subItemNumber, styles.colAmount]}>
                    {formatCurrency(sub.amount, data.currency)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {/* Footer totals, kept together on one page while they fit one */}
        <View style={styles.footer} wrap={totalRows > MAX_KEPT_ROWS}>
          <View style={styles.totalsBlock}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t("preview.subtotal")}</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(subtotal, data.currency)}
              </Text>
            </View>
            {data.taxRate > 0 ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  {t("preview.tax")} ({data.taxRate}%)
                </Text>
                <Text style={styles.totalValue}>
                  {formatCurrency(tax, data.currency)}
                </Text>
              </View>
            ) : null}
            {data.adjustments.map((adj) => {
              const amount = calcAdjustmentAmount(adj, subtotal);
              return (
                <View key={adj.id} style={styles.totalRow} wrap={false}>
                  <Text style={styles.totalLabel}>
                    {adj.type === "deduct" ? "\u2212" : "+"}{" "}
                    {adj.label || t("preview.adjustment")}
                    {adj.mode === "percentage" ? ` (${adj.value}%)` : ""}
                  </Text>
                  <Text style={styles.totalValue}>
                    {formatCurrency(amount, data.currency)}
                  </Text>
                </View>
              );
            })}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t("preview.total")}</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(total, data.currency)}
              </Text>
            </View>
            <View style={styles.totalDueRow}>
              <Text style={styles.totalDueLabel}>{t("preview.amountDue")}</Text>
              <Text style={styles.totalDueValue}>
                {formatCurrency(total, data.currency)} {data.currency}
              </Text>
            </View>
          </View>
        </View>

        {/* Custom fields, kept together on one page while they fit one */}
        {data.customFields.length > 0 ? (
          <View
            style={styles.customFields}
            wrap={data.customFields.length > MAX_KEPT_ROWS}
          >
            {data.customFields.map((cf) => (
              <View key={cf.id} style={styles.metaRow} wrap={false}>
                <Text
                  hyphenationCallback={LABEL_HYPHENATION}
                  style={styles.metaLabel}
                >
                  {cf.label}
                </Text>
                <Text style={styles.metaValue}>{cf.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Notes: page-level siblings, so the heading's minPresenceAhead can
            carry it to the next page with its paragraph; a long paragraph
            still flows on across pages. */}
        {data.notes ? (
          <>
            <Text
              minPresenceAhead={NOTES_MIN_PRESENCE}
              style={[
                styles.notesTitle,
                data.customFields.length > 0
                  ? styles.notesTitleAfterFields
                  : {},
              ]}
            >
              {t("preview.notes")}
            </Text>
            {toPrintLines(data.notes).map((line) => (
              <Text key={line.key} style={styles.notesText}>
                {line.text}
              </Text>
            ))}
          </>
        ) : null}

        {/* Page number */}
        <Text
          fixed
          render={({ pageNumber, totalPages }) =>
            t("preview.pageOf", { page: pageNumber, total: totalPages })
          }
          style={styles.pageNumber}
        />
      </Page>
    </Document>
  );
}
