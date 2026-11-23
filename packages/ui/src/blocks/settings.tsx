import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { PAGE_GUTTER } from "./page";

// Settings building blocks (reui's profile and settings blocks):
// - `SubNavLayout`: a page title + description, a left sub-nav (a row of
//   tabs on phones) and the content column.
// - `SettingsCard`: an 8px card with a title / description header, an inset
//   box of rows and an optional footer (Cancel / Save); `tone="destructive"`
//   for a danger zone.
// - `SettingsRow`: label + description on the left, the control on the
//   right (stacked on phones), an optional icon tile and badge.
// - `SectionCard`: a lighter titled card (a label row, then free content).

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
          className="no-scrollbar -mx-1 overflow-x-auto px-1 lg:sticky lg:top-16 lg:mx-0 lg:w-48 lg:shrink-0 lg:overflow-visible lg:px-0"
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
        <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
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
  /** Rows sit in an inset box; false for free content (tables, forms). */
  inset?: boolean;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col rounded-lg border bg-card p-1",
        tone === "destructive" ? "border-destructive/25" : "border-border"
      )}
      data-slot="settings-card"
      data-tone={tone}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3 pb-3">
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
          "flex flex-col",
          inset &&
            "divide-y divide-border rounded-md border border-border bg-background"
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
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
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:justify-between sm:gap-6",
        align === "center" ? "sm:items-center" : "sm:items-start"
      )}
      data-slot="settings-row"
    >
      <div className="flex min-w-0 items-start gap-3 sm:max-w-[55%] sm:flex-1">
        {Icon ? (
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
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
        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:w-[45%] sm:max-w-80 sm:justify-end">
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
}: {
  id: string;
  title: React.ReactNode;
  /** A control at the end of the title row. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
        className
      )}
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
