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
import { useTranslation } from "@/i18n";

interface LocalityLineProps {
  city: string;
  kecamatan: string;
  state: string;
  postalCode: string;
  country: string;
}

function LocalityLine({
  city,
  kecamatan,
  state,
  postalCode,
  country,
}: LocalityLineProps) {
  if (!(city || kecamatan || state || postalCode)) {
    return null;
  }
  const parts =
    country === "Indonesia"
      ? [kecamatan, city, state, postalCode]
      : [city, state, postalCode];
  return <p>{parts.filter(Boolean).join(", ")}</p>;
}

export function InvoicePreview({ data }: { data: InvoiceData }) {
  const { t } = useTranslation();
  const { from, billTo, items, adjustments, currency, taxRate } = data;
  const subtotal = calcSubtotal(items);
  const tax = calcTax(subtotal, taxRate);
  const total = calcTotal(items, taxRate, adjustments);

  const isEmpty = !from.companyName && items.length === 0;

  if (isEmpty) {
    return (
      <div className="flex min-h-[37.5rem] items-center justify-center text-center text-muted-foreground">
        {t("preview.emptyState")}
      </div>
    );
  }

  // Zedative on paper, mirroring invoice-pdf.tsx: Inter at 400 / 600 / 700,
  // the copy as written (sentence case, no letter-spacing), and the print
  // palette through tokens that `.invoice-page` (styles.css) re-scopes to
  // literal values, so Night Desk never recolours the sheet. Running text is
  // `ink` (inherited); the title, names and the amount due `foreground`;
  // labels, column headers, periods and sub-items `muted-foreground`; rules
  // `line`. Amounts take tabular figures (the PDF's `tnum`).
  return (
    <article className="invoice-page mx-auto">
      {/* Accent top bar in the user's accent colour */}
      <div
        className="h-1"
        style={{ backgroundColor: data.accentColor || "#f48120" }}
      />

      <div className="p-4 sm:p-6 md:p-8">
        {/* Header: Invoice title + logo */}
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-bold text-foreground text-lg sm:text-xl">
            {t("preview.invoice")}
          </h1>
          {from.logoUrl && (
            <img
              alt={from.companyName}
              className="h-auto max-h-12 w-auto object-contain"
              decoding="async"
              height={48}
              loading="eager"
              src={from.logoUrl}
              width={48}
            />
          )}
        </div>

        {/* Metadata */}
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs sm:mt-4 sm:gap-x-4">
          <span className="font-semibold text-muted-foreground">
            {t("preview.invoiceNumber")}
          </span>
          <span>{data.invoiceNumber}</span>
          <span className="font-semibold text-muted-foreground">
            {t("preview.dateOfIssue")}
          </span>
          <span>{formatInvoiceDate(data.dateOfIssue)}</span>
          <span className="font-semibold text-muted-foreground">
            {t("preview.dateDue")}
          </span>
          <span>{formatInvoiceDate(data.dateDue)}</span>
        </div>

        {/* Separator */}
        <div className="my-4 border-line border-t sm:my-6" />

        {/* Sender / Recipient two-column */}
        <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 sm:gap-8">
          {/* Sender */}
          <div className="space-y-0.5">
            {from.companyName && (
              <p className="font-semibold text-foreground">
                {from.companyName}
              </p>
            )}
            {from.address && (
              <p className="whitespace-pre-line">{from.address}</p>
            )}
            <LocalityLine
              city={from.city}
              country={from.country}
              kecamatan={from.kecamatan}
              postalCode={from.postalCode}
              state={from.state}
            />
            {from.country && <p>{from.country}</p>}
            {from.email && <p>{from.email}</p>}
          </div>

          {/* Recipient */}
          <div className="space-y-0.5">
            <p className="font-semibold text-muted-foreground">
              {t("preview.billTo")}
            </p>
            {billTo.name && (
              <p className="font-semibold text-foreground">{billTo.name}</p>
            )}
            {billTo.address && (
              <p className="whitespace-pre-line">{billTo.address}</p>
            )}
            <LocalityLine
              city={billTo.city}
              country={billTo.country}
              kecamatan={billTo.kecamatan}
              postalCode={billTo.postalCode}
              state={billTo.stateRegion}
            />
            {billTo.country && <p>{billTo.country}</p>}
            {billTo.email && <p>{billTo.email}</p>}
          </div>
        </div>

        {/* Amount due banner */}
        <p className="mt-4 font-semibold text-foreground text-sm sm:mt-6 sm:text-base">
          {formatCurrency(total, currency)} {currency} {t("preview.due")}{" "}
          {formatInvoiceDate(data.dateDue)}
        </p>

        {/* Line items. The table follows the sheet's width (the `line-items`
            container), not the viewport's: the sheet is narrow on a phone
            and in the split editor's preview pane alike.
            - 28rem and wider: the PDF's four columns. The price columns
              mirror its 110pt columns (about a fifth of the line each): at
              least 7.5rem, growing with the figure so a long Rupiah amount
              never runs into its neighbour.
            - Narrower, where the figures would squeeze the description to a
              sliver: each row stacks, the description across the row and
              qty, unit price and amount on a line below it, in columns every
              row and the header share. A sub-item indents only its label, so
              its figures keep those columns.
            The scroller remains for an outsized figure. */}
        {items.length > 0 && (
          <div className="@container/line-items -mx-4 mt-4 overflow-x-auto px-4 sm:-mx-0 sm:mt-6 sm:px-0">
            {/* Column headers */}
            <div className="grid @md/line-items:grid-cols-[1fr_3rem_minmax(7.5rem,auto)_minmax(7.5rem,auto)] grid-cols-[2.5rem_1fr_1fr] @md/line-items:gap-x-4 gap-x-2 gap-y-1 border-line border-b pb-2 font-semibold text-[0.625rem] text-muted-foreground">
              <span className="@md/line-items:col-span-1 col-span-full">
                {t("preview.description")}
              </span>
              <span className="@md/line-items:text-right">
                {t("preview.qty")}
              </span>
              <span className="text-right">{t("preview.unitPrice")}</span>
              <span className="text-right">{t("preview.amount")}</span>
            </div>

            {/* Rows */}
            {items.map((item) => (
              <div className="break-inside-avoid" key={item.id}>
                <div className="grid @md/line-items:grid-cols-[1fr_3rem_minmax(7.5rem,auto)_minmax(7.5rem,auto)] grid-cols-[2.5rem_1fr_1fr] @md/line-items:gap-x-4 gap-x-2 gap-y-1 border-line border-b py-2 text-xs sm:py-3">
                  <div className="@md/line-items:col-span-1 col-span-full min-w-0">
                    <p className="break-words">{item.description}</p>
                    {item.period && (
                      <p className="text-[0.625rem] text-muted-foreground">
                        {item.period}
                      </p>
                    )}
                  </div>
                  <span className="@md/line-items:text-right tabular-nums">
                    {item.qty}
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums">
                    {formatCurrency(item.unitPrice, currency)}
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums">
                    {formatCurrency(lineItemTotal(item), currency)}
                  </span>
                </div>

                {/* Sub-items */}
                {item.subItems.map((sub) => (
                  <div
                    className="grid @md/line-items:grid-cols-[1fr_3rem_minmax(7.5rem,auto)_minmax(7.5rem,auto)] grid-cols-[2.5rem_1fr_1fr] @md/line-items:gap-x-4 gap-x-2 gap-y-1 border-line border-b py-1.5 text-[0.6875rem] text-muted-foreground sm:py-2"
                    key={sub.id}
                  >
                    <span className="@md/line-items:col-span-1 col-span-full min-w-0 break-words pl-3 sm:pl-4">
                      {sub.label}
                    </span>
                    <span className="@md/line-items:text-right tabular-nums">
                      {sub.qty}
                    </span>
                    <span className="whitespace-nowrap text-right tabular-nums">
                      {formatCurrency(sub.unitPrice, currency)}
                    </span>
                    <span className="whitespace-nowrap text-right tabular-nums">
                      {formatCurrency(sub.amount, currency)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Footer totals */}
        <div className="mt-4 flex break-inside-avoid justify-end sm:mt-6">
          <div className="w-full space-y-2 text-xs sm:w-64">
            <div className="flex justify-between">
              <span>{t("preview.subtotal")}</span>
              <span className="whitespace-nowrap tabular-nums">
                {formatCurrency(subtotal, currency)}
              </span>
            </div>
            {taxRate > 0 && (
              <div className="flex justify-between">
                <span>
                  {t("preview.tax")} ({taxRate}%)
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {formatCurrency(tax, currency)}
                </span>
              </div>
            )}
            {adjustments.map((adj) => {
              const amount = calcAdjustmentAmount(adj, subtotal);
              return (
                <div className="flex justify-between" key={adj.id}>
                  <span>
                    {adj.type === "deduct" ? "\u2212" : "+"}{" "}
                    {adj.label || t("preview.adjustment")}
                    {adj.mode === "percentage" ? ` (${adj.value}%)` : ""}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {formatCurrency(amount, currency)}
                  </span>
                </div>
              );
            })}
            <div className="flex justify-between border-line border-t pt-2">
              <span>{t("preview.total")}</span>
              <span className="whitespace-nowrap tabular-nums">
                {formatCurrency(total, currency)}
              </span>
            </div>
            <div className="flex justify-between font-semibold text-foreground">
              <span>
                {t("preview.amountDue")} ({currency})
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {formatCurrency(total, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Custom fields */}
        {data.customFields.length > 0 && (
          <div className="mt-4 break-inside-avoid space-y-1 text-xs sm:mt-6">
            {data.customFields.map((cf) => (
              <div
                className="grid grid-cols-[6rem_1fr] gap-2 sm:grid-cols-[8rem_1fr]"
                key={cf.id}
              >
                <span className="font-semibold text-muted-foreground">
                  {cf.label}
                </span>
                <span>{cf.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Notes */}
        {data.notes && (
          <div className="mt-4 text-xs sm:mt-6">
            <p className="break-after-avoid font-semibold text-muted-foreground">
              {t("preview.notes")}
            </p>
            <p className="mt-1 whitespace-pre-line">{data.notes}</p>
          </div>
        )}
      </div>
    </article>
  );
}
