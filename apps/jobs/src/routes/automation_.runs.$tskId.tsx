// biome-ignore-all lint/style/useFilenamingConvention: TanStack route params are `$camelCase` in the file name.
import { createFileRoute } from "@tanstack/react-router";
import { RunMonitorPage } from "@/components/automation/run-monitor-page";
import { pageTitle, requireSignedIn } from "./-guards";

// `automation_` un-nests the monitor from the tabbed /automation layout: it
// is its own page (12 §6.3) under the same URL prefix.
export const Route = createFileRoute("/automation_/runs/$tskId")({
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "pages.monitor"),
  component: RunMonitorRoute,
});

function RunMonitorRoute() {
  const { tskId } = Route.useParams();
  return <RunMonitorPage key={tskId} taskId={tskId} />;
}
