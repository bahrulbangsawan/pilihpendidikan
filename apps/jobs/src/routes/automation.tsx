import { createFileRoute } from "@tanstack/react-router";
import { AutomationLayout } from "@/components/automation/automation-layout";
import { pageTitle, requireSignedIn } from "./-guards";

export const Route = createFileRoute("/automation")({
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "pages.automation"),
  component: AutomationLayout,
});
