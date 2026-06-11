import { createFileRoute } from "@tanstack/react-router"
import { InvoiceGenerator } from "@/components/invoice-generator"
import { headForLocale } from "@/i18n"

const BASE_URL = "https://invoice.bahrul.me"

export const Route = createFileRoute("/")({
  head: () => headForLocale("en", BASE_URL),
  component: InvoiceGenerator,
  validateSearch: (
    search: Record<string, unknown>
  ): { id?: string; invoice?: string; print?: true } => ({
    // `?id=` is the canonical edit param across cv/invoice/portfolio; the legacy
    // `?invoice=` is kept as a working alias. InvoiceGenerator resolves id ?? invoice.
    id: (search.id as string) || undefined,
    invoice: (search.invoice as string) || undefined,
    print:
      search.print === "1" ||
      search.print === 1 ||
      search.print === true ||
      undefined,
  }),
})
