import { isId } from "@pilihpendidikan/jobs-contracts/ids";
import { createFileRoute } from "@tanstack/react-router";
import type { ApprovalsSearch } from "@/components/automation/approvals-page";
import { ApprovalsPage } from "@/components/automation/approvals-page";
import { pageTitle } from "./-guards";

/** `?approval=apr_…` preselects an approval; `?view=decided` the history. */
export function validateApprovalsSearch(
  search: Record<string, unknown>
): ApprovalsSearch {
  const result: ApprovalsSearch = {};
  if (typeof search.approval === "string" && isId("apr", search.approval)) {
    result.approval = search.approval;
  }
  if (search.view === "decided") {
    result.view = "decided";
  }
  return result;
}

export const Route = createFileRoute("/automation/")({
  validateSearch: validateApprovalsSearch,
  head: ({ match }) => pageTitle(match, "pages.approvals"),
  component: ApprovalsRoute,
});

function ApprovalsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ApprovalsPage
      onSearchChange={(next) => navigate({ search: next, replace: true })}
      search={search}
    />
  );
}
