// The board's search on phones: a search icon button in the top bar (the
// header row has no room for a field) that opens the same `/` field inline
// under the title, focused. The field stays open while it holds a query.

import { Button } from "@rulisme/ui/ui/button";
import { Search } from "lucide-react";
import { useState } from "react";
import { TopBarActions } from "@/components/shell/top-bar";
import { useTranslation } from "@/i18n";
import { BoardSearchField } from "./board-toolbar";

interface SearchProps {
  query: string;
  onQueryChange: (q: string) => void;
  /** Below 640px: the phone layout. */
  phone: boolean;
}

/** The header row's compact `/` field, on tablets and desktops only. */
export function DesktopSearch({ query, onQueryChange, phone }: SearchProps) {
  return phone ? null : (
    <BoardSearchField onQueryChange={onQueryChange} query={query} />
  );
}

export function PhoneSearch({ query, onQueryChange, phone }: SearchProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!phone) {
    return null;
  }
  const shown = open || query !== "";
  return (
    <>
      <TopBarActions>
        <Button
          aria-expanded={shown}
          aria-label={t("board.search")}
          onClick={() => setOpen((value) => !value || query !== "")}
          size="icon-sm"
          variant="ghost"
        >
          <Search aria-hidden="true" />
        </Button>
      </TopBarActions>
      {shown ? (
        <BoardSearchField
          autoFocus={open}
          onQueryChange={onQueryChange}
          query={query}
        />
      ) : null}
    </>
  );
}
