// The follow-up block of the detail rail (06 §7): the date when one is set,
// otherwise a suggestion (7 days after applying, 3 after an interview, 48 h
// before an offer deadline) that is only written when the user accepts it.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import { Button } from "@rulisme/ui/ui/button";
import { Clock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { ApplicationPatch } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import { suggestFollowUp } from "@/lib/follow-up";
import { formatDate, relativeTime } from "@/lib/format";

export function FollowUpCard({
  detail,
  nowMs,
  onAccept,
  onEdit,
}: {
  detail: Pick<ApplicationDetail, "application" | "interviews" | "offers">;
  nowMs: number;
  /** Writes `follow_up_at` — called only from the Accept button. */
  onAccept: (changes: ApplicationPatch) => Promise<unknown>;
  onEdit: () => void;
}) {
  const { locale, t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const { application } = detail;
  const suggestion = dismissed ? null : suggestFollowUp(detail, nowMs);

  if (application.follow_up_at !== null) {
    const due = application.follow_up_at <= nowMs;
    return (
      <section
        aria-labelledby="follow-up-heading"
        className="flex flex-col gap-2 border-line border-b p-4"
      >
        <h2
          className="type-caption text-muted-foreground"
          id="follow-up-heading"
        >
          {t("followUp.heading")}
        </h2>
        <p className="type-body inline-flex items-center gap-1.5 text-foreground">
          <Clock aria-hidden="true" className="size-3.5" />
          {due
            ? t("followUp.dueSince", {
                when: relativeTime(application.follow_up_at, nowMs, locale),
              })
            : t("followUp.on", {
                date: formatDate(application.follow_up_at, locale),
              })}
        </p>
        <Button
          className="self-start"
          onClick={onEdit}
          size="xs"
          variant="outline"
        >
          {t("followUp.change")}
        </Button>
      </section>
    );
  }
  if (!suggestion) {
    return (
      <section
        aria-labelledby="follow-up-heading"
        className="flex flex-col gap-2 border-line border-b p-4"
      >
        <h2
          className="type-caption text-muted-foreground"
          id="follow-up-heading"
        >
          {t("followUp.heading")}
        </h2>
        <Button
          className="self-start"
          onClick={onEdit}
          size="xs"
          variant="outline"
        >
          {t("followUp.set")}
        </Button>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="follow-up-heading"
      className="flex flex-col gap-2 border-line border-b p-4"
      data-testid="follow-up-suggestion"
    >
      <h2 className="type-caption text-muted-foreground" id="follow-up-heading">
        {t("followUp.suggested")}
      </h2>
      <p className="type-body text-foreground">
        {t(`followUp.reasons.${suggestion.reason}`, {
          date: formatDate(suggestion.at, locale),
        })}
      </p>
      <div className="flex gap-2">
        <Button
          onClick={async () => {
            await onAccept({ follow_up_at: suggestion.at });
            toast.success(
              t("followUp.saved", { date: formatDate(suggestion.at, locale) })
            );
          }}
          size="xs"
          variant="outline"
        >
          {t("followUp.accept")}
        </Button>
        <Button onClick={() => setDismissed(true)} size="xs" variant="ghost">
          {t("followUp.dismiss")}
        </Button>
      </div>
    </section>
  );
}
