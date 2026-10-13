// The ⌘K / Ctrl K palette (12 §2.1): jump to an application by company or
// title, run actions, go anywhere, switch the theme.

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@rulisme/ui/ui/command";
import { useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  CircleCheck,
  Inbox,
  Keyboard,
  LogOut,
  Moon,
  Plus,
  Radar,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import { useAppNavigate } from "@/components/app-link";
import type { BoardData } from "@/hooks/use-board";
import { useSignOut } from "@/hooks/use-session";
import { useTranslation } from "@/i18n";
import { allCards, columnsFromBoard } from "@/lib/board-model";
import { stageLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";
import { ACCOUNT_NAV, MAIN_NAV } from "./nav-items";

/** Most applications the palette searches (the board cache). */
const MAX_APPLICATIONS = 200;

export function CommandPalette({
  open,
  onOpenChange,
  onNewJob,
  onShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewJob: () => void;
  onShortcuts: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useAppNavigate();
  const queryClient = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();
  const signOut = useSignOut();

  const applications = useMemo(() => {
    if (!open) {
      return [];
    }
    const data = queryClient.getQueryData<BoardData>(queryKeys.board(false));
    return data
      ? allCards(columnsFromBoard(data.board)).slice(0, MAX_APPLICATIONS)
      : [];
  }, [open, queryClient]);

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  const dark = resolvedTheme === "dark";

  return (
    <CommandDialog
      description={t("palette.description")}
      onOpenChange={onOpenChange}
      open={open}
      title={t("palette.title")}
    >
      <Command>
        <CommandInput placeholder={t("palette.placeholder")} />
        <CommandList>
          <CommandEmpty>{t("palette.empty")}</CommandEmpty>
          <CommandGroup heading={t("palette.actions")}>
            <CommandItem onSelect={() => run(onNewJob)} value="new job url">
              <Plus aria-hidden="true" />
              {t("palette.newJob")}
              <CommandShortcut>N</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => navigate("/automation"))}
              value="approve next approval"
            >
              <CircleCheck aria-hidden="true" />
              {t("palette.approveNext")}
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => navigate("/inbox"))}
              value="open inbox discovery"
            >
              <Inbox aria-hidden="true" />
              {t("palette.openInbox")}
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => navigate("/sources"))}
              value="start discovery device"
            >
              <Radar aria-hidden="true" />
              {t("palette.startDiscovery")}
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => setTheme(dark ? "light" : "dark"))}
              value="switch theme night desk light dark"
            >
              {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              {dark ? t("palette.themeLight") : t("palette.themeDark")}
            </CommandItem>
            <CommandItem
              onSelect={() => run(onShortcuts)}
              value="keyboard shortcuts"
            >
              <Keyboard aria-hidden="true" />
              {t("palette.shortcuts")}
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          {applications.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("palette.applications")}>
                {applications.map((card) => (
                  <CommandItem
                    key={card.id}
                    onSelect={() =>
                      run(() => navigate(`/applications/${card.id}`))
                    }
                    value={`${card.posting.company_name} ${card.posting.title} ${card.id}`}
                  >
                    <Briefcase aria-hidden="true" />
                    <span className="truncate">
                      {card.posting.company_name} · {card.posting.title}
                    </span>
                    <CommandShortcut>
                      {stageLabel(t, card.stage)}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
          <CommandSeparator />
          <CommandGroup heading={t("palette.goTo")}>
            {[...MAIN_NAV, ...ACCOUNT_NAV].map((item) => (
              <CommandItem
                key={item.key}
                onSelect={() => run(() => navigate(item.href))}
                value={`go ${t(`nav.${item.key}`)}`}
              >
                <item.icon aria-hidden="true" />
                {t(`nav.${item.key}`)}
                {item.shortcut ? (
                  <CommandShortcut>{item.shortcut}</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
            <CommandItem
              onSelect={() => run(() => signOut())}
              value="sign out log out"
            >
              <LogOut aria-hidden="true" />
              {t("settings.signOut")}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
