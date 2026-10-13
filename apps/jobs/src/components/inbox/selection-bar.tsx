// The inbox selection bar (12 §4): appears while rows are selected —
// "3 selected   [S] Track   [D] Dismiss   Score   Mark seen". Track is the
// screen's one primary action. The keys are registered by the page (they
// also act on the focused row when nothing is selected).

import type { InboxBulkAction } from "@pilihpendidikan/jobs-contracts/enums";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Check, Eye, Gauge, X } from "lucide-react";
import { useTranslation } from "@/i18n";

export function SelectionBar({
  count,
  busy,
  tab,
  onAction,
  onClear,
}: {
  count: number;
  busy: InboxBulkAction | null;
  tab: "new" | "seen" | "dismissed";
  onAction: (action: InboxBulkAction) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  if (count === 0) {
    return null;
  }
  const working = busy !== null;
  return (
    <section
      aria-label={t("inbox.selection.label")}
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-line border-t bg-background px-4 py-2 sm:px-6"
    >
      <p
        aria-live="polite"
        className="type-body-compact weight-semibold mr-2 text-foreground tabular-nums"
      >
        {t("inbox.selection.count", { count })}
      </p>
      <Button
        aria-keyshortcuts="S"
        disabled={working}
        onClick={() => onAction("track")}
        size="sm"
      >
        <Check aria-hidden="true" data-icon="inline-start" />
        {busy === "track"
          ? t("inbox.selection.working")
          : t("inbox.selection.track")}
        <Kbd aria-hidden="true">S</Kbd>
      </Button>
      {tab === "dismissed" ? null : (
        <Button
          aria-keyshortcuts="D"
          disabled={working}
          onClick={() => onAction("dismiss")}
          size="sm"
          variant="outline"
        >
          <X aria-hidden="true" data-icon="inline-start" />
          {t("inbox.selection.dismiss")}
          <Kbd aria-hidden="true">D</Kbd>
        </Button>
      )}
      <Button
        disabled={working}
        onClick={() => onAction("score")}
        size="sm"
        variant="ghost"
      >
        <Gauge aria-hidden="true" data-icon="inline-start" />
        {t("inbox.selection.score")}
      </Button>
      {tab === "new" ? (
        <Button
          disabled={working}
          onClick={() => onAction("seen")}
          size="sm"
          variant="ghost"
        >
          <Eye aria-hidden="true" data-icon="inline-start" />
          {t("inbox.selection.seen")}
        </Button>
      ) : null}
      <Button
        className="ml-auto"
        disabled={working}
        onClick={onClear}
        size="sm"
        variant="ghost"
      >
        {t("inbox.selection.clear")}
      </Button>
    </section>
  );
}
