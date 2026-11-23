import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { PAGE_GUTTER } from "./page";

// Settings building blocks (reui's profile and settings blocks):
// - `SubNavLayout`: a page title + description, a left sub-nav (a row of
//   tabs on phones) and the content column. With `hrefOf` the items are
//   anchor links (a page of stacked sections; the app reports the section
//   in view as `value`); the current item gets a 1px border.
// - `SettingsCard`: reui's nested frame. An outer 12px frame (`card`, a 10%
//   border, 4px padding) carries the title / description header and the
//   footer (Cancel left, Save right); the rows sit in an inner 8px panel
//   (12 − 4, so the corners nest) one step darker on `background`, split by
//   hairlines. `tone="destructive"` for a danger zone. The content column
//   holds to 640px so rows never stretch thin.
// - `SettingsRow`: label + a one-line description, then the control; stacked
//   on phones. A field (`control="fill"`) sits on a 2 / 3 grid at full
//   width; a switch or a button (`control="end"`) keeps its size at the
//   right and the label takes the rest. Optional icon tile and badge.
// - `SectionCard`: the same nested frame for free content (the title row on
//   the frame, the content padded in the inner panel); `flat` drops both
//   boxes for a section inside a sheet or a panel, where hairlines and 24px
//   of space separate sections instead of borders.

interface SubNavItem<T extends string> {
  icon: LucideIcon;
  label: string;
  value: T;
}

function SubNavLayout<T extends string>({
  title,
  description,
  label,
  items,
  value,
  onChange,
  hrefOf,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Accessible name of the sub-nav. */
  label: string;
  items: readonly SubNavItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Anchor links: the `href` of each item (e.g. `#settings-ai`). */
  hrefOf?: (value: T) => string;
  children: React.ReactNode;
}) {
  const currentKind = hrefOf ? "location" : "page";
  return (
    <div
      className={cn("flex w-full max-w-6xl flex-col gap-6 pt-6", PAGE_GUTTER)}
      data-slot="sub-nav-layout"
    >
      <div className="flex flex-col gap-1">
        <h1 className="type-title-compact weight-semibold text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="type-body max-w-2xl text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <nav
          aria-label={label}
          className="no-scrollbar max-lg:mask-r-from-85% -mx-1 overflow-x-auto px-1 lg:sticky lg:top-16 lg:mx-0 lg:w-48 lg:shrink-0 lg:overflow-visible lg:px-0"
        >
          <ul className="flex gap-1 lg:flex-col">
            {items.map((item) => {
              const current = item.value === value;
              const Icon = item.icon;
              return (
                <li key={item.value}>
                  <Button
                    aria-current={current ? currentKind : undefined}
                    asChild={Boolean(hrefOf)}
                    className={cn(
                      "h-8 w-full justify-start gap-2.5 rounded-md px-2.5",
                      current
                        ? "border-border bg-pane-2 text-foreground hover:bg-pane-2"
                        : "text-ink-sec hover:text-foreground"
                    )}
                    onClick={(event) => {
                      if (hrefOf) {
                        event.preventDefault();
                      }
                      onChange(item.value);
                    }}
                    variant="ghost"
                  >
                    {hrefOf ? (
                      <a href={hrefOf(item.value)}>
                        <Icon
                          aria-hidden="true"
                          className={cn(
                            "size-4 shrink-0",
                            current
                              ? "text-foreground"
                              : "text-muted-foreground"
                          )}
                        />
                        {item.label}
                      </a>
                    ) : (
                      <>
                        <Icon
                          aria-hidden="true"
                          className={cn(
                            "size-4 shrink-0",
                            current
                              ? "text-foreground"
                              : "text-muted-foreground"
                          )}
                        />
                        {item.label}
                      </>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex w-full min-w-0 max-w-160 flex-1 flex-col gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}

/** The outer frame: 12px corners, a 10% border, 4px around the panel. */
const FRAME_CLASS =
  "flex min-w-0 flex-col rounded-xl border border-border bg-card p-1";

/** The inner panel: 8px corners (12 − 4), one step darker than the frame. */
const PANEL_CLASS =
  "flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background";

function FrameHeader({
  id,
  children,
  description,
  action,
}: {
  id: string;
  children: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-3 pt-2.5 pb-3"
      data-slot="frame-header"
    >
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <h2 className="type-body weight-semibold text-foreground" id={id}>
          {children}
        </h2>
        {description ? (
          <p className="type-body text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function SettingsCard({
  id,
  title,
  description,
  action,
  footer,
  children,
  tone = "default",
  inset = true,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A control in the header's right corner (e.g. "Add"). */
  action?: React.ReactNode;
  /** Card footer: Cancel / Save. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "destructive";
  /** Rows split by hairlines (true); false pads free content (tables, forms). */
  inset?: boolean;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        FRAME_CLASS,
        tone === "destructive" && "border-destructive/25"
      )}
      data-slot="settings-card"
      data-tone={tone}
    >
      <FrameHeader action={action} description={description} id={id}>
        {title}
      </FrameHeader>
      <div
        className={cn(PANEL_CLASS, inset ? "divide-y divide-border" : "p-4")}
        data-slot="settings-card-body"
      >
        {children}
      </div>
      {footer ? (
        <div
          className="flex items-center justify-end gap-2 px-3 pt-3 pb-2 [&>:first-child:not(:only-child)]:mr-auto"
          data-slot="settings-card-footer"
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}

function SettingsRow({
  label,
  description,
  htmlFor,
  icon: Icon,
  badge,
  children,
  align = "center",
  control = "fill",
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** The control's id, so the label is its <label>. */
  htmlFor?: string;
  icon?: LucideIcon;
  badge?: React.ReactNode;
  /** The control. */
  children?: React.ReactNode;
  /** `start` for tall controls (lists, text areas). */
  align?: "center" | "start";
  /** `fill` stretches the control across its column (fields, selects);
   * `end` keeps it at its own size at the right (a switch, a button). */
  control?: "fill" | "end";
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div
      className={cn(
        "gap-3 px-4 py-3.5 sm:gap-6",
        control === "fill"
          ? "grid grid-cols-1 sm:grid-cols-5"
          : "flex flex-col sm:flex-row sm:justify-between",
        align === "center" ? "sm:items-center" : "sm:items-start"
      )}
      data-control={control}
      data-slot="settings-row"
    >
      <div
        className={cn(
          "flex min-w-0 items-start gap-3",
          control === "fill" ? "sm:col-span-2" : "sm:flex-1"
        )}
      >
        {Icon ? (
          <span
            aria-hidden="true"
            className="flex size-8.5 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-ink-sec"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Label
              className="type-body weight-semibold text-foreground"
              {...(htmlFor ? { htmlFor } : {})}
            >
              {label}
            </Label>
            {badge}
          </div>
          {description ? (
            <p className="type-caption text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children ? (
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            control === "end" ? "shrink-0" : "*:w-full sm:col-span-3"
          )}
          data-slot="settings-row-control"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function SectionCard({
  id,
  title,
  description,
  action,
  children,
  className,
  frameClassName,
  flat = false,
}: {
  id: string;
  title: React.ReactNode;
  /** A muted line under the title (framed cards only). */
  description?: React.ReactNode;
  /** A control at the end of the title row. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Classes of the content: the inner panel, or the section when `flat`. */
  className?: string;
  /** Classes of the outer frame (e.g. `h-full` in a grid). */
  frameClassName?: string;
  /** No border or fill: a section of a sheet, split from the next by a rule. */
  flat?: boolean;
}) {
  if (flat) {
    return (
      <section
        aria-labelledby={id}
        className={cn("flex flex-col gap-3", className)}
        data-flat={flat}
        data-slot="section-card"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="type-body weight-semibold text-foreground" id={id}>
            {title}
          </h2>
          {action}
        </div>
        {children}
      </section>
    );
  }
  return (
    <section
      aria-labelledby={id}
      className={cn(FRAME_CLASS, frameClassName)}
      data-flat={flat}
      data-slot="section-card"
    >
      <FrameHeader action={action} description={description} id={id}>
        {title}
      </FrameHeader>
      <div className={cn(PANEL_CLASS, "flex-1 gap-3 p-4", className)}>
        {children}
      </div>
    </section>
  );
}

export { SectionCard, SettingsCard, SettingsRow, SubNavLayout };
export type { SubNavItem };
