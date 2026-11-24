// The sidebar's user footer and its profile dropdown, on the shared
// UserMenu block (`@rulisme/ui/blocks/user-menu`): a header with the
// avatar, name and email, then three groups split by separators — Profile,
// Settings / Language, Keyboard shortcuts (`?`) / Sign out. It opens to the
// right of the sidebar. Dark only: no theme item.

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import { UserMenu as UserMenuBlock } from "@rulisme/ui/blocks/user-menu";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import {
  Globe,
  Keyboard,
  Languages,
  LogOut,
  Settings,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useAppNavigate } from "@/components/app-link";
import { useFacts } from "@/hooks/use-profile";
import { useSession, useSignOut } from "@/hooks/use-session";
import { useTranslation } from "@/i18n";
import { useShellActions } from "./shell-context";
import { useChangeLocale } from "./use-change-locale";

const LOCALES: readonly { label: string; value: Locale }[] = [
  { value: "en", label: "English" },
  { value: "id", label: "Bahasa Indonesia" },
];

function useDisplayName(): string | null {
  const facts = useFacts();
  return useMemo(() => {
    const fact = facts.data?.facts.find(
      (entry) => entry.key === "contact.full_name"
    );
    return typeof fact?.value === "string" && fact.value.trim()
      ? fact.value.trim()
      : null;
  }, [facts.data]);
}

export function UserMenu({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useAppNavigate();
  const changeLocale = useChangeLocale();
  const { openShortcuts } = useShellActions();
  const name = useDisplayName();
  const email = session.email;
  if (!email) {
    return null;
  }

  function go(href: string) {
    onNavigate?.();
    navigate(href);
  }

  async function pickLocale(value: string) {
    if (value === session.locale) {
      return;
    }
    try {
      await changeLocale(value as Locale);
    } catch {
      toast.error(t("settings.localeFailed"));
    }
  }

  return (
    <UserMenuBlock
      collapsed={collapsed}
      email={email}
      label={t("nav.account", { email })}
      name={name}
    >
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => go("/profile")}>
          <UserRound aria-hidden="true" />
          {t("nav.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => go("/settings")}>
          <Settings aria-hidden="true" />
          {t("nav.settings")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages aria-hidden="true" />
            {t("nav.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuRadioGroup
              onValueChange={pickLocale}
              value={session.locale}
            >
              {LOCALES.map((locale) => (
                <DropdownMenuRadioItem key={locale.value} value={locale.value}>
                  <Globe aria-hidden="true" />
                  {locale.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onSelect={() => {
            onNavigate?.();
            openShortcuts();
          }}
        >
          <Keyboard aria-hidden="true" />
          {t("nav.shortcuts")}
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => signOut()}>
        <LogOut aria-hidden="true" />
        {t("settings.signOut")}
      </DropdownMenuItem>
    </UserMenuBlock>
  );
}
