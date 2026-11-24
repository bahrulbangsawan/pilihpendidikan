// biome-ignore-all lint/style/useFilenamingConvention: TanStack route params are `$camelCase` in the file name.
import { createFileRoute } from "@tanstack/react-router";
import { ApplicationPage } from "@/components/application/application-page";
import type { DetailTab } from "@/components/application/next-step-rail";
import { DETAIL_TABS } from "@/components/application/next-step-rail";
import { pageTitle, requireSignedIn } from "./-guards";

interface ApplicationSearch {
  /** The open tab; absent means Overview. */
  tab?: Exclude<DetailTab, "overview">;
}

/** The tab lives in the URL so a tab can be linked (`?tab=interviews`). */
export function validateApplicationSearch(
  search: Record<string, unknown>
): ApplicationSearch {
  return search.tab !== "overview" &&
    (DETAIL_TABS as readonly unknown[]).includes(search.tab)
    ? { tab: search.tab as ApplicationSearch["tab"] }
    : {};
}

export const Route = createFileRoute("/applications/$appId")({
  validateSearch: validateApplicationSearch,
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "detail.pageTitle"),
  component: ApplicationRoute,
});

function ApplicationRoute() {
  const { appId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ApplicationPage
      appId={appId}
      key={appId}
      onTabChange={(next) =>
        navigate({
          search: next === "overview" ? {} : { tab: next },
          replace: true,
        })
      }
      tab={tab ?? "overview"}
    />
  );
}
