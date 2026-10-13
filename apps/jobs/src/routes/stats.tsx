import { createFileRoute } from "@tanstack/react-router";
import { StatsPage } from "@/components/stats/stats-page";
import { validateStatsSearch } from "@/lib/stats-range";
import { pageTitle, requireSignedIn } from "./-guards";

// The range, the series metric and the breakdown live in the URL so a view
// of the numbers can be linked and survives a reload (12 §9).
export const Route = createFileRoute("/stats")({
  validateSearch: validateStatsSearch,
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "pages.stats"),
  component: StatsRoute,
});

function StatsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <StatsPage
      onSearchChange={(next) => navigate({ search: next, replace: true })}
      search={search}
    />
  );
}
