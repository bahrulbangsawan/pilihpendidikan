// Shared bulk-action chrome for list screens: the toolbar that appears while
// rows are selected, the select-all checkbox, the destructive-action
// confirmation and the per-row results dialog. Screens pass their own
// actions as children; the work itself goes through `useBulkRun`.

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rulisme/ui/ui/alert-dialog";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { BulkRunReport } from "@/hooks/use-bulk-run";
import type { Selection } from "@/hooks/use-selection";
import { useTranslation } from "@/i18n";

export function BulkToolbar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (count === 0) {
    return null;
  }
  return (
    <div
      aria-label={t("bulk.toolbar")}
      className="band flex flex-wrap items-center gap-1.5 bg-pane px-4 py-2 sm:px-6"
      role="toolbar"
    >
      <span
        aria-live="polite"
        className="type-body-compact weight-semibold mr-2 tabular-nums"
        role="status"
      >
        {t("bulk.selected", { count })}
      </span>
      {children}
      <Button className="ml-auto" onClick={onClear} size="sm" variant="ghost">
        <X aria-hidden="true" data-icon="inline-start" />
        {t("bulk.clear")}
      </Button>
    </div>
  );
}

/** The header checkbox: checked, indeterminate or empty. */
export function SelectAllCheckbox({
  selection,
  disabled,
}: {
  selection: Selection;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  let checked: boolean | "indeterminate" = selection.allSelected;
  if (selection.someSelected) {
    checked = "indeterminate";
  }
  return (
    <Checkbox
      aria-label={t("bulk.selectAll")}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(value) => selection.toggleAll(value === true)}
    />
  );
}

/** One row's checkbox; `label` names the row for screen readers. */
export function RowCheckbox({
  selection,
  id,
  label,
  disabled,
}: {
  selection: Selection;
  id: string;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Checkbox
      aria-label={t("bulk.selectRow", { name: label })}
      checked={selection.isSelected(id)}
      disabled={disabled}
      onCheckedChange={(value) => selection.toggle(id, value === true)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

/**
 * Confirmation for a bulk action ("Delete 3 rules?"). Destructive by
 * default; `confirmVariant="default"` for a non-destructive one (approve,
 * retry), `confirmDisabled` when nothing in the selection qualifies.
 */
export function BulkConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmVariant = "destructive",
  confirmDisabled = false,
  cancelLabel,
  busy,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirmVariant?: "destructive" | "default";
  confirmDisabled?: boolean;
  /** The dismiss button's label when "Cancel" would be ambiguous. */
  cancelLabel?: string;
  busy: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (!busy) {
          onOpenChange(next);
        }
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {cancelLabel ?? t("common.cancel")}
          </AlertDialogCancel>
          <Button
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
            variant={confirmVariant}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const STATUS_VARIANTS = {
  ok: "secondary",
  skipped: "outline",
  conflict: "outline",
  failed: "destructive",
} as const;

/** Per-row results of the last bulk run (opened from the summary toast). */
export function BulkRunResultsDialog({
  report,
  onClose,
}: {
  report: BulkRunReport | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={report !== null}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("bulk.resultsTitleRows")}</DialogTitle>
          <DialogDescription>{report?.action}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-line border-line border-y">
          {report?.results.map((result) => (
            <li
              className="flex items-start justify-between gap-3 py-2"
              key={result.id}
            >
              <div className="flex min-w-0 flex-col">
                <span className="type-body-compact truncate text-foreground">
                  {report.labels.get(result.id) ?? result.id}
                </span>
                {result.message && result.status !== "ok" ? (
                  <span className="type-caption text-muted-foreground">
                    {result.message}
                  </span>
                ) : null}
              </div>
              <Badge variant={STATUS_VARIANTS[result.status]}>
                {t(`bulk.status.${result.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
