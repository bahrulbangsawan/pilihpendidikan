// Bulk actions on the selected devices (12 §7): "Take tasks" on / off (one
// PATCH per device with its base_revision) and Revoke (one POST …/revoke
// per device, confirmed with what it stops, as the single revoke does).
// Revoked devices are skipped; signed-out ones can't take tasks.

import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import type { AutomationTaskRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@rulisme/ui/ui/alert-dialog";
import { Button } from "@rulisme/ui/ui/button";
import { useState } from "react";
import {
  BulkRunResultsDialog,
  BulkToolbar,
} from "@/components/bulk/bulk-toolbar";
import { useBulkRun } from "@/hooks/use-bulk-run";
import type { Selection } from "@/hooks/use-selection";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { BulkSkip } from "@/lib/bulk";
import { bulkRevokePlan, deviceStatus } from "@/lib/devices-model";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

const INVALIDATE = [queryKeys.devices, queryKeys.tasksAll] as const;

export function DevicesBulkBar({
  selection,
  devices,
  tasks,
}: {
  devices: readonly DeviceView[];
  selection: Selection;
  tasks: readonly AutomationTaskRecord[];
}) {
  const { t } = useTranslation();
  const bulk = useBulkRun({
    invalidate: INVALIDATE,
    onSucceeded: selection.clear,
  });
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const byId = new Map(devices.map((device) => [device.id, device]));
  const selected = selection.selectedIds
    .map((id) => byId.get(id))
    .filter((device): device is DeviceView => device !== undefined);
  const rows = selected.map((device) => ({
    id: device.id,
    label: device.name,
  }));

  function deviceOf(id: string): DeviceView {
    const device = byId.get(id);
    if (!device) {
      throw new BulkSkip("gone", t("devices.revoke.gone"));
    }
    if (device.revoked_at !== null) {
      throw new BulkSkip("revoked", t("devices.bulk.alreadyRevoked"));
    }
    return device;
  }

  function setAcceptsTasks(value: boolean) {
    return bulk.run(
      value ? t("devices.bulk.tasksOn") : t("devices.bulk.tasksOff"),
      rows,
      async (id) => {
        const device = deviceOf(id);
        if (deviceStatus(device).kind === "signed_out") {
          throw new BulkSkip("signed_out", t("devices.bulk.signedOut"));
        }
        if (device.accepts_tasks === value) {
          throw new BulkSkip("unchanged", t("devices.bulk.unchanged"));
        }
        await api("PATCH /api/v1/devices/{dev_id}", {
          params: { dev_id: id },
          body: { accepts_tasks: value, base_revision: device.revision },
          idempotencyKey: newIdempotencyKey(),
        });
      }
    );
  }

  async function revokeAll() {
    await bulk.run(t("devices.bulk.revoke"), rows, async (id) => {
      deviceOf(id);
      await api("POST /api/v1/devices/{dev_id}/revoke", {
        params: { dev_id: id },
        idempotencyKey: newIdempotencyKey(),
      });
    });
    setConfirmRevoke(false);
  }

  const live = selected.filter((device) => device.revoked_at === null);
  return (
    <>
      <BulkToolbar count={selected.length} onClear={selection.clear}>
        <Button
          disabled={bulk.busy || live.length === 0}
          onClick={() => setAcceptsTasks(true)}
          size="sm"
          variant="outline"
        >
          {t("devices.bulk.tasksOn")}
        </Button>
        <Button
          disabled={bulk.busy || live.length === 0}
          onClick={() => setAcceptsTasks(false)}
          size="sm"
          variant="outline"
        >
          {t("devices.bulk.tasksOff")}
        </Button>
        <Button
          disabled={bulk.busy || live.length === 0}
          onClick={() => setConfirmRevoke(true)}
          size="sm"
          variant="ghost"
        >
          {t("devices.bulk.revoke")}
        </Button>
      </BulkToolbar>
      <BulkRevokeDialog
        busy={bulk.busy}
        devices={devices}
        onConfirm={revokeAll}
        onOpenChange={setConfirmRevoke}
        open={confirmRevoke}
        selected={selection.selectedIds}
        tasks={tasks}
      />
      <BulkRunResultsDialog onClose={bulk.closeReport} report={bulk.report} />
    </>
  );
}

function BulkRevokeDialog({
  open,
  busy,
  selected,
  devices,
  tasks,
  onConfirm,
  onOpenChange,
}: {
  busy: boolean;
  devices: readonly DeviceView[];
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selected: readonly string[];
  tasks: readonly AutomationTaskRecord[];
}) {
  const { t } = useTranslation();
  const plan = bulkRevokePlan(selected, devices, tasks);
  const count = selected.length - plan.alreadyRevoked;
  const { consequences } = plan;
  const lines = [t("devices.bulk.signsOut", { count })];
  if (consequences.running === 1) {
    lines.push(t("devices.revoke.runningOne"));
  } else if (consequences.running > 1) {
    lines.push(
      t("devices.revoke.runningMany", { count: consequences.running })
    );
  }
  if (consequences.submitting > 0) {
    lines.push(
      t("devices.revoke.submitting", { count: consequences.submitting })
    );
  }
  if (consequences.pinned > 0) {
    lines.push(t("devices.bulk.pinned", { count: consequences.pinned }));
  }
  if (consequences.running === 0 && consequences.pinned === 0) {
    lines.push(t("devices.bulk.idle"));
  }
  if (plan.alreadyRevoked > 0) {
    lines.push(t("devices.bulk.skipRevoked", { count: plan.alreadyRevoked }));
  }
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
          <AlertDialogTitle>
            {t("devices.bulk.revokeTitle", { count })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {plan.leavesNone ? (
                <p className="weight-semibold text-destructive" role="alert">
                  {t("devices.bulk.leavesNone")}
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <Button disabled={busy} onClick={onConfirm} variant="destructive">
            {t("devices.bulk.revokeConfirm", { count })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
