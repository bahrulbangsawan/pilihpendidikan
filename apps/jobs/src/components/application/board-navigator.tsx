// The board beside an open application on wide screens (12 §3: "on ≥ 1280px
// a Resizable split keeps the board visible on the left"): the open columns
// as compact lists, the current card marked by fill and weight, not colour.

import { cn } from "@rulisme/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useBoard } from "@/hooks/use-board";
import { useTranslation } from "@/i18n";
import { BOARD_STAGES } from "@/lib/board-model";
import { POLL_POLICIES } from "@/lib/polling";
import { stageLabel } from "@/lib/labels";

export function BoardNavigator({ currentId }: { currentId: string }) {
  const { t } = useTranslation();
  const { columns } = useBoard({ policy: POLL_POLICIES.shell });
  return (
    <nav
      aria-label={t("detail.boardNav")}
      className="flex h-full flex-col overflow-y-auto bg-card"
    >
      <div className="band px-4 py-2">
        <Link
          className="type-body-compact weight-semibold text-foreground hover:underline"
          to="/board"
        >
          {t("board.title")}
        </Link>
      </div>
      {BOARD_STAGES.map((stage) => {
        const cards = columns?.[stage] ?? [];
        if (cards.length === 0) {
          return null;
        }
        return (
          <section
            aria-labelledby={`nav-${stage}`}
            className="band py-1.5"
            key={stage}
          >
            <h2
              className="type-caption flex justify-between px-4 py-1 text-muted-foreground"
              id={`nav-${stage}`}
            >
              {stageLabel(t, stage)}
              <span className="type-micro tabular-nums">{cards.length}</span>
            </h2>
            <ul>
              {cards.map((card) => {
                const current = card.id === currentId;
                return (
                  <li key={card.id}>
                    <Link
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "type-body-compact flex flex-col px-4 py-1 text-foreground transition-colors hover:bg-pane/70",
                        current && "weight-semibold bg-pane-2"
                      )}
                      params={{ appId: card.id }}
                      to="/applications/$appId"
                    >
                      <span className="truncate">{card.posting.title}</span>
                      <span className="type-caption truncate text-muted-foreground">
                        {card.posting.company_name}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
