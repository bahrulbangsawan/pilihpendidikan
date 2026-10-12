import type * as React from "react";

import { cn } from "../lib/utils";

// Zedative table (DESIGN.md § Implementation › Radius / Elevation): square
// and flat. The header row is caption-role muted text on a pale `pane`,
// rows are `line` hairlines (no zebra), cells are body role, and every
// number is tabular so columns line up. A selected row takes the cobalt wash.
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      className="relative w-full overflow-x-auto"
      data-slot="table-container"
    >
      <table
        className={cn(
          "type-body w-full caption-bottom text-left tabular-nums",
          className
        )}
        data-slot="table"
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn(
        "bg-pane/50 [&_tr]:border-line [&_tr]:border-b [&_tr]:hover:bg-transparent",
        className
      )}
      data-slot="table-header"
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn("[&_tr:last-child]:border-0", className)}
      data-slot="table-body"
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn(
        "weight-semibold border-line border-t bg-pane/50 text-foreground [&>tr]:last:border-b-0 [&_tr]:hover:bg-transparent",
        className
      )}
      data-slot="table-footer"
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-line border-b transition-[background-color] duration-150 ease-standard not-data-[state=selected]:hover:bg-pane/40 has-aria-expanded:bg-pane/40 data-[state=selected]:bg-wash",
        className
      )}
      data-slot="table-row"
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "type-caption h-9 whitespace-nowrap px-3 text-left align-middle text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      data-slot="table-head"
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 py-2.5 align-middle [&:has([role=checkbox])]:pr-0",
        className
      )}
      data-slot="table-cell"
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      className={cn("type-caption mt-3 text-muted-foreground", className)}
      data-slot="table-caption"
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
