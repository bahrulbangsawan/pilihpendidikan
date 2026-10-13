// Overview (12 §5.1): the posting description as plain text (72ch), the
// requirements, salary, and the notes journal.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import { PlainText } from "@/components/rich-text";
import { useTranslation } from "@/i18n";
import { formatMoney } from "@/lib/format";
import { deletedNoteIds, NoteComposer, NoteItem } from "./notes";

const RECENT_NOTES = 5;

function salaryText(
  detail: ApplicationDetail,
  locale: "en" | "id",
  t: (key: string) => string
): string | null {
  const salary = detail.posting.salary;
  if (!salary) {
    return null;
  }
  if (salary.min !== undefined || salary.max !== undefined) {
    const range = [salary.min, salary.max]
      .filter((value): value is number => value !== undefined)
      .map((value) => formatMoney(value, salary.currency, locale))
      .join(" – ");
    return salary.period
      ? `${range} ${t(`salaryPeriods.${salary.period}`)}`
      : range;
  }
  return salary.raw ?? null;
}

export function OverviewTab({
  detail,
  events,
  actorName,
  nowMs,
}: {
  detail: ApplicationDetail;
  events: readonly ApplicationEventRecord[];
  actorName: (event: ApplicationEventRecord) => string;
  nowMs: number;
}) {
  const { locale, t } = useTranslation();
  const { posting } = detail;
  const salary = salaryText(detail, locale, t);
  const hidden = deletedNoteIds(events);
  const notes = events
    .filter((event) => event.type === "note_added" && !hidden.has(event.id))
    .slice(0, RECENT_NOTES);
  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby="description-heading"
        className="flex flex-col gap-2"
      >
        <h2 className="type-subtitle weight-semibold" id="description-heading">
          {t("detail.description")}
        </h2>
        {posting.description_text ? (
          <PlainText
            className="type-body max-w-[72ch]"
            text={posting.description_text}
          />
        ) : (
          <p className="type-body text-muted-foreground">
            {t("detail.noDescription")}
          </p>
        )}
        {posting.description_truncated ? (
          <p className="type-caption text-muted-foreground">
            {t("detail.truncated")}
          </p>
        ) : null}
      </section>
      {posting.requirements.length > 0 ? (
        <section
          aria-labelledby="requirements-heading"
          className="flex flex-col gap-2"
        >
          <h2
            className="type-subtitle weight-semibold"
            id="requirements-heading"
          >
            {t("detail.requirements")}
          </h2>
          <ul className="type-body flex max-w-[72ch] list-disc flex-col gap-1 pl-5">
            {posting.requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {salary ? (
        <section
          aria-labelledby="salary-heading"
          className="flex flex-col gap-1"
        >
          <h2 className="type-subtitle weight-semibold" id="salary-heading">
            {t("detail.salary")}
          </h2>
          <p className="type-body">{salary}</p>
        </section>
      ) : null}
      <section
        aria-labelledby="notes-heading"
        className="flex max-w-2xl flex-col gap-3"
      >
        <h2 className="type-subtitle weight-semibold" id="notes-heading">
          {t("notes.heading")}
        </h2>
        <NoteComposer appId={detail.application.id} />
        {notes.map((event) => (
          <NoteItem
            actor={actorName(event)}
            appId={detail.application.id}
            event={event}
            key={event.id}
            nowMs={nowMs}
          />
        ))}
      </section>
    </div>
  );
}
