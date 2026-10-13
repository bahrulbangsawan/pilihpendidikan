import { createFileRoute } from "@tanstack/react-router";
import type { ProfileTab } from "@/components/profile/profile-page";
import { ProfilePage } from "@/components/profile/profile-page";
import { pageTitle, requireSignedIn } from "./-guards";

const TABS: readonly ProfileTab[] = ["facts", "answers", "cvs"];

export const Route = createFileRoute("/profile")({
  validateSearch: (search: Record<string, unknown>): { tab?: ProfileTab } =>
    TABS.includes(search.tab as ProfileTab) && search.tab !== "facts"
      ? { tab: search.tab as ProfileTab }
      : {},
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "profile.title"),
  component: ProfileRoute,
});

function ProfileRoute() {
  const { tab = "facts" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProfilePage
      onTabChange={(next) =>
        navigate({
          search: next === "facts" ? {} : { tab: next },
          replace: true,
        })
      }
      tab={tab}
    />
  );
}
