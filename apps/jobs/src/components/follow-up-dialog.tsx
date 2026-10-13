// Set, change, clear or complete a follow-up (06 §7): presets 3 days, 1 week,
// 2 weeks, or a date. Completing clears `follow_up_at` and writes a
// `note_added` event with `payload.kind = "follow_up_done"`.

import { Button } from "@rulisme/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import { Field, FieldLabel } from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useApplicationPatch } from "@/hooks/use-conflict-write";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { FOLLOW_UP_PRESETS, presetFollowUpAt } from "@/lib/follow-up";
import { formatDate, fromLocalInputValue, toDateValue } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

export interface FollowUpTarget {
  company: string;
  /** The board card or application record the edit starts from. */
  record: {
    follow_up_at: number | null;
    id: string;
    revision: number;
  } & Record<string, unknown>;
  title: string;
}

/** Clears the follow-up and records it as done (06 §7). */
export async function completeFollowUp(
  patch: ReturnType<typeof useApplicationPatch>,
  target: FollowUpTarget,
  text: string
): Promise<boolean> {
  const outcome = await patch(target.record, { follow_up_at: null });
  if (!outcome || outcome.kind === "overlap") {
    return false;
  }
  await api("POST /api/v1/applications/{app_id}/events", {
    params: { app_id: target.record.id },
    body: {
      type: "note_added",
      payload: { text, kind: "follow_up_done" },
      idempotency_key: newIdempotencyKey(),
    },
  });
  return true;
}

export function FollowUpDialog({
  target,
  onClose,
}: {
  target: FollowUpTarget | null;
  onClose: () => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const patch = useApplicationPatch();
  const queryClient = useQueryClient();
  const [day, setDay] = useState("");

  useEffect(() => {
    const current = target?.record.follow_up_at ?? null;
    setDay(current ? toDateValue(current) : "");
  }, [target]);

  async function save(at: number | null) {
    if (!target) {
      return;
    }
    onClose();
    const outcome = await patch(
      target.record,
      { follow_up_at: at },
      t("followUp.what")
    );
    if (outcome?.kind === "saved") {
      toast.success(
        at === null
          ? t("followUp.cleared")
          : t("followUp.saved", { date: formatDate(at, locale) })
      );
    }
  }

  async function done() {
    if (!target) {
      return;
    }
    onClose();
    if (await completeFollowUp(patch, target, t("followUp.doneNote"))) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.applicationEvents(target.record.id),
      });
      toast.success(t("followUp.done"));
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const at = fromLocalInputValue(day);
    if (at !== null) {
      save(at);
    }
  }

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={target !== null}>
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("followUp.title")}</DialogTitle>
            <DialogDescription>
              {target
                ? t("move.cardLabel", {
                    company: target.company,
                    title: target.title,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {FOLLOW_UP_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                onClick={() => save(presetFollowUpAt(Date.now(), preset.days))}
                size="sm"
                type="button"
                variant="outline"
              >
                {t(`followUp.presets.${preset.key}`)}
              </Button>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor={`${id}-date`}>{t("followUp.date")}</FieldLabel>
            <Input
              className="field-touch"
              id={`${id}-date`}
              min={toDateValue(Date.now())}
              onChange={(event) => setDay(event.target.value)}
              type="date"
              value={day}
            />
          </Field>
          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              {target?.record.follow_up_at ? (
                <>
                  <Button onClick={done} type="button" variant="outline">
                    {t("followUp.markDone")}
                  </Button>
                  <Button
                    onClick={() => save(null)}
                    type="button"
                    variant="ghost"
                  >
                    {t("followUp.clear")}
                  </Button>
                </>
              ) : null}
            </div>
            <Button disabled={!day} type="submit">
              {t("followUp.submit")}
              <Kbd aria-hidden="true">↵</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
