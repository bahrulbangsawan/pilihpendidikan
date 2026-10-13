import { createFileRoute } from "@tanstack/react-router";
import { RunsPage } from "@/components/automation/runs-page";
import { validateRunsSearch } from "@/lib/runs-view";
import { pageTitle } from "./-guards";

export const Route = createFileRoute("/automation/runs")({
  validateSearch: validateRunsSearch,
  head: ({ match }) => pageTitle(match, "pages.runs"),
  component: RunsRoute,
});

function RunsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RunsPage
      onSearchChange={(next) => navigate({ search: next, replace: true })}
      search={search}
    />
  );
}
