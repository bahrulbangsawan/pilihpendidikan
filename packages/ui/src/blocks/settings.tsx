import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { PAGE_GUTTER } from "./page";

// Settings building blocks (reui's profile and settings blocks):
// - `SubNavLayout`: a page title + description, a left sub-nav (a row of
//   tabs on phones) and the content column.
// - `SettingsCard`: one 8px card (a single border) with a title /
//   description header, rows split by hairlines and an optional footer
//   (Cancel / Save) under a rule; `tone="destructive"` for a danger zone.
//   The content column holds to 640px so rows never stretch thin.
// - `SettingsRow`: label + a one-line description, then the control; stacked
//   on phones. A field (`control="fill"`) sits on a 2 / 3 grid at full
//   width; a switch or a button (`control="end"`) keeps its size at the
//   right and the label takes the rest. Optional icon tile and badge.
// - `SectionCard`: a lighter titled card (a label row, then free content);
//   `flat` drops the box for a section inside a sheet or a panel, where
//   hairlines and 24px of space separate sections instead of borders.

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
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Accessible name of the sub-nav. */
  label: string;
  items: readonly SubNavItem<T>[];
  value: T;
  onChange: (value: T) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("flex w-full max-w-6xl flex-col gap-6 pt-6", PAGE_GUTTER)}
      data-slot="sub-nav-layout"
    >
      <div className="flex flex-col gap-1">
        <h1 className="type-title text-foreground">{title}</h1>
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
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "h-8 w-full justify-start gap-2.5 rounded-md px-2.5",
                      current
                        ? "border-border bg-pane-2 text-foreground hover:bg-pane-2"
                        : "text-ink-sec hover:text-foreground"
                    )}
                    onClick={() => onChange(item.value)}
                    variant="ghost"
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        current ? "text-foreground" : "text-muted-foreground"
                      )}
                    />
                    {item.label}
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
        "flex flex-col overflow-hidden rounded-lg border bg-card",
        tone === "destructive" ? "border-destructive/25" : "border-border"
      )}
      data-slot="settings-card"
      data-tone={tone}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-4">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <h2 className="type-subtitle text-foreground" id={id}>
            {title}
          </h2>
          {description ? (
            <p className="type-caption text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div
        className={cn(
          "flex flex-col border-border border-t",
          inset ? "divide-y divide-border" : "p-5"
        )}
        data-slot="settings-card-body"
      >
        {children}
      </div>
      {footer ? (
        <div
          className="flex items-center justify-end gap-2 border-border border-t bg-pane/40 px-5 py-3"
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
        "gap-3 px-5 py-4 sm:gap-6",
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
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-pane text-muted-foreground"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Label
              className="type-body text-foreground"
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
  action,
  children,
  className,
  flat = false,
}: {
  id: string;
  title: React.ReactNode;
  /** A control at the end of the title row. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** No border or fill: a section of a sheet, split from the next by a rule. */
  flat?: boolean;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col gap-3",
        !flat && "rounded-lg border border-border bg-card p-4",
        className
      )}
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

export { SectionCard, SettingsCard, SettingsRow, SubNavLayout };
export type { SubNavItem };
