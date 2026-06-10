// ── Types ──────────────────────────────────────────────────

export interface SenderInfo {
  companyName: string
  address: string
  city: string
  kecamatan: string
  state: string
  postalCode: string
  country: string
  email: string
  logoUrl: string
}

export interface RecipientInfo {
  name: string
  address: string
  city: string
  kecamatan: string
  stateRegion: string
  postalCode: string
  country: string
  email: string
}

export interface InvoiceSubItem {
  id: string
  label: string
  qty: number
  unitPrice: number
  amount: number
}

export interface InvoiceLineItem {
  id: string
  description: string
  period: string
  qty: number
  unitPrice: number
  amount: number
  subItems: InvoiceSubItem[]
}

export interface InvoiceAdjustment {
  id: string
  label: string
  type: "add" | "deduct"
  mode: "percentage" | "fixed"
  value: number
}

export interface InvoiceCustomField {
  id: string
  label: string
  value: string
}

export interface InvoiceData {
  invoiceNumber: string
  dateOfIssue: string
  dateDue: string
  currency: string
  accentColor: string
  from: SenderInfo
  billTo: RecipientInfo
  items: InvoiceLineItem[]
  adjustments: InvoiceAdjustment[]
  customFields: InvoiceCustomField[]
  notes: string
  taxRate: number
}

// ── Currency ───────────────────────────────────────────────

const CURRENCY_LOCALE: Record<string, string> = {
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  IDR: "id-ID",
  SGD: "en-SG",
  AUD: "en-AU",
  JPY: "ja-JP",
  MYR: "ms-MY",
}

const currencyFormatters = new Map<string, Intl.NumberFormat>()

export function formatCurrency(amount: number, currency: string): string {
  const locale = CURRENCY_LOCALE[currency] ?? "en-US"
  const key = `${locale}|${currency}`
  let formatter = currencyFormatters.get(key)
  if (!formatter) {
    const fractionDigits = currency === "JPY" ? 0 : 2
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
    currencyFormatters.set(key, formatter)
  }
  return formatter.format(amount)
}

// ── Calculations ───────────────────────────────────────────

export function calcSubtotal(items: InvoiceLineItem[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0)
}

export function calcTax(subtotal: number, taxRate: number): number {
  return subtotal * (taxRate / 100)
}

export function calcAdjustmentAmount(
  adj: InvoiceAdjustment,
  subtotal: number
): number {
  const raw =
    adj.mode === "percentage" ? subtotal * (adj.value / 100) : adj.value
  return adj.type === "deduct" ? -raw : raw
}

function calcAdjustmentsTotal(
  adjustments: InvoiceAdjustment[],
  subtotal: number
): number {
  return adjustments.reduce(
    (sum, adj) => sum + calcAdjustmentAmount(adj, subtotal),
    0
  )
}

export function calcTotal(
  items: InvoiceLineItem[],
  taxRate: number,
  adjustments: InvoiceAdjustment[] = []
): number {
  const subtotal = calcSubtotal(items)
  const tax = calcTax(subtotal, taxRate)
  const adj = calcAdjustmentsTotal(adjustments, subtotal)
  return subtotal + tax + adj
}
