// The keyboard alternative to drag and drop (12 §3, `M`): a stage Select —
// stages the 03 §5.1 graph does not allow are listed but disabled — and a
// position: top, bottom, or after a named card.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { STAGES } from "@pilihpendidikan/jobs-contracts/enums";
import { Button } from "@rulisme/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@rulisme/ui/ui/field";
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import type { FormEvent } from "react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "@/i18n";
import type { BoardColumns } from "@/lib/board-model";
import { canMoveTo } from "@/lib/board-move";
import { stageLabel } from "@/lib/labels";

export interface StagePick {
  afterId: string | null;
  beforeId: string | null;
  index: number;
  stage: Stage;
  total: number;
}

const TOP = "top";
const BOTTOM = "bottom";

export function StagePickerDialog({
  card,
  columns,
  onOpenChange,
  onPick,
}: {
  card: BoardCard | null;
  columns: BoardColumns | null;
  onOpenChange: (open: boolean) => void;
  onPick: (pick: StagePick) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [stage, setStage] = useState<Stage>("saved");
  const [position, setPosition] = useState<string>(BOTTOM);

  useEffect(() => {
    if (card) {
      setStage(card.stage);
      setPosition(BOTTOM);
    }
  }, [card]);

  const others = (columns && card ? columns[stage] : []).filter(
    (entry) => entry.id !== card?.id
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!card) {
      return;
    }
    let index = others.length;
    if (position === TOP) {
      index = 0;
    } else if (position !== BOTTOM) {
      const after = others.findIndex((entry) => entry.id === position);
      index = after === -1 ? others.length : after + 1;
    }
    onPick({
      stage,
      index: index + 1,
      total: others.length + 1,
      beforeId: others[index - 1]?.id ?? null,
      afterId: others[index]?.id ?? null,
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={card !== null}>
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("picker.title")}</DialogTitle>
            <DialogDescription>
              {card
                ? t("move.cardLabel", {
                    company: card.posting.company_name,
                    title: card.posting.title,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${id}-stage`}>{t("picker.stage")}</FieldLabel>
            <Select
              onValueChange={(value) => {
                setStage(value as Stage);
                setPosition(BOTTOM);
              }}
              value={stage}
            >
              <SelectTrigger className="w-full" id={`${id}-stage`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((value) => {
                  const allowed = card ? canMoveTo(card.stage, value) : true;
                  return (
                    <SelectItem disabled={!allowed} key={value} value={value}>
                      {allowed
                        ? stageLabel(t, value)
                        : t("picker.notAllowed", {
                            stage: stageLabel(t, value),
                          })}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <FieldDescription>{t("picker.stageHelp")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-position`}>
              {t("picker.position")}
            </FieldLabel>
            <Select onValueChange={setPosition} value={position}>
              <SelectTrigger className="w-full" id={`${id}-position`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOP}>{t("picker.top")}</SelectItem>
                <SelectItem value={BOTTOM}>{t("picker.bottom")}</SelectItem>
                {others.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {t("picker.after", {
                      card: `${entry.posting.company_name} · ${entry.posting.title}`,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit">
              {t("picker.submit")}
              <Kbd aria-hidden="true">↵</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
