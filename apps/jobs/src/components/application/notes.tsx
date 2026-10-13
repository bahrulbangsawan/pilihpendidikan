// Notes (06 §5): free-text `note_added` events, Markdown-lite, timestamped
// and attributed. Deleting writes `note_deleted`; the original stays in the
// audit trail and is hidden from the default view (06 §4).

import type { ApplicationEventRecord } from "@pilihpendidikan/jobs-contracts/records";
import { Button } from "@rulisme/ui/ui/button";
import { Field, FieldDescription, FieldLabel } from "@rulisme/ui/ui/field";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Textarea } from "@rulisme/ui/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { MarkdownLite } from "@/components/rich-text";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

const NOTE_MAX = 10_000;

/** Ids of notes a later `note_deleted` hides. */
export function deletedNoteIds(
  events: readonly ApplicationEventRecord[]
): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type === "note_deleted") {
      const target = (event.payload as { note_event_id?: unknown })
        .note_event_id;
      if (typeof target === "string") {
        ids.add(target);
      }
    }
  }
  return ids;
}

export function noteText(event: ApplicationEventRecord): string {
  const text = (event.payload as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

export function NoteComposer({ appId }: { appId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // One key per note being written: a retry after a network error reuses it.
  const key = useRef(newIdempotencyKey());

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const value = text.trim();
    if (!value) {
      return;
    }
    setBusy(true);
    try {
      await api("POST /api/v1/applications/{app_id}/events", {
        params: { app_id: appId },
        body: {
          type: "note_added",
          payload: { text: value },
          idempotency_key: key.current,
          occurred_at: Date.now(),
        },
        idempotencyKey: key.current,
      });
      key.current = newIdempotencyKey();
      setText("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.applicationEvents(appId),
      });
    } catch {
      toast.error(t("notes.failed"));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <Field>
        <FieldLabel htmlFor={`${id}-note`}>{t("notes.add")}</FieldLabel>
        <Textarea
          className="field-touch min-h-20"
          id={`${id}-note`}
          maxLength={NOTE_MAX}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("notes.placeholder")}
          value={text}
        />
        <FieldDescription>{t("notes.help")}</FieldDescription>
      </Field>
      <Button
        className="self-start"
        disabled={busy || !text.trim()}
        size="sm"
        type="submit"
        variant="outline"
      >
        {t("notes.save")}
        <Kbd aria-hidden="true">⌘↵</Kbd>
      </Button>
    </form>
  );
}

export function NoteItem({
  event,
  appId,
  actor,
  nowMs,
}: {
  event: ApplicationEventRecord;
  appId: string;
  actor: string;
  nowMs: number;
}) {
  const { locale, t } = useTranslation();
  const queryClient = useQueryClient();
  async function remove() {
    try {
      await api("POST /api/v1/applications/{app_id}/events", {
        params: { app_id: appId },
        body: {
          type: "note_deleted",
          payload: { note_event_id: event.id },
          idempotency_key: `note-delete:${event.id}`,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.applicationEvents(appId),
      });
    } catch {
      toast.error(t("notes.deleteFailed"));
    }
  }
  return (
    <article className="flex flex-col gap-1.5 border border-border bg-card p-3">
      <header className="type-caption flex items-center justify-between gap-2 text-muted-foreground">
        <span>
          {actor} ·{" "}
          <time dateTime={new Date(event.recorded_at).toISOString()}>
            {relativeTime(event.recorded_at, nowMs, locale)}
          </time>
        </span>
        <Button
          aria-label={t("notes.delete")}
          onClick={remove}
          size="icon-xs"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </header>
      <MarkdownLite className="type-body" text={noteText(event)} />
    </article>
  );
}
