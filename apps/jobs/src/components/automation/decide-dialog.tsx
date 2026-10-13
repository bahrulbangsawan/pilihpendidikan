// The confirmation every decision goes through (12 §6.1): "Submit this
// application to Acme? This can't be undone." Activating an `auto` rule also
// asks for its exact name (12 §6.2 step 3) before the button enables.

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
import { Field, FieldDescription, FieldLabel } from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "@/i18n";
import { nameConfirmed } from "@/lib/rules-form";

export interface DecideDialogProps {
  busy: boolean;
  confirmLabel: string;
  decision: "approve" | "reject";
  description: ReactNode;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  /** Rule activation: the name the user must type first. */
  typeToConfirm?: string | null;
}

export function DecideDialog({
  open,
  onOpenChange,
  decision,
  title,
  description,
  confirmLabel,
  typeToConfirm,
  busy,
  onConfirm,
}: DecideDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const [typed, setTyped] = useState("");
  const needsName = typeof typeToConfirm === "string";
  const ready = !busy && (!needsName || nameConfirmed(typed, typeToConfirm));

  useEffect(() => {
    if (!open) {
      setTyped("");
    }
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ready) {
      onConfirm();
    }
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <form className="contents" onSubmit={submit}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">{description}</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {needsName ? (
            <Field>
              <FieldLabel htmlFor={`${id}-name`}>
                {t("rules.typeName", { name: typeToConfirm })}
              </FieldLabel>
              <Input
                autoComplete="off"
                className="field-touch"
                id={`${id}-name`}
                onChange={(event) => setTyped(event.target.value)}
                value={typed}
              />
              <FieldDescription>{t("rules.typeNameHelp")}</FieldDescription>
            </Field>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <Button
              disabled={!ready}
              type="submit"
              variant={decision === "reject" ? "destructive" : "default"}
            >
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
