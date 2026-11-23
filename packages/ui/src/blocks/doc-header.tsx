import type * as React from "react";
import { cn } from "../lib/utils";

// The docs-style page header of a document form (cursor.com/docs): the area
// line in muted 13px, the document title at 22px semibold and one muted 16px
// lead saying what the page does. 8px between the lines, 16px above the
// lead. The space below is the caller's (the builders' form columns keep 32px
// to the first section). Presentational: copy comes in as props.

function DocHeader({
  area,
  title,
  lead,
  className,
  titleAs: Title = "h2",
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  /** The area the page belongs to, e.g. "CV builder". */
  area?: React.ReactNode;
  title: React.ReactNode;
  /** One line under the title. */
  lead?: React.ReactNode;
  /** The title's heading level (default h2). */
  titleAs?: "h1" | "h2";
}) {
  return (
    <header
      className={cn("flex flex-col gap-2", className)}
      data-slot="doc-header"
      {...props}
    >
      {area ? (
        <p className="type-body-compact text-muted-foreground">{area}</p>
      ) : null}
      <Title className="type-display-compact weight-semibold text-foreground">
        {title}
      </Title>
      {lead ? (
        <p className="type-subtitle mt-2 text-pretty text-muted-foreground">
          {lead}
        </p>
      ) : null}
    </header>
  );
}

export { DocHeader };
