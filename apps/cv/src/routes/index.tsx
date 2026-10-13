import type { CVStyle } from "@pilihpendidikan/cv-engine/types";
import { createFileRoute } from "@tanstack/react-router";
import { CVGenerator } from "@/components/cv-generator";
import { headForLocale } from "@/i18n";

const BASE_URL = "https://cv.pilihpendidikan.com";

export const Route = createFileRoute("/")({
  head: () => headForLocale("en", BASE_URL),
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>
  ): { id?: string; cv?: string; print?: true; template?: CVStyle } => ({
    // `?id=` is the canonical edit param across cv/invoice/portfolio; the legacy
    // `?cv=` is kept as a working alias. The component resolves id ?? cv.
    id: (search.id as string) || undefined,
    cv: (search.cv as string) || undefined,
    print:
      search.print === "1" ||
      search.print === 1 ||
      search.print === true ||
      undefined,
    template: (search.template as CVStyle) || undefined,
  }),
});

function RouteComponent() {
  const { id, cv, print, template } = Route.useSearch();
  return <CVGenerator cvId={id ?? cv} print={print} template={template} />;
}
