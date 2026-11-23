import { ChevronsUpDownIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { EntityAvatar } from "../ui/entity-avatar";

// The account menu at the foot of a sidebar (reui's app-shell user menu):
// a 48px row with a 32px square letter avatar (8px corners), the name
// (weight 500) and email and an up-down chevron (only the avatar when
// `collapsed`), opening a menu to the right of the sidebar (bottom-aligned)
// headed by the same identity, with uniform 28px rows. Group the items with separators (account pages / preferences /
// sign out) and put a `DropdownMenuShortcut` only on rows whose key really exists. The menu items are the app's: pass
// DropdownMenuItem / DropdownMenuSub children (Profile, Settings, Language,
// Sign out). Presentational: no session, routing or copy inside.

function UserIdentity({
  name,
  email,
}: {
  name: string | null | undefined;
  email: string;
}) {
  return (
    <>
      <EntityAvatar
        fallback={email}
        name={name}
        shape="square"
        size="default"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-body-compact weight-semibold truncate text-foreground">
          {name || email}
        </span>
        {name ? (
          <span className="type-caption-compact truncate text-muted-foreground">
            {email}
          </span>
        ) : null}
      </span>
    </>
  );
}

function UserMenu({
  name,
  email,
  label,
  collapsed = false,
  children,
  contentClassName,
}: {
  name?: string | null;
  email: string;
  /** Accessible name of the trigger, e.g. "Account: rina@example.com". */
  label: string;
  /** A collapsed sidebar shows the avatar only and opens to the right. */
  collapsed?: boolean;
  /** The menu items. */
  children: React.ReactNode;
  contentClassName?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(
          "flex h-12 w-full items-center gap-2.5 rounded-md px-2 text-left outline-none transition-colors duration-140 ease-standard hover:bg-pane focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid data-[state=open]:bg-pane",
          collapsed && "justify-center px-0"
        )}
        data-slot="user-menu-trigger"
      >
        {collapsed ? (
          <EntityAvatar
            fallback={email}
            name={name}
            shape="square"
            size="default"
          />
        ) : (
          <>
            <UserIdentity email={email} name={name} />
            <ChevronsUpDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn(
          // Uniform 28px rows (reui's app-shell menu); separators keep 4px.
          "w-60 [&_[role^=menuitem]]:min-h-7 [&_[role^=menuitem]]:py-0.5",
          contentClassName
        )}
        side="right"
        sideOffset={16}
      >
        <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-1.5">
          <UserIdentity email={email} name={name} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { UserMenu };
