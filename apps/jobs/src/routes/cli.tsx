import { createFileRoute } from "@tanstack/react-router";
import { CliPage } from "@/components/cli/cli-page";
import { pageTitle, requireSignedIn } from "./-guards";

export const Route = createFileRoute("/cli")({
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "pages.cli"),
  component: CliPage,
});
