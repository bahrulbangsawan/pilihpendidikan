import { createFileRoute } from "@tanstack/react-router"
import { PortfolioGenerator } from "@/components/portfolio-generator"
import { headForLocale } from "@/i18n"

const BASE_URL = "https://portfolio.bahrul.me"

export const Route = createFileRoute("/id")({
  head: () => headForLocale("id", BASE_URL),
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>
  ): { id?: string; portfolio?: string; print?: true; template?: string } => ({
    // `?id=` is the canonical edit param; the legacy `?portfolio=` stays a working alias.
    id: (search.id as string) || undefined,
    portfolio: (search.portfolio as string) || undefined,
    print:
      search.print === "1" ||
      search.print === 1 ||
      search.print === true ||
      undefined,
    template: (search.template as string) || undefined,
  }),
})

function RouteComponent() {
  const { id, portfolio, print } = Route.useSearch()
  return <PortfolioGenerator portfolioId={id ?? portfolio} print={print} />
}
