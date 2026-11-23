import { createFileRoute } from "@tanstack/react-router";
import type { SettingsSection } from "@/components/settings/settings-page";
import {
  SETTINGS_SECTIONS,
  SettingsPage,
} from "@/components/settings/settings-page";
import { pageTitle, requireSignedIn } from "./-guards";

export const Route = createFileRoute("/settings")({
  validateSearch: (
    search: Record<string, unknown>
  ): { section?: SettingsSection } =>
    SETTINGS_SECTIONS.includes(search.section as SettingsSection) &&
    search.section !== "account"
      ? { section: search.section as SettingsSection }
      : {},
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "settings.title"),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { section = "account" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SettingsPage
      onSectionChange={(next) =>
        navigate({
          search: next === "account" ? {} : { section: next },
          replace: true,
        })
      }
      section={section}
    />
  );
}
