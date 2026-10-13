// Automation → Rules (12 §6.2): the rules table with an enabled switch and
// the editor Sheet. Turning on an `auto` rule does not turn it on: the API
// answers with a `rule_activation` approval, shown at once in a dialog with
// the plain-language summary, and only typing the rule's exact name enables
// "Activate" (19 §8.3, D-35).

import type {
  AutomationRuleRecord,
  ApprovalRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Switch } from "@rulisme/ui/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, MoreHorizontal, Plus, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BulkConfirmDialog,
  BulkRunResultsDialog,
  BulkToolbar,
  RowCheckbox,
  SelectAllCheckbox,
} from "@/components/bulk/bulk-toolbar";
import { useDecideApproval, usePendingApprovals } from "@/hooks/use-approvals";
import { useBulkRun } from "@/hooks/use-bulk-run";
import { useConflictWrite } from "@/hooks/use-conflict-write";
import { useRuleSources, useRules } from "@/hooks/use-rules";
import type { Selection } from "@/hooks/use-selection";
import { useSelection } from "@/hooks/use-selection";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { api, isApiError } from "@/lib/api-client";
import { decideFailure, decideFailureKey } from "@/lib/approval-view";
import { BulkSkip } from "@/lib/bulk";
import { formatDate } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/idempotency";
import { modeLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";
import type { RuleForm } from "@/lib/rules-form";
import {
  activationSentence,
  createRuleBody,
  criteriaSummary,
  limitsSummary,
  RULE_FIELDS,
  updateRuleChanges,
} from "@/lib/rules-form";
import type { BulkRuleSkip } from "@/lib/rules-bulk";
import { bulkDisableSkip, bulkEnableSkip } from "@/lib/rules-bulk";
import { DecideDialog } from "./decide-dialog";
import { RuleEditor } from "./rule-editor";

type RuleStatus = "active" | "off" | "needs_activation" | "expired";

function ruleStatus(
  rule: AutomationRuleRecord,
  pendingActivation: ApprovalRecord | undefined,
  nowMs: number
): RuleStatus {
  const expiresAt = rule.limits.expires_at ?? null;
  if (expiresAt !== null && expiresAt <= nowMs) {
    return "expired";
  }
  if (pendingActivation) {
    return "needs_activation";
  }
  if (!rule.enabled) {
    return "off";
  }
  if (rule.mode === "auto" && rule.activated_approval_id === null) {
    return "needs_activation";
  }
  return "active";
}

function StatusBadge({ status }: { status: RuleStatus }) {
  const { t } = useTranslation();
  return (
    <Badge
      className={status === "needs_activation" ? "text-destructive" : undefined}
      variant={status === "active" ? "secondary" : "outline"}
    >
      {status === "active" ? <ShieldCheck aria-hidden="true" /> : null}
      {status === "needs_activation" ? (
        <CircleAlert aria-hidden="true" />
      ) : null}
      {t(`rules.status.${status}`)}
    </Badge>
  );
}

function editorKey(editing: AutomationRuleRecord | "new" | null): string {
  if (editing === null) {
    return "closed";
  }
  return editing === "new" ? "new" : editing.id;
}

interface Activation {
  approval: ApprovalRecord;
  rule: AutomationRuleRecord;
}

function activationText(
  t: Translate,
  activation: Activation,
  locale: "en" | "id",
  sourceNames: (ids: readonly string[]) => string[]
): string {
  const { approval, rule } = activation;
  if (approval.payload.type === "rule_activation" && approval.payload.summary) {
    return approval.payload.summary;
  }
  return activationSentence(t, rule, {
    sources: sourceNames(rule.criteria.source_ids ?? []),
    until: rule.limits.expires_at
      ? formatDate(rule.limits.expires_at, locale)
      : null,
  });
}

const BULK_INVALIDATE = [queryKeys.rules, queryKeys.approvalsAll] as const;

function bulkSkipMessage(t: Translate, reason: BulkRuleSkip): string {
  switch (reason) {
    case "already_on":
      return t("rules.bulk.skip.alreadyOn");
    case "already_off":
      return t("rules.bulk.skip.alreadyOff");
    case "needs_activation":
      return t("rules.bulk.skip.needsActivation");
    default:
      return t("rules.bulk.skip.expired");
  }
}

/** `PATCH /api/v1/rules/{id}` `{enabled}` at the rule's revision, no merge. */
async function sendEnabled(rule: AutomationRuleRecord, enabled: boolean) {
  await api("PATCH /api/v1/rules/{rul_id}", {
    params: { rul_id: rule.id },
    body: { enabled, base_revision: rule.revision },
    idempotencyKey: newIdempotencyKey(),
  });
}

/** `DELETE /api/v1/rules/{id}` at the rule's revision (the single delete's call). */
async function sendDelete(rule: AutomationRuleRecord) {
  await api("DELETE /api/v1/rules/{rul_id}", {
    params: { rul_id: rule.id },
    query: { base_revision: rule.revision },
    idempotencyKey: newIdempotencyKey(),
  });
}

/**
 * Bulk Turn on / Turn off / Delete on the selected rules (each its own
 * request with its base_revision; a rule changed elsewhere is reported, not
 * merged). Turning an `auto` rule on is never done in bulk: it needs its own
 * activation with the name typed, so it is skipped with that reason.
 */
function BulkRuleActions({
  list,
  selection,
  disabled,
}: {
  list: readonly AutomationRuleRecord[];
  selection: Selection;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const bulk = useBulkRun({
    invalidate: BULK_INVALIDATE,
    onSucceeded: selection.clear,
  });
  const [deleting, setDeleting] = useState<AutomationRuleRecord[] | null>(null);

  function chosen(): AutomationRuleRecord[] {
    const ids = new Set(selection.selectedIds);
    return list.filter((rule) => ids.has(rule.id));
  }

  async function run(
    action: string,
    rules: readonly AutomationRuleRecord[],
    work: (rule: AutomationRuleRecord) => Promise<void>
  ) {
    const byId = new Map(rules.map((rule) => [rule.id, rule]));
    await bulk.run(
      action,
      rules.map((rule) => ({ id: rule.id, label: rule.name })),
      async (id) => {
        const rule = byId.get(id);
        if (rule) {
          await work(rule);
        }
      }
    );
  }

  function setEnabled(enabled: boolean) {
    const nowMs = Date.now();
    return run(
      enabled ? t("rules.bulk.actionEnable") : t("rules.bulk.actionDisable"),
      chosen(),
      async (rule) => {
        const reason = enabled
          ? bulkEnableSkip(rule, nowMs)
          : bulkDisableSkip(rule);
        if (reason) {
          throw new BulkSkip(reason, bulkSkipMessage(t, reason));
        }
        await sendEnabled(rule, enabled);
      }
    );
  }

  async function remove() {
    if (!deleting) {
      return;
    }
    await run(t("rules.bulk.actionDelete"), deleting, sendDelete);
    setDeleting(null);
  }

  const off = disabled || bulk.busy;
  return (
    <>
      <BulkToolbar count={selection.size} onClear={selection.clear}>
        <Button
          disabled={off}
          onClick={() => setEnabled(true)}
          size="sm"
          variant="outline"
        >
          {t("rules.bulk.enable")}
        </Button>
        <Button
          disabled={off}
          onClick={() => setEnabled(false)}
          size="sm"
          variant="outline"
        >
          {t("rules.bulk.disable")}
        </Button>
        <Button
          disabled={off}
          onClick={() => setDeleting(chosen())}
          size="sm"
          variant="outline"
        >
          {t("rules.bulk.delete")}
        </Button>
      </BulkToolbar>
      <BulkConfirmDialog
        body={t("rules.bulk.deleteBody", { count: deleting?.length ?? 0 })}
        busy={bulk.busy}
        confirmDisabled={(deleting?.length ?? 0) === 0}
        confirmLabel={t("rules.bulk.deleteConfirm", {
          count: deleting?.length ?? 0,
        })}
        onConfirm={remove}
        onOpenChange={(next) => {
          if (!next) {
            setDeleting(null);
          }
        }}
        open={deleting !== null}
        title={t("rules.bulk.deleteTitle")}
      />
      <BulkRunResultsDialog onClose={bulk.closeReport} report={bulk.report} />
    </>
  );
}

export function RulesPage() {
  const { locale, t } = useTranslation();
  const queryClient = useQueryClient();
  const rules = useRules();
  const sources = useRuleSources();
  const pending = usePendingApprovals();
  const write = useConflictWrite();
  const decide = useDecideApproval();
  const [editing, setEditing] = useState<AutomationRuleRecord | "new" | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [deleting, setDeleting] = useState<AutomationRuleRecord | null>(null);
  const nowMs = Date.now();

  const activations = useMemo(() => {
    const byRule = new Map<string, ApprovalRecord>();
    for (const approval of pending.data ?? []) {
      if (approval.payload.type === "rule_activation") {
        byRule.set(approval.payload.rule_id, approval);
      }
    }
    return byRule;
  }, [pending.data]);

  const sourceLabel = useCallback(
    (id: string) => sources.byId.get(id)?.label ?? id,
    [sources.byId]
  );
  const sourceNames = useCallback(
    (ids: readonly string[]) => ids.map(sourceLabel),
    [sourceLabel]
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
      queryClient.invalidateQueries({ queryKey: queryKeys.approvalsAll }),
    ]);
  }, [queryClient]);

  function afterSave(rule: AutomationRuleRecord, approval?: ApprovalRecord) {
    if (approval && approval.state === "pending") {
      setActivation({ rule, approval });
      toast.info(t("rules.activationNeeded"));
    } else {
      toast.success(t("rules.saved"));
    }
  }

  async function update(
    rule: AutomationRuleRecord,
    changes: Record<string, unknown>
  ): Promise<boolean> {
    let approval: ApprovalRecord | undefined;
    const outcome = await write<AutomationRuleRecord>(
      {
        base: rule,
        changes,
        fields: RULE_FIELDS,
        send: async (baseRevision, fields) => {
          const result = await api("PATCH /api/v1/rules/{rul_id}", {
            params: { rul_id: rule.id },
            body: { ...fields, base_revision: baseRevision },
            idempotencyKey: newIdempotencyKey(),
          });
          approval = result.approval;
          return result.rule;
        },
      },
      { what: t("rules.what") }
    );
    await refresh();
    if (outcome?.kind === "saved") {
      afterSave(outcome.record, approval);
      return true;
    }
    return false;
  }

  async function save(form: RuleForm) {
    setBusy(true);
    try {
      if (editing === "new") {
        const result = await api("POST /api/v1/rules", {
          body: createRuleBody(form, Date.now()),
          idempotencyKey: newIdempotencyKey(),
        });
        await refresh();
        afterSave(result.rule, result.approval);
        setEditing(null);
      } else if (editing) {
        const changes = updateRuleChanges(editing, form, Date.now());
        if (Object.keys(changes).length === 0) {
          setEditing(null);
          return;
        }
        if (await update(editing, changes)) {
          setEditing(null);
        }
      }
    } catch (error) {
      toast.error(
        isApiError(error) && (error.status === 422 || error.status === 403)
          ? t("rules.refused", { message: error.message })
          : t("rules.saveFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(rule: AutomationRuleRecord, enabled: boolean) {
    setBusy(true);
    try {
      await update(rule, { enabled });
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!activation) {
      return;
    }
    setBusy(true);
    try {
      await decide({ approval: activation.approval, decision: "approve" });
      toast.success(t("rules.activated", { name: activation.rule.name }));
      setActivation(null);
      await refresh();
    } catch (error) {
      toast.error(t(decideFailureKey(decideFailure(error))));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) {
      return;
    }
    setBusy(true);
    try {
      await api("DELETE /api/v1/rules/{rul_id}", {
        params: { rul_id: deleting.id },
        query: { base_revision: deleting.revision },
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(t("rules.deleted"));
      setDeleting(null);
      await refresh();
    } catch (error) {
      toast.error(
        isApiError(error) && error.isRevisionConflict
          ? t("rules.changedMeanwhile")
          : t("rules.deleteFailed")
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const list = useMemo(() => rules.data ?? [], [rules.data]);
  const ruleIds = useMemo(() => list.map((rule) => rule.id), [list]);
  const selection = useSelection(ruleIds);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="band flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
        <p className="type-caption max-w-2xl text-muted-foreground">
          {t("rules.intro")}
        </p>
        <Button
          className="ml-auto"
          onClick={() => setEditing("new")}
          size="sm"
          variant="outline"
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t("rules.new")}
        </Button>
      </div>
      <BulkRuleActions disabled={busy} list={list} selection={selection} />
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
        {rules.isError && !rules.data ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{t("rules.loadErrorTitle")}</AlertTitle>
            <AlertDescription>{t("rules.loadError")}</AlertDescription>
            <AlertAction>
              <Button
                onClick={() => rules.refetch()}
                size="sm"
                variant="outline"
              >
                {t("common.retry")}
              </Button>
            </AlertAction>
          </Alert>
        ) : null}
        {rules.isPending ? (
          <div aria-hidden="true" className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : null}
        {rules.isSuccess && list.length === 0 ? (
          <Empty className="border border-line">
            <EmptyHeader>
              <EmptyTitle>{t("rules.empty")}</EmptyTitle>
              <EmptyDescription>{t("rules.emptyHelp")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setEditing("new")} variant="outline">
                <Plus aria-hidden="true" data-icon="inline-start" />
                {t("rules.new")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
        {list.length > 0 ? (
          <div className="border border-line">
            <Table className="type-body-compact">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <SelectAllCheckbox disabled={busy} selection={selection} />
                  </TableHead>
                  <TableHead>{t("rules.name")}</TableHead>
                  <TableHead>{t("rules.mode")}</TableHead>
                  <TableHead>{t("rules.criteria")}</TableHead>
                  <TableHead>{t("rules.limits")}</TableHead>
                  <TableHead>{t("rules.statusLabel")}</TableHead>
                  <TableHead>{t("rules.enabled")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((rule) => {
                  const pendingActivation = activations.get(rule.id);
                  const status = ruleStatus(rule, pendingActivation, nowMs);
                  return (
                    <TableRow
                      data-state={
                        selection.isSelected(rule.id) ? "selected" : undefined
                      }
                      key={rule.id}
                    >
                      <TableCell>
                        <RowCheckbox
                          id={rule.id}
                          label={rule.name}
                          selection={selection}
                        />
                      </TableCell>
                      <TableCell className="weight-semibold text-foreground">
                        <button
                          className="text-left hover:underline"
                          onClick={() => setEditing(rule)}
                          type="button"
                        >
                          {rule.name}
                        </button>
                      </TableCell>
                      <TableCell>{modeLabel(t, rule.mode)}</TableCell>
                      <TableCell className="max-w-72 whitespace-normal">
                        {criteriaSummary(t, rule.criteria, sourceLabel)}
                      </TableCell>
                      <TableCell className="max-w-56 whitespace-normal">
                        {limitsSummary(t, rule.limits)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge status={status} />
                          {pendingActivation ? (
                            <Button
                              onClick={() =>
                                setActivation({
                                  rule,
                                  approval: pendingActivation,
                                })
                              }
                              size="xs"
                              variant="outline"
                            >
                              {t("rules.activate")}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          aria-label={t("rules.enableNamed", {
                            name: rule.name,
                          })}
                          checked={rule.enabled}
                          disabled={busy}
                          onCheckedChange={(on) => setEnabled(rule, on)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-label={t("rules.actionsFor", {
                                name: rule.name,
                              })}
                              size="icon-xs"
                              variant="ghost"
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(rule)}>
                              {t("common.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setDeleting(rule)}
                              variant="destructive"
                            >
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
      <RuleEditor
        busy={busy}
        key={editorKey(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
        onSave={save}
        open={editing !== null}
        rule={editing === "new" ? null : editing}
      />
      {activation ? (
        <DecideDialog
          busy={busy}
          confirmLabel={t("approvals.actions.activate")}
          decision="approve"
          description={
            <>
              <p>{activationText(t, activation, locale, sourceNames)}</p>
              <p>{t("rules.activationWarning")}</p>
            </>
          }
          onConfirm={activate}
          onOpenChange={(open) => {
            if (!(open || busy)) {
              setActivation(null);
            }
          }}
          open
          title={t("approvals.confirm.rule", { name: activation.rule.name })}
          typeToConfirm={activation.rule.name}
        />
      ) : null}
      <AlertDialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setDeleting(null);
          }
        }}
        open={deleting !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("rules.deleteTitle", { name: deleting?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("rules.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <Button disabled={busy} onClick={remove} variant="destructive">
              {t("common.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
