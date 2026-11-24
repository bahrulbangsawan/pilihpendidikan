// The signed-in chrome (reui app-shell): the sidebar on the left (a 56px
// rail when collapsed, a Sheet on phones), the 48px top bar over the content
// column, the ⌘K palette, the `?` sheet, New by URL and the global
// single-key shortcuts.

import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { cn } from "@rulisme/ui/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@rulisme/ui/ui/sheet";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppNavigate } from "@/components/app-link";
import { useBoard } from "@/hooks/use-board";
import { useTranslation } from "@/i18n";
import { POLL_POLICIES } from "@/lib/polling";
import { NAV_SHORTCUTS } from "@/lib/shortcuts";
import { CommandPalette } from "./command-palette";
import { NewJobDialog } from "./new-job-dialog";
import { ShellActionsProvider } from "./shell-context";
import { ShortcutSheet } from "./shortcut-sheet";
import {
  SIDEBAR_RAIL_CLASS,
  SIDEBAR_WIDTH_CLASS,
  SidebarNav,
} from "./sidebar-nav";
import { TopBar, TopBarProvider } from "./top-bar";

const COLLAPSED_KEY = "pilih-jobs:sidebar-collapsed";

/** ⌘K / Ctrl K toggles the palette, from anywhere (inputs included). */
function usePaletteHotkey(toggle: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);
}

/** The desktop sidebar's collapsed state, remembered per browser. */
function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Storage blocked: start open.
    }
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Storage blocked: the choice lasts for this page only.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useAppNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsed();
  // Keeps the board cache warm for the ⌘K palette's application search.
  useBoard({ policy: POLL_POLICIES.shell });

  const actions = useMemo(
    () => ({
      openNewJob: () => setNewJobOpen(true),
      openPalette: () => setPaletteOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
    }),
    []
  );
  const togglePalette = useMemo(
    () => () => setPaletteOpen((open) => !open),
    []
  );

  usePaletteHotkey(togglePalette);
  useShortcut("b", () => navigate(NAV_SHORTCUTS.b));
  useShortcut("n", actions.openNewJob);
  useShortcut("?", actions.openShortcuts);

  return (
    <ShellActionsProvider value={actions}>
      <TopBarProvider>
        <div className="flex min-h-dvh">
          <a
            className="type-body sr-only z-50 bg-background px-3 py-2 text-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
            href="#main"
          >
            {t("nav.skip")}
          </a>
          <aside
            className={cn(
              "sticky top-0 hidden h-dvh shrink-0 border-border border-r bg-sidebar md:block",
              collapsed ? SIDEBAR_RAIL_CLASS : SIDEBAR_WIDTH_CLASS
            )}
          >
            <SidebarNav
              collapsed={collapsed}
              onPalette={actions.openPalette}
              onToggleCollapsed={toggleCollapsed}
            />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar onMenu={() => setMenuOpen(true)} />
            <main
              className="flex min-w-0 flex-1 flex-col pb-10"
              id="main"
              tabIndex={-1}
            >
              {children}
            </main>
          </div>
          <Sheet onOpenChange={setMenuOpen} open={menuOpen}>
            <SheetContent
              className="w-64 bg-sidebar p-0"
              showCloseButton={false}
              side="left"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>{t("nav.menuTitle")}</SheetTitle>
                <SheetDescription>{t("nav.menuDescription")}</SheetDescription>
              </SheetHeader>
              <SidebarNav
                onNavigate={() => setMenuOpen(false)}
                onPalette={actions.openPalette}
              />
            </SheetContent>
          </Sheet>
          <CommandPalette
            onNewJob={actions.openNewJob}
            onOpenChange={setPaletteOpen}
            onShortcuts={actions.openShortcuts}
            open={paletteOpen}
          />
          <NewJobDialog onOpenChange={setNewJobOpen} open={newJobOpen} />
          <ShortcutSheet onOpenChange={setShortcutsOpen} open={shortcutsOpen} />
        </div>
      </TopBarProvider>
    </ShellActionsProvider>
  );
}
