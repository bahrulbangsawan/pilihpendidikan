// biome-ignore-all lint/style/useFilenamingConvention: TanStack route params are `$camelCase` in the file name.
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@rulisme/ui/ui/resizable";
import { createFileRoute } from "@tanstack/react-router";
import { ApplicationPage } from "@/components/application/application-page";
import { BoardNavigator } from "@/components/application/board-navigator";
import { useMediaQuery, WIDE_QUERY } from "@/hooks/use-media-query";
import { pageTitle, requireSignedIn } from "./-guards";

export const Route = createFileRoute("/applications/$appId")({
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "detail.pageTitle"),
  component: ApplicationRoute,
});

function ApplicationRoute() {
  const { appId } = Route.useParams();
  const wide = useMediaQuery(WIDE_QUERY);
  const page = <ApplicationPage appId={appId} key={appId} />;
  if (!wide) {
    return page;
  }
  return (
    <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
      <ResizablePanel defaultSize="20%" maxSize="40%" minSize="14%">
        <BoardNavigator currentId={appId} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="80%" minSize="50%">
        <div className="flex h-full flex-col overflow-y-auto">{page}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
