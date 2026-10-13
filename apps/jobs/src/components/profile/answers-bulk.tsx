// Bulk actions on the selected answers (12 §9): "Use it" (one PATCH per
// answer with its base_revision; protected answers are never set to
// Always and are skipped with the reason) and Delete (confirmed, one
// DELETE per answer).

import type { AutoUse } from "@pilihpendidikan/jobs-contracts/enums";
import { AUTO_USE } from "@pilihpendidikan/jobs-contracts/enums";
import type { ScreeningAnswerRecord } from "@pilihpendidikan/jobs-contracts/records";
import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { ChevronDown, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  BulkConfirmDialog,
  BulkRunResultsDialog,
  BulkToolbar,
} from "@/components/bulk/bulk-toolbar";
import { useBulkRun } from "@/hooks/use-bulk-run";
import type { Selection } from "@/hooks/use-selection";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { answerAutoUseBlock, BulkSkip } from "@/lib/bulk";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

const INVALIDATE = [queryKeys.answers] as const;

export function AnswersBulkBar({
  selection,
  answers,
}: {
  answers: readonly ScreeningAnswerRecord[];
  selection: Selection;
}) {
  const { t } = useTranslation();
  const bulk = useBulkRun({
    invalidate: INVALIDATE,
    onSucceeded: selection.clear,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const selected = selection.selectedIds
    .map((id) => byId.get(id))
    .filter((answer): answer is ScreeningAnswerRecord => answer !== undefined);
  const rows = selected.map((answer) => ({
    id: answer.id,
    label: answer.question_key,
  }));

  function answerOf(id: string): ScreeningAnswerRecord {
    const answer = byId.get(id);
    if (!answer) {
      throw new BulkSkip("gone", t("answers.bulk.gone"));
    }
    return answer;
  }

  function setAutoUse(target: AutoUse) {
    return bulk.run(
      t("answers.bulk.setAutoUse", {
        value: t(`answers.autoUses.${target}`),
      }),
      rows,
      async (id) => {
        const answer = answerOf(id);
        const block = answerAutoUseBlock(answer, target);
        if (block === "protected_always") {
          throw new BulkSkip(block, t("answers.protectedAlways"));
        }
        if (block === "unchanged") {
          throw new BulkSkip(block, t("answers.bulk.unchanged"));
        }
        await api("PATCH /api/v1/profile/answers/{ans_id}", {
          params: { ans_id: id },
          body: { auto_use: target, base_revision: answer.revision },
          idempotencyKey: newIdempotencyKey(),
        });
      }
    );
  }

  async function remove() {
    await bulk.run(t("answers.bulk.delete"), rows, async (id) => {
      const answer = answerOf(id);
      await api("DELETE /api/v1/profile/answers/{ans_id}", {
        params: { ans_id: id },
        query: { base_revision: answer.revision },
        idempotencyKey: newIdempotencyKey(),
      });
    });
    setConfirmDelete(false);
  }

  const protectedCount = selected.filter(
    (answer) => answer.sensitivity === "protected"
  ).length;
  return (
    <>
      <BulkToolbar count={selected.length} onClear={selection.clear}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={bulk.busy} size="sm" variant="outline">
              {t("answers.autoUse")}
              <ChevronDown aria-hidden="true" data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {AUTO_USE.map((value) => (
              <DropdownMenuItem key={value} onSelect={() => setAutoUse(value)}>
                {t(`answers.autoUses.${value}`)}
                {value === "always" && protectedCount > 0 ? (
                  <span className="type-micro ml-auto text-muted-foreground tabular-nums">
                    {t("answers.bulk.protectedSkipped", {
                      count: protectedCount,
                    })}
                  </span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          disabled={bulk.busy}
          onClick={() => setConfirmDelete(true)}
          size="sm"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" data-icon="inline-start" />
          {t("answers.bulk.delete")}
        </Button>
      </BulkToolbar>
      <BulkConfirmDialog
        body={t("answers.bulk.deleteBody")}
        busy={bulk.busy}
        confirmLabel={t("bulk.delete", { count: selected.length })}
        onConfirm={remove}
        onOpenChange={setConfirmDelete}
        open={confirmDelete}
        title={t("answers.bulk.deleteTitle", { count: selected.length })}
      />
      <BulkRunResultsDialog onClose={bulk.closeReport} report={bulk.report} />
    </>
  );
}
