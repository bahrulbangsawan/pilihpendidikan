import type * as React from "react";
import { cn } from "../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

// Kanban primitives (reui's kanban, Linear's board): they only render, so
// an app keeps its own drag and drop (dnd-kit refs, listeners and data go
// on these elements through `ref` and props).
// - `Kanban`: the horizontally scrolling row of columns.
// - `KanbanColumn`: a 288px lane: a bounded `card` fill, a 10% border and
//   8px corners; cards sit on it in the lighter `pane`.
// - `KanbanColumnHeader`: a 44px header: status icon, title, count badge,
//   actions at the end.
// - `KanbanColumnContent`: the droppable body; `state="over"` washes it,
//   `state="blocked"` tints it red (a move that is not allowed).
// - `KanbanColumnEmpty`: the dashed placeholder of an empty lane.
// - `KanbanCard`: the card surface (8px, its own border, 12px padding and
//   12px between blocks); `selected`, `pending`, `muted`, `dashed`.
// - `KanbanCollapsedColumn`: a 44px strip with the title set vertically, a
//   row button that expands it, still a drop target.

type DropState = "idle" | "over" | "blocked";

function Kanban({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 items-stretch gap-3 overflow-x-auto pb-2",
        className
      )}
      data-slot="kanban"
      {...props}
    />
  );
}

function KanbanColumn({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "relative flex max-h-full w-72 shrink-0 flex-col rounded-lg border border-border bg-card",
        className
      )}
      data-slot="kanban-column"
      {...props}
    />
  );
}

function KanbanColumnHeader({
  className,
  icon,
  title,
  titleId,
  count,
  countLabel,
  actions,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** Id of the heading, for the column's `aria-labelledby`. */
  titleId?: string;
  count?: number;
  /** Screen-reader text for the count, e.g. "4 applications". */
  countLabel?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 pr-2 pl-3",
        className
      )}
      data-slot="kanban-column-header"
      {...props}
    >
      {icon}
      <h2
        className="type-body weight-semibold truncate text-foreground"
        id={titleId}
      >
        {title}
      </h2>
      {count === undefined ? null : (
        <Badge className="tabular-nums" variant="secondary">
          {countLabel ? <span className="sr-only">{countLabel}</span> : null}
          <span aria-hidden={countLabel ? true : undefined}>{count}</span>
        </Badge>
      )}
      {actions ? <span className="ml-auto">{actions}</span> : null}
    </header>
  );
}

function KanbanColumnContent({
  className,
  state = "idle",
  ...props
}: React.ComponentProps<"div"> & { state?: DropState }) {
  return (
    <div
      className={cn(
        "flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-b-lg px-2 pb-2 transition-colors duration-140 ease-standard data-[state=blocked]:cursor-not-allowed data-[state=blocked]:bg-destructive/5 data-[state=over]:bg-wash",
        className
      )}
      data-slot="kanban-column-content"
      data-state={state}
      {...props}
    />
  );
}

function KanbanColumnEmpty({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "type-caption rounded-lg border border-border border-dashed px-3 py-6 text-center text-muted-foreground",
        className
      )}
      data-slot="kanban-column-empty"
      {...props}
    />
  );
}

function KanbanCard({
  className,
  selected = false,
  pending = false,
  muted = false,
  dashed = false,
  ...props
}: React.ComponentProps<"div"> & {
  selected?: boolean;
  /** A change is saving: dimmed. */
  pending?: boolean;
  /** Low priority: slightly dimmed. */
  muted?: boolean;
  /** Archived: a dashed border. */
  dashed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-pane p-3 text-left transition-colors duration-140 ease-standard hover:bg-pane-2 data-selected:border-line data-selected:bg-pane-3 data-selected:hover:bg-pane-3",
        muted && "opacity-75",
        dashed && "border-dashed",
        pending && "opacity-70",
        className
      )}
      data-pending={pending || undefined}
      data-selected={selected || undefined}
      data-slot="kanban-card"
      {...props}
    />
  );
}

function KanbanCollapsedColumn({
  className,
  icon,
  title,
  count,
  expandLabel,
  onExpand,
  state = "idle",
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  count: number;
  /** Accessible name of the expand button, e.g. "Expand Rejected (12)". */
  expandLabel: string;
  onExpand: () => void;
  state?: DropState;
}) {
  return (
    <section
      className={cn(
        "relative flex w-11 shrink-0 flex-col rounded-lg border border-border bg-card transition-colors duration-140 ease-standard data-[state=blocked]:cursor-not-allowed data-[state=blocked]:bg-destructive/5 data-[state=over]:bg-wash",
        className
      )}
      data-slot="kanban-collapsed-column"
      data-state={state}
      {...props}
    >
      <Button
        aria-expanded={false}
        aria-label={expandLabel}
        className="h-full! flex-col items-center justify-start gap-3 rounded-lg px-0! py-3"
        onClick={onExpand}
        variant="row"
      >
        {icon}
        <span className="type-body weight-semibold text-foreground [writing-mode:vertical-rl]">
          {title}
        </span>
        <span className="type-caption text-muted-foreground tabular-nums">
          {count}
        </span>
      </Button>
      {children}
    </section>
  );
}

export {
  Kanban,
  KanbanCard,
  KanbanCollapsedColumn,
  KanbanColumn,
  KanbanColumnContent,
  KanbanColumnEmpty,
  KanbanColumnHeader,
};
export type { DropState };
