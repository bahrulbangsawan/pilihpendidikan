// Rename (1–60 characters) and Revoke (an AlertDialog that names what
// happens to the device's work, 12 §7, 21 §10) for one device.

import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
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
import { Button } from "@rulisme/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rulisme/ui/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import type { FormEvent } from "react";
import { useEffect, useId, useState } from "react";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import type { RevokeConsequences } from "@/lib/devices-model";

export const DEVICE_NAME_MAX = 60;

/** The consequence sentences of revoking a device (12 §7). */
export function revokeConsequenceText(
  t: Translate,
  name: string,
  consequences: RevokeConsequences
): string[] {
  const lines = [t("devices.revoke.signsOut", { name })];
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
  if (consequences.pinned === 1) {
    lines.push(t("devices.revoke.pinnedOne"));
  } else if (consequences.pinned > 1) {
    lines.push(t("devices.revoke.pinnedMany", { count: consequences.pinned }));
  }
  if (consequences.running === 0 && consequences.pinned === 0) {
    lines.push(t("devices.revoke.idle"));
  }
  return lines;
}

export function RevokeDialog({
  device,
  consequences,
  onCancel,
  onConfirm,
}: {
  consequences: RevokeConsequences;
  device: DeviceView | null;
  onCancel: () => void;
  onConfirm: (device: DeviceView) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const lines = device
    ? revokeConsequenceText(t, device.name, consequences)
    : [];
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open={device !== null}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("devices.revoke.title", { name: device?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async (event) => {
              event.preventDefault();
              if (!device) {
                return;
              }
              setBusy(true);
              const done = await onConfirm(device);
              setBusy(false);
              if (done) {
                onCancel();
              }
            }}
            variant="destructive"
          >
            {t("devices.revoke.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RenameDialog({
  device,
  onClose,
  onSave,
}: {
  device: DeviceView | null;
  onClose: () => void;
  onSave: (device: DeviceView, name: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setName(device?.name ?? "");
    setTouched(false);
  }, [device]);

  const trimmed = name.trim();
  const invalid = trimmed.length === 0 || trimmed.length > DEVICE_NAME_MAX;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!device || invalid) {
      return;
    }
    if (trimmed === device.name) {
      onClose();
      return;
    }
    setBusy(true);
    await onSave(device, trimmed);
    setBusy(false);
    onClose();
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={device !== null}
    >
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("devices.rename.title")}</DialogTitle>
            <DialogDescription>
              {t("devices.rename.description")}
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={(touched && invalid) || undefined}>
            <FieldLabel htmlFor={`${id}-name`}>
              {t("devices.rename.label")}
            </FieldLabel>
            <Input
              aria-describedby={`${id}-help`}
              aria-invalid={(touched && invalid) || undefined}
              autoFocus
              className="field-touch"
              id={`${id}-name`}
              maxLength={DEVICE_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
            {touched && invalid ? (
              <FieldError id={`${id}-help`}>
                {t("devices.rename.invalid", { max: DEVICE_NAME_MAX })}
              </FieldError>
            ) : (
              <FieldDescription id={`${id}-help`}>
                {t("devices.rename.help")}
              </FieldDescription>
            )}
          </Field>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button aria-keyshortcuts="Enter" disabled={busy} type="submit">
              {t("common.save")}
              <Kbd aria-hidden="true">↵</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
