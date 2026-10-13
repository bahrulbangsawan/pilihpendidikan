import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "@/components/sources/sources-page";
import { pageTitle, requireSignedIn } from "./-guards";

export const Route = createFileRoute("/sources")({
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "pages.sources"),
  component: SourcesPage,
});
