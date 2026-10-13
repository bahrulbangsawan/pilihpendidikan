// The sidebar of 12 §2.1, drawn as a Zedative ruled column: paper, a 1px
// rule on the right, three caption-labelled groups of compact rows, the
// active row on pane-2, counters as micro tabular chips and the single-key
// hint shown on hover / focus. The footer carries the CLI status and the
// signed-in account. Desktop shows it as a column; phones open it in a Sheet.

import type { BoardResponse } from "@pilihpendidikan/jobs-contracts/api";
import { cn } from "@rulisme/ui/lib/utils";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useDevices } from "@/hooks/use-devices";
import { useSession } from "@/hooks/use-session";
import { useTranslation } from "@/i18n";
import type { NavItem } from "./nav-items";
import { isCurrent, NAV_GROUPS } from "./nav-items";

type BoardCounts = BoardResponse["counts"];

const ROW =
  "group/row flex h-8 items-center gap-2.5 rounded-md px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

function NavRow({
  item,
  counts,
  onNavigate,
}: {
  item: NavItem;
  counts: BoardCounts | null;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const current = isCurrent(pathname, item);
  const count = item.count && counts ? counts[item.count] : 0;
  const Icon = item.icon;
  return (
    <li>
      <AppLink
        aria-current={current ? "page" : undefined}
        aria-keyshortcuts={item.shortcut}
        className={cn(
          ROW,
          "type-body-compact",
          current
            ? "weight-semibold bg-pane-2 text-foreground"
            : "text-ink hover:bg-pane/70 hover:text-foreground"
        )}
        href={item.href}
        onClick={onNavigate}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            current ? "text-foreground" : "text-muted-foreground"
          )}
        />
        <span className="min-w-0 flex-1 truncate">{t(`nav.${item.key}`)}</span>
        {count > 0 ? (
          <span
            className={cn(
              "type-micro rounded-xs border px-1.5 tabular-nums",
              current
                ? "border-line bg-card text-foreground"
                : "border-line text-muted-foreground"
            )}
          >
            <span className="sr-only">{t("nav.countLabel", { count })}</span>
            <span aria-hidden="true">{count}</span>
          </span>
        ) : null}
        {item.shortcut && count === 0 ? (
          <Kbd
            aria-hidden="true"
            className="opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
          >
            {item.shortcut}
          </Kbd>
        ) : null}
      </AppLink>
    </li>
  );
}

function DeviceStatus({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { online, isSuccess } = useDevices();
  let label = t("nav.cli");
  if (isSuccess && online === 0) {
    label = t("nav.devicesNone");
  } else if (isSuccess) {
    label = t(online === 1 ? "nav.devicesOne" : "nav.devicesMany", {
      count: online,
    });
  }
  return (
    <AppLink
      className={cn(
        ROW,
        "type-caption text-muted-foreground hover:bg-pane/70 hover:text-foreground"
      )}
      href="/cli"
      onClick={onNavigate}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <span
          aria-hidden="true"
          className={
            online > 0
              ? "pulse-dot size-2 rounded-full bg-foreground"
              : "size-2 rounded-full border border-muted-foreground"
          }
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </AppLink>
  );
}

function AccountRow({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { email } = useSession();
  if (!email) {
    return null;
  }
  return (
    <AppLink
      aria-label={t("nav.account", { email })}
      className={cn(ROW, "h-10 hover:bg-pane/70")}
      href="/settings"
      onClick={onNavigate}
    >
      <span
        aria-hidden="true"
        className="type-micro weight-semibold flex size-6 shrink-0 items-center justify-center rounded-xs border border-line bg-card text-foreground"
      >
        {email.charAt(0).toUpperCase()}
      </span>
      <span className="type-caption min-w-0 flex-1 truncate text-foreground">
        {email}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </AppLink>
  );
}

export function SidebarNav({
  counts,
  onNavigate,
}: {
  counts: BoardCounts | null;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav
        aria-label={t("nav.sidebar")}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4"
      >
        {NAV_GROUPS.map((group) => (
          <section
            aria-labelledby={`nav-group-${group.key}`}
            className="flex flex-col gap-1"
            key={group.key}
          >
            <h2
              className="type-caption px-2 pb-1 text-muted-foreground"
              id={`nav-group-${group.key}`}
            >
              {t(`nav.group.${group.key}`)}
            </h2>
            <ul className="flex flex-col gap-px">
              {group.items.map((item) => (
                <NavRow
                  counts={counts}
                  item={item}
                  key={item.key}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <div className="flex flex-col gap-1 border-line border-t px-3 py-3">
        <DeviceStatus onNavigate={onNavigate} />
        <AccountRow onNavigate={onNavigate} />
      </div>
    </div>
  );
}
