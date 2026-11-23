// Notes (12 §5.1): the composer and the user's notes journal, newest first.
// Notes are timeline events; deleted ones are hidden (notes.tsx).

import { SectionCard } from "@rulisme/ui/blocks/settings";
import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import { useTranslation } from "@/i18n";
import { deletedNoteIds, NoteComposer, NoteItem } from "./notes";

/** The visible notes among `events`, newest first, at most `limit`. */
export function visibleNotes(
  events: readonly ApplicationEventRecord[],
  limit = Number.POSITIVE_INFINITY
): ApplicationEventRecord[] {
  const hidden = deletedNoteIds(events);
  return events
    .filter((event) => event.type === "note_added" && !hidden.has(event.id))
    .slice(0, limit);
}

export function NotesList({
  appId,
  events,
  actorName,
  nowMs,
  limit,
}: {
  appId: string;
  events: readonly ApplicationEventRecord[];
  actorName: (event: ApplicationEventRecord) => string;
  nowMs: number;
  limit?: number;
}) {
  const { t } = useTranslation();
  const notes = visibleNotes(events, limit);
  return (
    <div className="flex flex-col gap-3">
      <NoteComposer appId={appId} />
      {notes.length === 0 ? (
        <p className="type-caption text-muted-foreground">
          {t("application.noNotes")}
        </p>
      ) : (
        notes.map((event) => (
          <NoteItem
            actor={actorName(event)}
            appId={appId}
            event={event}
            key={event.id}
            nowMs={nowMs}
          />
        ))
      )}
    </div>
  );
}

export function NotesTab(props: {
  appId: string;
  events: readonly ApplicationEventRecord[];
  actorName: (event: ApplicationEventRecord) => string;
  nowMs: number;
}) {
  const { t } = useTranslation();
  return (
    <SectionCard id="notes-heading" title={t("notes.heading")}>
      <NotesList {...props} />
    </SectionCard>
  );
}
