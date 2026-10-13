// Facts (12 §9): a grouped form over the canonical keys (03 §9) — contact,
// links, work authorization, preferences — each with its source chip (From
// CV, You, Verified). Saving sends only what changed, with each fact's
// revision; a fact changed elsewhere is reported and can be overwritten.

import type { PutFactsRequest } from "@pilihpendidikan/jobs-contracts/api";
import type { ApplicantFactRecord } from "@pilihpendidikan/jobs-contracts/records";
import { WORK_AUTH_STATUSES } from "@pilihpendidikan/jobs-contracts/scoring";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { useFacts } from "@/hooks/use-profile";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import type { FactEdit } from "@/lib/facts-form";
import {
  FACT_GROUPS,
  factText,
  factValue,
  planFactsSave,
} from "@/lib/facts-form";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

const WORK_AUTH_PREFIX = "work_auth.";
const COUNTRY_RE = /^[A-Z]{2}$/;

function SourceChip({ fact }: { fact: ApplicantFactRecord | undefined }) {
  const { t } = useTranslation();
  if (!fact) {
    return null;
  }
  return <Badge variant="outline">{t(`profile.sources.${fact.source}`)}</Badge>;
}

interface WorkAuthRow {
  country: string;
  rowId: string;
  status: string;
}

export function FactsTab() {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const facts = useFacts();
  const byKey = useMemo(
    () => new Map((facts.data?.facts ?? []).map((fact) => [fact.key, fact])),
    [facts.data]
  );
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [workAuth, setWorkAuth] = useState<WorkAuthRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const group of FACT_GROUPS) {
      for (const field of group.fields) {
        next[field.key] = factText(byKey.get(field.key)?.value, field.input);
      }
    }
    setTexts(next);
    setWorkAuth(
      [...byKey.values()]
        .filter((fact) => fact.key.startsWith(WORK_AUTH_PREFIX))
        .map((fact) => ({
          rowId: fact.id,
          country: fact.key.slice(WORK_AUTH_PREFIX.length),
          status: (fact.value as { status?: string } | null)?.status ?? "none",
        }))
    );
  }, [byKey]);

  function edits(): FactEdit[] {
    const list: FactEdit[] = [];
    for (const group of FACT_GROUPS) {
      for (const field of group.fields) {
        list.push({
          key: field.key,
          value: factValue(texts[field.key] ?? "", field.input),
        });
      }
    }
    const kept = new Set<string>();
    for (const row of workAuth) {
      const country = row.country.trim().toUpperCase();
      if (COUNTRY_RE.test(country)) {
        kept.add(`${WORK_AUTH_PREFIX}${country}`);
        list.push({
          key: `${WORK_AUTH_PREFIX}${country}`,
          value: { status: row.status },
        });
      }
    }
    for (const key of byKey.keys()) {
      if (key.startsWith(WORK_AUTH_PREFIX) && !kept.has(key)) {
        list.push({ key, value: null });
      }
    }
    return list;
  }

  async function send(request: PutFactsRequest) {
    const result = await api("PUT /api/v1/profile/facts", {
      body: request,
      idempotencyKey: newIdempotencyKey(),
    });
    queryClient.setQueryData(queryKeys.facts, {
      facts: result.facts,
      profile_version: result.profile_version,
    });
    return result;
  }

  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const plan = planFactsSave(facts.data?.facts ?? [], edits());
    if (!plan.ok) {
      setErrors(plan.errors);
      toast.error(t("profile.invalid"));
      return;
    }
    setErrors({});
    if (plan.changed === 0) {
      toast.info(t("profile.noChanges"));
      return;
    }
    setBusy(true);
    try {
      const result = await send(plan.request);
      const conflicts = result.results.filter(
        (entry) => entry.status === "conflict"
      );
      if (conflicts.length === 0) {
        toast.success(t("profile.saved"));
        return;
      }
      // 12 §11: the same fact changed elsewhere — never retried on its own.
      const retry: PutFactsRequest = {
        facts: plan.request.facts
          .filter((fact) => conflicts.some((entry) => entry.key === fact.key))
          .map((fact) => ({
            ...fact,
            base_revision: conflicts.find((entry) => entry.key === fact.key)
              ?.current?.revision,
          })),
      };
      toast.warning(
        t("profile.conflict", {
          keys: conflicts.map((entry) => entry.key).join(", "),
        }),
        {
          duration: 15_000,
          action: {
            label: t("conflict.applyMine"),
            onClick: () => send(retry),
          },
          cancel: { label: t("conflict.keepTheirs"), onClick: () => undefined },
        }
      );
    } catch {
      toast.error(t("profile.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  useShortcut("s", () => save());

  if (facts.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <form className="flex max-w-3xl flex-col gap-8" onSubmit={save}>
      {FACT_GROUPS.map((group) => (
        <FieldSet key={group.id}>
          <FieldLegend>{t(`profile.groups.${group.id}`)}</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.fields.map((field) => {
              const fieldId = `${id}-${field.key}`;
              const fact = byKey.get(field.key);
              if (field.input === "boolean") {
                return (
                  <Field key={field.key} orientation="horizontal">
                    <Checkbox
                      checked={texts[field.key] === "true"}
                      id={fieldId}
                      onCheckedChange={(value) =>
                        setTexts((current) => ({
                          ...current,
                          [field.key]: value === true ? "true" : "",
                        }))
                      }
                    />
                    <FieldLabel htmlFor={fieldId}>
                      {t(`profile.facts.${field.key}`)}
                    </FieldLabel>
                    <SourceChip fact={fact} />
                  </Field>
                );
              }
              return (
                <Field
                  data-invalid={Boolean(errors[field.key])}
                  key={field.key}
                >
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor={fieldId}>
                      {t(`profile.facts.${field.key}`)}
                    </FieldLabel>
                    <SourceChip fact={fact} />
                  </div>
                  <Input
                    aria-invalid={Boolean(errors[field.key]) || undefined}
                    className="field-touch"
                    id={fieldId}
                    onChange={(event) =>
                      setTexts((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    type={field.input === "list" ? "text" : field.input}
                    value={texts[field.key] ?? ""}
                  />
                  {errors[field.key] ? (
                    <FieldError>{errors[field.key]}</FieldError>
                  ) : null}
                  {field.input === "list" ? (
                    <FieldDescription>{t("profile.listHelp")}</FieldDescription>
                  ) : null}
                </Field>
              );
            })}
          </div>
        </FieldSet>
      ))}
      <FieldSet>
        <FieldLegend>{t("profile.groups.workAuth")}</FieldLegend>
        <FieldDescription>{t("profile.workAuthHelp")}</FieldDescription>
        <div className="flex flex-col gap-2">
          {workAuth.map((row) => (
            <div className="flex items-end gap-2" key={row.rowId}>
              <Field className="w-24">
                <FieldLabel htmlFor={`${id}-${row.rowId}-country`}>
                  {t("profile.country")}
                </FieldLabel>
                <Input
                  className="field-touch"
                  id={`${id}-${row.rowId}-country`}
                  maxLength={2}
                  onChange={(event) =>
                    setWorkAuth((rows) =>
                      rows.map((entry) =>
                        entry.rowId === row.rowId
                          ? {
                              ...entry,
                              country: event.target.value.toUpperCase(),
                            }
                          : entry
                      )
                    )
                  }
                  value={row.country}
                />
              </Field>
              <Field className="flex-1">
                <FieldLabel htmlFor={`${id}-${row.rowId}-status`}>
                  {t("profile.workAuthStatus")}
                </FieldLabel>
                <Select
                  onValueChange={(value) =>
                    setWorkAuth((rows) =>
                      rows.map((entry) =>
                        entry.rowId === row.rowId
                          ? { ...entry, status: value }
                          : entry
                      )
                    )
                  }
                  value={row.status}
                >
                  <SelectTrigger
                    className="w-full"
                    id={`${id}-${row.rowId}-status`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_AUTH_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(`profile.workAuthStatuses.${status}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button
                aria-label={t("common.delete")}
                onClick={() =>
                  setWorkAuth((rows) =>
                    rows.filter((entry) => entry.rowId !== row.rowId)
                  )
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            className="self-start"
            onClick={() =>
              setWorkAuth((rows) => [
                ...rows,
                { rowId: crypto.randomUUID(), country: "", status: "citizen" },
              ])
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t("profile.addCountry")}
          </Button>
        </div>
      </FieldSet>
      <Button
        aria-keyshortcuts="S"
        className="self-start"
        disabled={busy}
        type="submit"
      >
        <Save aria-hidden="true" data-icon="inline-start" />
        {t("profile.save")}
        <Kbd aria-hidden="true">S</Kbd>
      </Button>
    </form>
  );
}
