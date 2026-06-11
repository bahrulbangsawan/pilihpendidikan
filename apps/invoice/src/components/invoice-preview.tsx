import type { InvoiceData } from "@/components/invoice-form-utils"
import {
  calcAdjustmentAmount,
  calcSubtotal,
  calcTax,
  calcTotal,
  formatCurrency,
  formatInvoiceDate,
  lineItemTotal,
} from "@/components/invoice-form-utils"
import { useTranslation } from "@/i18n"

export function InvoicePreview({ data }: { data: InvoiceData }) {
  const { t } = useTranslation()
  const { from, billTo, items, adjustments, currency, taxRate } = data
  const subtotal = calcSubtotal(items)
  const tax = calcTax(subtotal, taxRate)
  const total = calcTotal(items, taxRate, adjustments)

  const isEmpty = !from.companyName && items.length === 0

  if (isEmpty) {
    return (
      <div className="flex min-h-[37.5rem] items-center justify-center text-center text-muted-foreground">
        {t("preview.emptyState")}
      </div>
    )
  }

  return (
    <article className="invoice-page mx-auto">
      {/* Orange top bar */}
      <div
        className="h-1"
        style={{ backgroundColor: data.accentColor || "#f48120" }}
      />

      <div className="p-4 sm:p-6 md:p-8">
        {/* Header: Invoice title + logo */}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold sm:text-xl">
            {t("preview.invoice")}
          </h1>
          {from.logoUrl && (
            <img
              alt={from.companyName}
              className="max-h-12 object-contain"
              src={from.logoUrl}
            />
          )}
        </div>

        {/* Metadata */}
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs sm:mt-4 sm:gap-x-4">
          <span className="font-bold">{t("preview.invoiceNumber")}</span>
          <span>{data.invoiceNumber}</span>
          <span className="font-bold">{t("preview.dateOfIssue")}</span>
          <span>{formatInvoiceDate(data.dateOfIssue)}</span>
          <span className="font-bold">{t("preview.dateDue")}</span>
          <span>{formatInvoiceDate(data.dateDue)}</span>
        </div>

        {/* Separator */}
        <div className="my-4 border-t border-gray-300 sm:my-6" />

        {/* Sender / Recipient two-column */}
        <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 sm:gap-8">
          {/* Sender */}
          <div className="space-y-0.5">
            {from.companyName && (
              <p className="font-bold">{from.companyName}</p>
            )}
            {from.address && <p>{from.address}</p>}
            {(from.city || from.kecamatan || from.state || from.postalCode) && (
              <p>
                {(from.country === "Indonesia"
                  ? [from.kecamatan, from.city, from.state, from.postalCode]
                  : [from.city, from.state, from.postalCode]
                )
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            {from.country && <p>{from.country}</p>}
            {from.email && <p>{from.email}</p>}
          </div>

          {/* Recipient */}
          <div className="space-y-0.5">
            <p className="font-bold">{t("preview.billTo")}</p>
            {billTo.name && <p>{billTo.name}</p>}
            {billTo.address && <p>{billTo.address}</p>}
            {(billTo.city ||
              billTo.kecamatan ||
              billTo.stateRegion ||
              billTo.postalCode) && (
              <p>
                {(billTo.country === "Indonesia"
                  ? [
                      billTo.kecamatan,
                      billTo.city,
                      billTo.stateRegion,
                      billTo.postalCode,
                    ]
                  : [billTo.city, billTo.stateRegion, billTo.postalCode]
                )
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            {billTo.country && <p>{billTo.country}</p>}
            {billTo.email && <p>{billTo.email}</p>}
          </div>
        </div>

        {/* Amount due banner */}
        <p className="mt-4 text-sm font-bold sm:mt-6 sm:text-base">
          {formatCurrency(total, currency)} {currency} {t("preview.due")}{" "}
          {formatInvoiceDate(data.dateDue)}
        </p>

        {/* Line items table */}
        {items.length > 0 && (
          <div className="-mx-4 mt-4 overflow-x-auto px-4 sm:-mx-0 sm:mt-6 sm:px-0">
            {/* Column headers */}
            <div className="grid min-w-[20rem] grid-cols-[1fr_2.5rem_auto_auto] gap-2 border-b border-gray-300 pb-2 text-[0.625rem] font-medium text-gray-500 sm:grid-cols-[1fr_3rem_5rem_5rem] sm:gap-4">
              <span>{t("preview.description")}</span>
              <span className="text-right">{t("preview.qty")}</span>
              <span className="text-right">{t("preview.unitPrice")}</span>
              <span className="text-right">{t("preview.amount")}</span>
            </div>

            {/* Rows */}
            {items.map((item) => (
              <div key={item.id}>
                <div
                  className="grid min-w-[20rem] grid-cols-[1fr_2.5rem_auto_auto] gap-2 border-b py-2 text-xs sm:grid-cols-[1fr_3rem_5rem_5rem] sm:gap-4 sm:py-3"
                  style={{ borderColor: "#e5e5e5" }}
                >
                  <div className="min-w-0">
                    <p className="break-words">{item.description}</p>
                    {item.period && (
                      <p className="text-[0.625rem] text-gray-500">
                        {item.period}
                      </p>
                    )}
                  </div>
                  <span className="text-right">{item.qty}</span>
                  <span className="text-right">
                    {formatCurrency(item.unitPrice, currency)}
                  </span>
                  <span className="text-right">
                    {formatCurrency(lineItemTotal(item), currency)}
                  </span>
                </div>

                {/* Sub-items */}
                {item.subItems.map((sub) => (
                  <div
                    className="grid min-w-[20rem] grid-cols-[1fr_2.5rem_auto_auto] gap-2 border-b py-1.5 pl-3 text-[0.6875rem] sm:grid-cols-[1fr_3rem_5rem_5rem] sm:gap-4 sm:py-2 sm:pl-4"
                    key={sub.id}
                    style={{ borderColor: "#e5e5e5" }}
                  >
                    <span className="min-w-0 break-words text-gray-600">
                      {sub.label}
                    </span>
                    <span className="text-right">{sub.qty}</span>
                    <span className="text-right">
                      {formatCurrency(sub.unitPrice, currency)}
                    </span>
                    <span className="text-right">
                      {formatCurrency(sub.amount, currency)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Footer totals */}
        <div className="mt-4 flex justify-end sm:mt-6">
          <div className="w-full space-y-2 text-xs sm:w-64">
            <div className="flex justify-between">
              <span>{t("preview.subtotal")}</span>
              <span>{formatCurrency(subtotal, currency)}</span>
            </div>
            {taxRate > 0 && (
              <div className="flex justify-between">
                <span>
                  {t("preview.tax")} ({taxRate}%)
                </span>
                <span>{formatCurrency(tax, currency)}</span>
              </div>
            )}
            {adjustments.map((adj) => {
              const amount = calcAdjustmentAmount(adj, subtotal)
              return (
                <div className="flex justify-between" key={adj.id}>
                  <span>
                    {adj.type === "deduct" ? "\u2212" : "+"}{" "}
                    {adj.label || t("preview.adjustment")}
                    {adj.mode === "percentage" ? ` (${adj.value}%)` : ""}
                  </span>
                  <span>{formatCurrency(amount, currency)}</span>
                </div>
              )
            })}
            <div className="flex justify-between border-t pt-2">
              <span>{t("preview.total")}</span>
              <span>{formatCurrency(total, currency)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>
                {t("preview.amountDue")} ({currency})
              </span>
              <span>{formatCurrency(total, currency)}</span>
            </div>
          </div>
        </div>

        {/* Custom fields */}
        {data.customFields.length > 0 && (
          <div className="mt-4 space-y-1 text-xs sm:mt-6">
            {data.customFields.map((cf) => (
              <div
                className="grid grid-cols-[6rem_1fr] gap-2 sm:grid-cols-[8rem_1fr]"
                key={cf.id}
              >
                <span className="font-bold">{cf.label}</span>
                <span>{cf.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Notes */}
        {data.notes && (
          <div className="mt-4 text-xs sm:mt-6">
            <p className="font-bold text-gray-500">{t("preview.notes")}</p>
            <p className="mt-1 text-gray-500">{data.notes}</p>
          </div>
        )}
      </div>
    </article>
  )
}
