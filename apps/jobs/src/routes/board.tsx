import { SOURCE_KINDS } from "@pilihpendidikan/jobs-contracts/enums";
import { createFileRoute } from "@tanstack/react-router";
import type { BoardSearch } from "@/components/board/board-search";
import { BOARD_VIEWS } from "@/components/board/board-search";
import { BoardPage } from "@/components/board/board-page";
import { pageTitle, requireSignedIn } from "./-guards";

const APP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const flag = (value: unknown): 1 | undefined =>
  value === 1 || value === "1" ? 1 : undefined;

/** Board filters, the view mode and the open application live in the URL so
 * any of them can be linked (10 §8). */
export function validateBoardSearch(
  search: Record<string, unknown>
): BoardSearch {
  const days = Number(search.noResponse);
  const result: BoardSearch = {};
  if (typeof search.q === "string" && search.q.length <= 200) {
    result.q = search.q;
  }
  if (
    search.view !== "board" &&
    (BOARD_VIEWS as readonly unknown[]).includes(search.view)
  ) {
    result.view = search.view as BoardSearch["view"];
  }
  if (typeof search.app === "string" && APP_ID_RE.test(search.app)) {
    result.app = search.app;
  }
  if ((SOURCE_KINDS as readonly unknown[]).includes(search.source)) {
    result.source = search.source as BoardSearch["source"];
  }
  if (Number.isInteger(days) && days > 0 && days <= 365) {
    result.noResponse = days;
  }
  for (const key of ["archived", "attention", "due", "priority"] as const) {
    if (flag(search[key])) {
      result[key] = 1;
    }
  }
  return result;
}

export const Route = createFileRoute("/board")({
  validateSearch: validateBoardSearch,
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "board.title"),
  component: BoardRoute,
});

function BoardRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <BoardPage
      onSearchChange={(next) => navigate({ search: next, replace: true })}
      search={search}
    />
  );
}
