import { format, parse } from "date-fns"

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

// Authoritative line total: own qty × unitPrice PLUS the sum of its sub-item
// amounts. Computing from first principles (instead of trusting the stored
// `item.amount`) keeps the rendered subtotal correct even when a write path left
// a parent `amount` stale, and mirrors the mcp `invoiceLineTotal`. [defect-2]
export function lineItemTotal(item: InvoiceLineItem): number {
  const own = item.qty * item.unitPrice
  const subTotal = item.subItems.reduce((sum, sub) => sum + sub.amount, 0)
  return own + subTotal
}

export function calcSubtotal(items: InvoiceLineItem[]): number {
  return items.reduce((sum, item) => sum + lineItemTotal(item), 0)
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

// ── Dates ──────────────────────────────────────────────────
//
// Stored canonically as ISO `yyyy-MM-dd`. For display we parse the stored value
// — tolerating legacy "dd MMM yyyy" / "dd-MM-yyyy" / "MM/dd/yyyy" documents — and
// render a friendly "dd MMM yyyy". An unparseable value passes through unchanged
// so nothing is ever lost on screen. [defect-1]
const DATE_INPUT_FORMATS = [
  "yyyy-MM-dd",
  "dd MMM yyyy",
  "dd-MM-yyyy",
  "MM/dd/yyyy",
]

export function formatInvoiceDate(value: string): string {
  if (!value) {
    return ""
  }
  for (const fmt of DATE_INPUT_FORMATS) {
    const parsed = parse(value, fmt, new Date())
    if (!Number.isNaN(parsed.getTime())) {
      return format(parsed, "dd MMM yyyy")
    }
  }
  return value
}
