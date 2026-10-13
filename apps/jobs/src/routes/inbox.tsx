import { createFileRoute } from "@tanstack/react-router";
import { useAppNavigate } from "@/components/app-link";
import { InboxPage } from "@/components/inbox/inbox-page";
import { validateInboxSearch } from "@/lib/inbox-filters";
import { pageTitle, requireSignedIn } from "./-guards";

export const Route = createFileRoute("/inbox")({
  validateSearch: validateInboxSearch,
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "pages.inbox"),
  component: InboxRoute,
});

function InboxRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const go = useAppNavigate();
  return (
    <InboxPage
      onNavigate={go}
      onSearchChange={(next) => navigate({ search: next, replace: true })}
      search={search}
    />
  );
}
