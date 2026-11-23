import type * as React from "react";

import { cn } from "../lib/utils";

// cursor.com table (the pricing comparison): flat, no fill behind the
// header, which is caption-role muted text; rows are 10% `border` rules (no
// zebra) that take a faint `pane` on hover, cells are body role at
// 10px × 12px, and numbers are tabular so columns line up. A selected row
// sits on `pane-2`.
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
        "[&_tr]:border-border [&_tr]:border-b [&_tr]:hover:bg-transparent",
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
        "border-border border-t text-foreground [&>tr]:last:border-b-0 [&_tr]:hover:bg-transparent",
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
        "border-border border-b transition-[background-color] duration-140 ease-standard not-data-[state=selected]:hover:bg-pane/60 has-aria-expanded:bg-pane/60 data-[state=selected]:bg-pane-2",
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
