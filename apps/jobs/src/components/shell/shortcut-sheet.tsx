// The `?` sheet: every shortcut of 12 §2.2 / 06 §10, grouped by where it
// works.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import { Kbd, KbdGroup } from "@rulisme/ui/ui/kbd";
import { useTranslation } from "@/i18n";
import type { ShortcutScope } from "@/lib/shortcuts";
import { SHORTCUTS } from "@/lib/shortcuts";

const SCOPES: readonly ShortcutScope[] = [
  "global",
  "board",
  "card",
  "application",
  "profile",
  "inbox",
  "job",
  "approvals",
  "monitor",
  "cli",
];

export function ShortcutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {SCOPES.map((scope) => (
            <section aria-labelledby={`shortcuts-${scope}`} key={scope}>
              <h3
                className="type-caption mb-1.5 text-muted-foreground"
                id={`shortcuts-${scope}`}
              >
                {t(`shortcuts.scopes.${scope}`)}
              </h3>
              <dl className="divide-y divide-line border-line border-y">
                {SHORTCUTS.filter((entry) => entry.scope === scope).map(
                  (entry) => (
                    <div
                      className="flex items-center justify-between gap-3 py-1.5"
                      key={`${scope}-${entry.action}`}
                    >
                      <dt className="type-body-compact">
                        {t(`shortcuts.actions.${entry.action}`)}
                      </dt>
                      <dd>
                        <KbdGroup>
                          {entry.keys.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </KbdGroup>
                      </dd>
                    </div>
                  )
                )}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
