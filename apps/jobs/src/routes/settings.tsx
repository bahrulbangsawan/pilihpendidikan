import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/settings/settings-page";
import { pageTitle, requireSignedIn } from "./-guards";

export const Route = createFileRoute("/settings")({
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "settings.title"),
  component: SettingsPage,
});
