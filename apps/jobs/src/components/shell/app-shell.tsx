// The signed-in chrome (12 §2.1): nav band, sidebar (a Sheet on phones), the
// ⌘K palette, the `?` sheet, New by URL, the global single-key shortcuts
// and the `(3)` approvals prefix on the tab title (12 §6.1).

import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@rulisme/ui/ui/sheet";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAppNavigate } from "@/components/app-link";
import { useBoard } from "@/hooks/use-board";
import { useTranslation } from "@/i18n";
import { POLL_POLICIES } from "@/lib/polling";
import { NAV_SHORTCUTS } from "@/lib/shortcuts";
import { CommandPalette } from "./command-palette";
import { NavBand, SIDEBAR_WIDTH_CLASS } from "./nav-band";
import { NewJobDialog } from "./new-job-dialog";
import { ShellActionsProvider } from "./shell-context";
import { ShortcutSheet } from "./shortcut-sheet";
import { SidebarNav } from "./sidebar-nav";

const TITLE_PREFIX_RE = /^\(\d+\) /;

/** `title` with a `(n)` prefix for n > 0, or without any prefix. */
export function prefixedTitle(title: string, count: number): string {
  const base = title.replace(TITLE_PREFIX_RE, "");
  return count > 0 ? `(${count}) ${base}` : base;
}

/**
 * Prefixes the tab title with `(n)` while n approvals are pending (12 §6.1).
 * Route heads rewrite <title> on navigation, so the prefix is re-applied
 * whenever the title changes.
 */
function useTitlePrefix(count: number) {
  useEffect(() => {
    const apply = () => {
      const next = prefixedTitle(document.title, count);
      if (next !== document.title) {
        document.title = next;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      document.title = prefixedTitle(document.title, 0);
    };
  }, [count]);
}

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

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useAppNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const board = useBoard({ policy: POLL_POLICIES.shell });
  const counts = board.data?.board.counts ?? null;

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
  useTitlePrefix(counts?.approvals_pending ?? 0);
  useShortcut("b", () => navigate(NAV_SHORTCUTS.b));
  useShortcut("i", () => navigate(NAV_SHORTCUTS.i));
  useShortcut("a", () => navigate(NAV_SHORTCUTS.a));
  useShortcut("r", () => navigate(NAV_SHORTCUTS.r));
  useShortcut("n", actions.openNewJob);
  useShortcut("?", actions.openShortcuts);

  return (
    <ShellActionsProvider value={actions}>
      <div className="flex min-h-dvh flex-col">
        <a
          className="type-body sr-only z-50 bg-background px-3 py-2 text-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
          href="#main"
        >
          {t("nav.skip")}
        </a>
        <NavBand
          onMenu={() => setMenuOpen(true)}
          onNew={actions.openNewJob}
          onPalette={actions.openPalette}
        />
        <div className="flex min-h-0 flex-1">
          <aside
            className={`sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 border-line border-r bg-background md:block ${SIDEBAR_WIDTH_CLASS}`}
          >
            <SidebarNav counts={counts} />
          </aside>
          <main
            className="flex min-w-0 flex-1 flex-col"
            id="main"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
        <Sheet onOpenChange={setMenuOpen} open={menuOpen}>
          <SheetContent className="w-64 bg-background p-0" side="left">
            <SheetHeader className="sr-only">
              <SheetTitle>{t("nav.menuTitle")}</SheetTitle>
              <SheetDescription>{t("nav.menuDescription")}</SheetDescription>
            </SheetHeader>
            <div className="h-full pt-12">
              <SidebarNav
                counts={counts}
                onNavigate={() => setMenuOpen(false)}
              />
            </div>
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
    </ShellActionsProvider>
  );
}
