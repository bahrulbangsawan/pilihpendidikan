import { createFileRoute } from "@tanstack/react-router";
import { InvoiceGenerator } from "@/components/invoice-generator";
import { headForLocale } from "@/i18n";

const BASE_URL = "https://invoice.bahrul.me";

export const Route = createFileRoute("/id")({
  head: () => headForLocale("id", BASE_URL),
  component: InvoiceGenerator,
});
