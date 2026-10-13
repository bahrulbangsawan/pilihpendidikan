import type { CVStyle } from "@pilihpendidikan/cv-engine/types";
import { createFileRoute } from "@tanstack/react-router";
import { CVGenerator } from "@/components/cv-generator";
import { headForLocale } from "@/i18n";

const BASE_URL = "https://cv.pilihpendidikan.com";

export const Route = createFileRoute("/id")({
  head: () => headForLocale("id", BASE_URL),
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>
  ): { id?: string; cv?: string; print?: true; template?: CVStyle } => ({
    // `?id=` is the canonical edit param; the legacy `?cv=` stays a working alias.
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
