// The 48px bar over the content column (reui app-shell): the phone menu
// button, a breadcrumb on the left and a slot for page actions on the right.
//
// Screens shape it while they are mounted:
// - `useBreadcrumbs([{ label, href? }, …])` replaces the breadcrumb derived
//   from the URL (the last crumb is the current page and never a link);
// - `<TopBarActions>` portals its children into the right slot.

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@rulisme/ui/ui/breadcrumb";
import { Button } from "@rulisme/ui/ui/button";
import { useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import {
  createContext,
  Fragment,
  use,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AppLink } from "@/components/app-link";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";

export interface Crumb {
  /** A link for every crumb but the last. */
  href?: string;
  label: string;
}

interface TopBarState {
  setActionsSlot: (element: HTMLElement | null) => void;
  actionsSlot: HTMLElement | null;
  crumbs: readonly Crumb[] | null;
  setCrumbs: (crumbs: readonly Crumb[] | null) => void;
}

const TopBarContext = createContext<TopBarState | null>(null);

export function TopBarProvider({ children }: { children: ReactNode }) {
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [crumbs, setCrumbs] = useState<readonly Crumb[] | null>(null);
  const value = useMemo(
    () => ({ actionsSlot, setActionsSlot, crumbs, setCrumbs }),
    [actionsSlot, crumbs]
  );
  return <TopBarContext value={value}>{children}</TopBarContext>;
}

/** Replaces the top bar's breadcrumb while the caller is mounted. */
export function useBreadcrumbs(crumbs: readonly Crumb[] | null) {
  const setCrumbs = use(TopBarContext)?.setCrumbs;
  const key = crumbs
    ? crumbs
        .map((crumb) => `${crumb.label}\u0000${crumb.href ?? ""}`)
        .join("\u0001")
    : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `crumbs` (a new array every render).
  useEffect(() => {
    if (!(setCrumbs && crumbs)) {
      return;
    }
    setCrumbs(crumbs);
    return () => setCrumbs(null);
  }, [key, setCrumbs]);
}

/** Renders its children in the top bar's right slot. */
export function TopBarActions({ children }: { children: ReactNode }) {
  const slot = use(TopBarContext)?.actionsSlot;
  return slot ? createPortal(children, slot) : null;
}

const PROFILE_TABS = new Set(["facts", "answers", "cvs"]);
const SETTINGS_SECTIONS = new Set(["account", "language", "ai", "data"]);

/** The breadcrumb a path gets when its screen sets none. */
export function crumbsForLocation(
  t: Translate,
  pathname: string,
  search: Record<string, unknown>
): Crumb[] {
  if (pathname.startsWith("/applications/")) {
    return [
      { label: t("nav.board"), href: "/board" },
      { label: t("nav.application") },
    ];
  }
  if (pathname.startsWith("/profile")) {
    const tab = typeof search.tab === "string" ? search.tab : "facts";
    return [
      { label: t("nav.profile"), href: "/profile" },
      {
        label: t(`profile.tabs.${PROFILE_TABS.has(tab) ? tab : "facts"}`),
      },
    ];
  }
  if (pathname.startsWith("/settings")) {
    const section =
      typeof search.section === "string" ? search.section : "account";
    return [
      { label: t("nav.settings"), href: "/settings" },
      {
        label: t(
          `settings.sections.${SETTINGS_SECTIONS.has(section) ? section : "account"}`
        ),
      },
    ];
  }
  if (pathname.startsWith("/stats")) {
    return [{ label: t("nav.stats") }];
  }
  if (pathname.startsWith("/board")) {
    return [{ label: t("nav.board") }];
  }
  return [{ label: t("app.name") }];
}

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { t } = useTranslation();
  const state = use(TopBarContext);
  const location = useRouterState({
    select: (router) => ({
      pathname: router.location.pathname,
      search: router.location.search as Record<string, unknown>,
    }),
  });
  const crumbs =
    state?.crumbs ??
    crumbsForLocation(t, location.pathname, location.search ?? {});
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-border border-b bg-background px-3 sm:px-4 lg:px-6">
      <Button
        aria-label={t("nav.openMenu")}
        className="md:hidden"
        onClick={onMenu}
        size="icon-sm"
        variant="ghost"
      >
        <Menu aria-hidden="true" />
      </Button>
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${crumb.href ?? index}`}>
                {index > 0 ? (
                  <BreadcrumbSeparator className="max-sm:hidden" />
                ) : null}
                <BreadcrumbItem className={last ? "min-w-0" : "max-sm:hidden"}>
                  {last || !crumb.href ? (
                    <BreadcrumbPage className="truncate">
                      {crumb.label}
                    </BreadcrumbPage>
                  ) : (
                    <AppLink
                      className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      href={crumb.href}
                    >
                      {crumb.label}
                    </AppLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div
        className="flex shrink-0 items-center gap-2"
        ref={state?.setActionsSlot}
      />
    </header>
  );
}
