import { createFileRoute } from "@tanstack/react-router";
import { RulesPage } from "@/components/automation/rules-page";
import { pageTitle } from "./-guards";

export const Route = createFileRoute("/automation/rules")({
  head: ({ match }) => pageTitle(match, "pages.rules"),
  component: RulesPage,
});
