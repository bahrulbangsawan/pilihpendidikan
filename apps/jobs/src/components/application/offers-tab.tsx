// Offers (06 §6.2): several per application (a revised offer is a new row),
// structured compensation, deadline, status. Recording an offer moves the
// application to Offer and accepting one moves it to Accepted (toggles,
// default on); declining asks "Withdraw application?" separately.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type {
  OfferStatus,
  SalaryPeriod,
  Stage,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  OFFER_STATUSES,
  SALARY_PERIODS,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { OfferRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rulisme/ui/ui/alert-dialog";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Field, FieldGroup, FieldLabel } from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@rulisme/ui/ui/sheet";
import { Switch } from "@rulisme/ui/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { Textarea } from "@rulisme/ui/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BulkConfirmDialog,
  BulkRunResultsDialog,
  BulkToolbar,
  RowCheckbox,
  SelectAllCheckbox,
} from "@/components/bulk/bulk-toolbar";
import { commitApplicationToBoard } from "@/hooks/use-board";
import { useBulkRun } from "@/hooks/use-bulk-run";
import { useConflictWrite } from "@/hooks/use-conflict-write";
import type { Selection } from "@/hooks/use-selection";
import { useSelection } from "@/hooks/use-selection";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { BulkSkip } from "@/lib/bulk";
import {
  formatDate,
  formatMoney,
  fromLocalInputValue,
  toDateValue,
} from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { offerStatusLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";

interface Draft {
  base: string;
  bonus: string;
  currency: string;
  deadline: string;
  equity: string;
  moveApplication: boolean;
  notes: string;
  period: SalaryPeriod;
  raw: string;
  received: string;
  status: OfferStatus;
}

const OFFER_FIELDS = [
  "received_at",
  "compensation",
  "deadline_at",
  "status",
  "notes",
] as const;

function draftFrom(offer: OfferRecord | null): Draft {
  const pay = offer?.compensation;
  return {
    received: toDateValue(offer?.received_at ?? Date.now()),
    base: pay?.base == null ? "" : String(pay.base),
    currency: pay?.currency ?? "IDR",
    period: pay?.period ?? "month",
    bonus: pay?.bonus === undefined ? "" : String(pay.bonus),
    equity: pay?.equity ?? "",
    raw: pay?.raw ?? "",
    deadline: toDateValue(offer?.deadline_at ?? null),
    status: offer?.status ?? "open",
    notes: offer?.notes ?? "",
    moveApplication: true,
  };
}

function fieldsFrom(draft: Draft) {
  const base = Number.parseFloat(draft.base);
  const bonus = Number.parseFloat(draft.bonus);
  const currency = draft.currency.trim().toUpperCase();
  return {
    received_at: fromLocalInputValue(draft.received) ?? Date.now(),
    compensation: {
      ...(Number.isFinite(base) ? { base } : {}),
      ...(currency.length === 3 ? { currency } : {}),
      period: draft.period,
      ...(draft.bonus.trim()
        ? { bonus: Number.isFinite(bonus) ? bonus : draft.bonus.trim() }
        : {}),
      ...(draft.equity.trim() ? { equity: draft.equity.trim() } : {}),
      ...(draft.raw.trim() ? { raw: draft.raw.trim() } : {}),
    },
    deadline_at: fromLocalInputValue(draft.deadline),
    status: draft.status,
    notes: draft.notes,
  };
}

export function OffersTab({
  detail,
  onMove,
}: {
  detail: ApplicationDetail;
  onMove: (target: Stage) => void;
}) {
  const { locale, t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const write = useConflictWrite();
  const [editing, setEditing] = useState<OfferRecord | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null));
  const [askWithdraw, setAskWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const { application, offers } = detail;
  const appId = application.id;
  const set = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const sorted = [...offers].sort((a, b) => b.received_at - a.received_at);
  const ids = useMemo(() => sorted.map((offer) => offer.id), [sorted]);
  const selection = useSelection(ids);
  const movable =
    editing === "new"
      ? ["applied", "interviewing"].includes(application.stage)
      : draft.status === "accepted" && application.stage === "offer";

  function open(target: OfferRecord | "new") {
    setDraft(draftFrom(target === "new" ? null : target));
    setEditing(target);
  }

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.application(appId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.applicationEvents(appId),
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setBusy(true);
    const fields = fieldsFrom(draft);
    const declined =
      fields.status === "declined" &&
      (editing === "new" || editing.status !== "declined");
    try {
      if (editing === "new") {
        const result = await api("POST /api/v1/applications/{app_id}/offers", {
          params: { app_id: appId },
          body: {
            ...fields,
            move_application: movable && draft.moveApplication,
          },
          idempotencyKey: newIdempotencyKey(),
        });
        if (result.application) {
          commitApplicationToBoard(queryClient, result.application);
        }
      } else {
        const outcome = await write<OfferRecord>(
          {
            base: editing,
            changes: fields,
            fields: OFFER_FIELDS,
            send: async (baseRevision, changes) => {
              const result = await api(
                "PATCH /api/v1/applications/{app_id}/offers/{ofr_id}",
                {
                  params: { app_id: appId, ofr_id: editing.id },
                  body: {
                    ...changes,
                    base_revision: baseRevision,
                    move_application: movable && draft.moveApplication,
                  },
                  idempotencyKey: newIdempotencyKey(),
                }
              );
              if (result.application) {
                commitApplicationToBoard(queryClient, result.application);
              }
              return result.offer;
            },
          },
          { what: t("offers.what") }
        );
        if (!outcome || outcome.kind === "overlap") {
          await refresh();
          setEditing(null);
          return;
        }
      }
      toast.success(t("offers.saved"));
      setEditing(null);
      await refresh();
      if (
        declined &&
        !["rejected", "withdrawn", "accepted"].includes(application.stage)
      ) {
        setAskWithdraw(true);
      }
    } catch {
      toast.error(t("offers.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(offer: OfferRecord) {
    try {
      await api("DELETE /api/v1/applications/{app_id}/offers/{ofr_id}", {
        params: { app_id: appId, ofr_id: offer.id },
        query: { base_revision: offer.revision },
        idempotencyKey: newIdempotencyKey(),
      });
      setEditing(null);
      await refresh();
    } catch {
      toast.error(t("offers.deleteFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-subtitle weight-semibold">{t("offers.heading")}</h2>
        <Button onClick={() => open("new")} size="sm" variant="outline">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t("offers.add")}
        </Button>
      </div>
      <OffersBulkBar appId={appId} offers={sorted} selection={selection} />
      {sorted.length === 0 ? (
        <p className="type-body text-muted-foreground">{t("offers.empty")}</p>
      ) : (
        <div className="overflow-x-auto border border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <SelectAllCheckbox selection={selection} />
                </TableHead>
                <TableHead>{t("offers.received")}</TableHead>
                <TableHead>{t("offers.base")}</TableHead>
                <TableHead>{t("offers.deadline")}</TableHead>
                <TableHead>{t("offers.status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((offer) => (
                <TableRow
                  data-state={
                    selection.isSelected(offer.id) ? "selected" : undefined
                  }
                  key={offer.id}
                >
                  <TableCell>
                    <RowCheckbox
                      id={offer.id}
                      label={t("offers.rowLabel", {
                        date: formatDate(offer.received_at, locale),
                      })}
                      selection={selection}
                    />
                  </TableCell>
                  <TableCell>{formatDate(offer.received_at, locale)}</TableCell>
                  <TableCell className="text-foreground tabular-nums">
                    {offer.compensation.base == null
                      ? (offer.compensation.raw ?? "—")
                      : `${formatMoney(offer.compensation.base, offer.compensation.currency, locale)}${offer.compensation.period ? ` ${t(`salaryPeriods.${offer.compensation.period}`)}` : ""}`}
                  </TableCell>
                  <TableCell>
                    {offer.deadline_at
                      ? formatDate(offer.deadline_at, locale)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        offer.status === "open" ? "secondary" : "outline"
                      }
                    >
                      {offerStatusLabel(t, offer.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      onClick={() => open(offer)}
                      size="xs"
                      variant="ghost"
                    >
                      {t("common.edit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet
        onOpenChange={(value) => !value && setEditing(null)}
        open={editing !== null}
      >
        <SheetContent className="sm:max-w-md">
          <form className="flex h-full flex-col" onSubmit={save}>
            <SheetHeader>
              <SheetTitle>
                {editing === "new"
                  ? t("offers.addTitle")
                  : t("offers.editTitle")}
              </SheetTitle>
              <SheetDescription>{t("offers.sheetHelp")}</SheetDescription>
            </SheetHeader>
            <FieldGroup className="flex-1 gap-4 overflow-y-auto px-4 pb-4">
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor={`${id}-received`}>
                    {t("offers.received")}
                  </FieldLabel>
                  <Input
                    className="field-touch"
                    id={`${id}-received`}
                    onChange={(event) => set({ received: event.target.value })}
                    type="date"
                    value={draft.received}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-deadline`}>
                    {t("offers.deadline")}
                  </FieldLabel>
                  <Input
                    className="field-touch"
                    id={`${id}-deadline`}
                    onChange={(event) => set({ deadline: event.target.value })}
                    type="date"
                    value={draft.deadline}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field className="col-span-2">
                  <FieldLabel htmlFor={`${id}-base`}>
                    {t("offers.base")}
                  </FieldLabel>
                  <Input
                    className="field-touch"
                    id={`${id}-base`}
                    inputMode="decimal"
                    min={0}
                    onChange={(event) => set({ base: event.target.value })}
                    type="number"
                    value={draft.base}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-currency`}>
                    {t("offers.currency")}
                  </FieldLabel>
                  <Input
                    className="field-touch"
                    id={`${id}-currency`}
                    maxLength={3}
                    onChange={(event) => set({ currency: event.target.value })}
                    value={draft.currency}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor={`${id}-period`}>
                  {t("offers.period")}
                </FieldLabel>
                <Select
                  onValueChange={(value) =>
                    set({ period: value as SalaryPeriod })
                  }
                  value={draft.period}
                >
                  <SelectTrigger className="w-full" id={`${id}-period`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SALARY_PERIODS.map((period) => (
                      <SelectItem key={period} value={period}>
                        {t(`salaryPeriods.${period}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor={`${id}-bonus`}>
                    {t("offers.bonus")}
                  </FieldLabel>
                  <Input
                    className="field-touch"
                    id={`${id}-bonus`}
                    onChange={(event) => set({ bonus: event.target.value })}
                    value={draft.bonus}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-equity`}>
                    {t("offers.equity")}
                  </FieldLabel>
                  <Input
                    className="field-touch"
                    id={`${id}-equity`}
                    onChange={(event) => set({ equity: event.target.value })}
                    value={draft.equity}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor={`${id}-raw`}>{t("offers.raw")}</FieldLabel>
                <Input
                  className="field-touch"
                  id={`${id}-raw`}
                  onChange={(event) => set({ raw: event.target.value })}
                  value={draft.raw}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-status`}>
                  {t("offers.status")}
                </FieldLabel>
                <Select
                  onValueChange={(value) =>
                    set({ status: value as OfferStatus })
                  }
                  value={draft.status}
                >
                  <SelectTrigger className="w-full" id={`${id}-status`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OFFER_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {offerStatusLabel(t, status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-notes`}>
                  {t("offers.notes")}
                </FieldLabel>
                <Textarea
                  className="field-touch"
                  id={`${id}-notes`}
                  onChange={(event) => set({ notes: event.target.value })}
                  value={draft.notes}
                />
              </Field>
              {movable ? (
                <Field orientation="horizontal">
                  <Switch
                    checked={draft.moveApplication}
                    id={`${id}-move`}
                    onCheckedChange={(value) => set({ moveApplication: value })}
                  />
                  <FieldLabel htmlFor={`${id}-move`}>
                    {editing === "new"
                      ? t("offers.moveToOffer")
                      : t("offers.moveToAccepted")}
                  </FieldLabel>
                </Field>
              ) : null}
            </FieldGroup>
            <SheetFooter className="flex-row justify-between border-line border-t">
              {editing && editing !== "new" ? (
                <Button
                  onClick={() => remove(editing)}
                  type="button"
                  variant="destructive"
                >
                  {t("common.delete")}
                </Button>
              ) : (
                <span />
              )}
              <Button disabled={busy} type="submit">
                {t("common.save")}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <AlertDialog onOpenChange={setAskWithdraw} open={askWithdraw}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("offers.withdrawTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("offers.withdrawBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("offers.keepStage")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onMove("withdrawn")}
              variant="destructive"
            >
              {t("offers.withdraw")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Bulk Delete of the selected offers (confirmed, one DELETE each). */
function OffersBulkBar({
  appId,
  offers,
  selection,
}: {
  appId: string;
  offers: readonly OfferRecord[];
  selection: Selection;
}) {
  const { locale, t } = useTranslation();
  const invalidate = useMemo(
    () => [
      queryKeys.application(appId),
      queryKeys.applicationEvents(appId),
      queryKeys.boardAll,
    ],
    [appId]
  );
  const bulk = useBulkRun({ invalidate, onSucceeded: selection.clear });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const rows = selection.selectedIds.flatMap((id) => {
    const offer = byId.get(id);
    return offer
      ? [
          {
            id,
            label: t("offers.rowLabel", {
              date: formatDate(offer.received_at, locale),
            }),
          },
        ]
      : [];
  });

  async function remove() {
    await bulk.run(t("offers.bulk.delete"), rows, async (id) => {
      const offer = byId.get(id);
      if (!offer) {
        throw new BulkSkip("gone", t("offers.bulk.gone"));
      }
      await api("DELETE /api/v1/applications/{app_id}/offers/{ofr_id}", {
        params: { app_id: appId, ofr_id: id },
        query: { base_revision: offer.revision },
        idempotencyKey: newIdempotencyKey(),
      });
    });
    setConfirmDelete(false);
  }

  return (
    <>
      <BulkToolbar count={rows.length} onClear={selection.clear}>
        <Button
          disabled={bulk.busy}
          onClick={() => setConfirmDelete(true)}
          size="sm"
          variant="ghost"
        >
          {t("offers.bulk.delete")}
        </Button>
      </BulkToolbar>
      <BulkConfirmDialog
        body={t("offers.bulk.deleteBody")}
        busy={bulk.busy}
        confirmLabel={t("bulk.delete", { count: rows.length })}
        onConfirm={remove}
        onOpenChange={setConfirmDelete}
        open={confirmDelete}
        title={t("offers.bulk.deleteTitle", { count: rows.length })}
      />
      <BulkRunResultsDialog onClose={bulk.closeReport} report={bulk.report} />
    </>
  );
}
