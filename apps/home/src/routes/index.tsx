import { createFileRoute } from "@tanstack/react-router";
import { HubPage } from "@/components/hub-page";
import { SERVICES } from "@/config/services";
import { headForLocale } from "@/i18n";

export const Route = createFileRoute("/")({
  head: () => headForLocale("en"),
  component: RouteComponent,
});

function RouteComponent() {
  return <HubPage services={SERVICES} />;
}
