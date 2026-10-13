// The approval queue (12 §6.1, 21 §6.3): a 360px list and the selected
// approval's detail. Every decision goes through a confirmation and is bound
// to the approval's payload_hash; a changed form comes back as "The form
// changed since this was prepared". J / K move through the list, Y approves,
// X rejects (both still ask first). Pending approvals poll every 10 s.

import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { ApprovalRecord } from "@pilihpendidikan/jobs-contracts/records";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { cn } from "@rulisme/ui/lib/utils";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@rulisme/ui/ui/alert";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@rulisme/ui/ui/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CircleAlert, CircleCheck, CloudOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useBoard } from "@/hooks/use-board";
import { useDevices } from "@/hooks/use-devices";
import type { ApprovalView } from "@/hooks/use-approvals";
import {
  useDecideApproval,
  useDecidedApprovals,
  usePendingApprovals,
} from "@/hooks/use-approvals";
import { useRuleSources } from "@/hooks/use-rules";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import type { AnswerInput, DecideFailure } from "@/lib/approval-view";
import {
  answersComplete,
  buildAnswerResponse,
  countdown,
  decideFailure,
  decideFailureKey,
  initialAnswer,
  stepSelection,
} from "@/lib/approval-view";
import { formatClock, relativeTime } from "@/lib/format";
import { approvalKindLabel, approvalStateLabel } from "@/lib/labels";
import { POLL_POLICIES } from "@/lib/polling";
import { queryKeys } from "@/lib/query";
import { ApprovalBody } from "./approval-bodies";
import { DecideDialog } from "./decide-dialog";

const MINUTE_MS = 60_000;

export interface ApprovalsSearch {
  /** Preselects this approval (links from the Next-step rail, the monitor). */
  approval?: string;
  view?: ApprovalView;
}

interface Subject {
  company: string;
  title: string;
}

/** The application an approval is about, from the board's cards. */
function subjectOf(
  approval: ApprovalRecord,
  cards: ReadonlyMap<string, BoardCard>
): Subject | null {
  const card = approval.application_id
    ? cards.get(approval.application_id)
    : undefined;
  return card
    ? { company: card.posting.company_name, title: card.posting.title }
    : null;
}

function approvalHeading(
  t: Translate,
  approval: ApprovalRecord,
  subject: Subject | null
): string {
  const { payload } = approval;
  switch (payload.type) {
    case "browser_submit":
      return subject
        ? t("approvals.headings.submit", { ...subject })
        : t("approvals.headings.submitUnknown");
    case "email_submit":
      return t("approvals.headings.email", { to: payload.to });
    case "answer":
      return subject
        ? t("approvals.headings.answer", { ...subject })
        : t("approvals.headings.answerUnknown");
    case "cv_variant":
      return subject
        ? t("approvals.headings.cv", { ...subject })
        : t("approvals.headings.cvUnknown");
    default:
      return t("approvals.headings.rule", { name: payload.name });
  }
}

/** The list row's second line: who, or what the question asks. */
function rowHint(
  approval: ApprovalRecord,
  subject: Subject | null
): string | null {
  const { payload } = approval;
  if (payload.type === "answer") {
    const first = payload.questions[0]?.question ?? "";
    return subject ? `${subject.company} · “${first}”` : `“${first}”`;
  }
  if (payload.type === "rule_activation") {
    return payload.name;
  }
  if (payload.type === "email_submit") {
    return payload.to;
  }
  return subject ? `${subject.company} · ${subject.title}` : null;
}

interface DialogTexts {
  confirmLabel: string;
  description: string;
  title: string;
}

function approveTexts(
  t: Translate,
  approval: ApprovalRecord,
  subject: Subject | null
): DialogTexts {
  const { payload } = approval;
  switch (payload.type) {
    case "browser_submit":
      return {
        title: subject
          ? t("approvals.confirm.submit", { company: subject.company })
          : t("approvals.confirm.submitUnknown"),
        description: t("approvals.confirm.submitBody"),
        confirmLabel: t("approvals.actions.approveSubmit"),
      };
    case "email_submit":
      return {
        title: t("approvals.confirm.email", { to: payload.to }),
        description: t("approvals.confirm.emailBody"),
        confirmLabel: t("approvals.actions.approveEmail"),
      };
    case "answer":
      return {
        title: t("approvals.confirm.answer"),
        description: t("approvals.confirm.answerBody"),
        confirmLabel: t("approvals.actions.sendAnswers"),
      };
    case "cv_variant":
      return {
        title: t("approvals.confirm.cv"),
        description: t("approvals.confirm.cvBody"),
        confirmLabel: t("approvals.actions.approveCv"),
      };
    default:
      return {
        title: t("approvals.confirm.rule", { name: payload.name }),
        description: payload.summary,
        confirmLabel: t("approvals.actions.activate"),
      };
  }
}

function rejectTexts(t: Translate, approval: ApprovalRecord): DialogTexts {
  const kind = approval.kind;
  return {
    title: t(`approvals.reject.${kind}`),
    description: t(`approvals.reject.${kind}Body`),
    confirmLabel: t("approvals.actions.reject"),
  };
}

function approveLabel(t: Translate, approval: ApprovalRecord): string {
  switch (approval.payload.type) {
    case "browser_submit":
      return t("approvals.actions.approveSubmit");
    case "email_submit":
      return t("approvals.actions.approveEmail");
    case "answer":
      return t("approvals.actions.sendAnswers");
    case "cv_variant":
      return t("approvals.actions.approveCv");
    default:
      return t("approvals.actions.activate");
  }
}

function ApprovalRow({
  approval,
  subject,
  selected,
  nowMs,
  onSelect,
}: {
  approval: ApprovalRecord;
  subject: Subject | null;
  selected: boolean;
  nowMs: number;
  onSelect: () => void;
}) {
  const { locale, t } = useTranslation();
  const hint = rowHint(approval, subject);
  return (
    <li>
      <button
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full flex-col gap-0.5 border-line border-b px-4 py-2.5 text-left outline-none transition-[background-color] duration-150 ease-standard hover:bg-pane/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 sm:px-5",
          selected && "bg-pane-2 hover:bg-pane-2"
        )}
        data-approval-id={approval.id}
        onClick={onSelect}
        type="button"
      >
        <span className="type-body-compact flex items-center gap-2 text-foreground">
          {approval.state === "pending" ? (
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-foreground"
            />
          ) : null}
          <span className={cn("truncate", selected && "weight-semibold")}>
            {approvalKindLabel(t, approval.kind)}
          </span>
          <span className="type-micro ml-auto shrink-0 text-muted-foreground tabular-nums">
            {relativeTime(approval.created_at, nowMs, locale)}
          </span>
        </span>
        {hint ? (
          <span className="type-caption truncate text-muted-foreground">
            {hint}
          </span>
        ) : null}
        {approval.state === "pending" ? null : (
          <span className="type-micro text-muted-foreground">
            {approvalStateLabel(t, approval.state)}
          </span>
        )}
      </button>
    </li>
  );
}

function DetailMeta({
  approval,
  nowMs,
}: {
  approval: ApprovalRecord;
  nowMs: number;
}) {
  const { locale, t } = useTranslation();
  const { byId } = useDevices();
  const task = useQuery({
    queryKey: queryKeys.task(approval.task_id ?? "none"),
    queryFn: () =>
      api("GET /api/v1/tasks/{tsk_id}", {
        params: { tsk_id: approval.task_id ?? "" },
      }),
    enabled: approval.task_id !== null,
    staleTime: 30_000,
  });
  const parts: string[] = [];
  if (approval.state === "pending") {
    const left = countdown(approval.expires_at, nowMs);
    parts.push(
      left.expired
        ? t("approvals.expired")
        : t("approvals.expiresIn", { hours: left.hours, minutes: left.minutes })
    );
  } else if (approval.decided_at !== null) {
    parts.push(
      t("approvals.decidedAt", {
        state: approvalStateLabel(t, approval.state),
        time: relativeTime(approval.decided_at, nowMs, locale),
        via: approval.decided_via
          ? t(`approvals.via.${approval.decided_via}`)
          : t("approvals.via.unknown"),
      })
    );
  } else {
    parts.push(approvalStateLabel(t, approval.state));
  }
  const payload = approval.payload;
  const attemptId =
    payload.type === "browser_submit" || payload.type === "answer"
      ? payload.attempt_id
      : undefined;
  const deviceId =
    payload.type === "browser_submit" ? payload.device_id : undefined;
  const attempt = task.data?.attempts.find((entry) => entry.id === attemptId);
  const device =
    (deviceId ? byId.get(deviceId)?.name : undefined) ??
    task.data?.device_name ??
    null;
  if (device) {
    parts.push(t("approvals.fromDevice", { device }));
  }
  if (attempt) {
    parts.push(t("approvals.attempt", { n: attempt.attempt_no }));
  }
  return (
    <p className="type-caption text-muted-foreground tabular-nums">
      {parts.join(" · ")}
    </p>
  );
}

function ApprovalDetail({
  approval,
  subject,
  nowMs,
  failure,
  busy,
  answerInputs,
  onAnswerChange,
  onApprove,
  onReject,
  sourceLabel,
}: {
  approval: ApprovalRecord;
  subject: Subject | null;
  nowMs: number;
  failure: DecideFailure | null;
  busy: boolean;
  answerInputs: Readonly<Record<string, AnswerInput>>;
  onAnswerChange: (ref: string, input: AnswerInput) => void;
  onApprove: () => void;
  onReject: () => void;
  sourceLabel: (id: string) => string;
}) {
  const { t } = useTranslation();
  const pending = approval.state === "pending";
  const answersReady =
    approval.payload.type !== "answer" ||
    answersComplete(approval.payload.questions, answerInputs);
  return (
    <article
      aria-labelledby={`approval-${approval.id}`}
      className="flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-6"
    >
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{approvalKindLabel(t, approval.kind)}</Badge>
          {pending ? null : (
            <Badge variant="secondary">
              {approval.state === "approved" ? (
                <CircleCheck aria-hidden="true" />
              ) : (
                <CircleAlert aria-hidden="true" />
              )}
              {approvalStateLabel(t, approval.state)}
            </Badge>
          )}
        </div>
        <h2 className="type-subtitle" id={`approval-${approval.id}`}>
          {approvalHeading(t, approval, subject)}
        </h2>
        <DetailMeta approval={approval} nowMs={nowMs} />
      </header>
      {failure ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("approvals.errors.title")}</AlertTitle>
          <AlertDescription>{t(decideFailureKey(failure))}</AlertDescription>
        </Alert>
      ) : null}
      <ApprovalBody
        answerInputs={answerInputs}
        applicationHref={
          approval.application_id
            ? `/applications/${approval.application_id}`
            : null
        }
        approval={approval}
        disabled={!pending || busy}
        onAnswerChange={onAnswerChange}
        sourceLabel={sourceLabel}
      />
      <footer className="flex flex-wrap items-center gap-2 border-line border-t pt-4">
        {pending ? (
          <>
            <Button
              aria-keyshortcuts="Y"
              disabled={busy || !answersReady}
              onClick={onApprove}
            >
              {approveLabel(t, approval)}
              <Kbd aria-hidden="true">Y</Kbd>
            </Button>
            <Button
              aria-keyshortcuts="X"
              disabled={busy}
              onClick={onReject}
              variant="outline"
            >
              {t("approvals.actions.reject")}
              <Kbd aria-hidden="true">X</Kbd>
            </Button>
          </>
        ) : null}
        {approval.task_id ? (
          <Button asChild className="ml-auto" size="sm" variant="ghost">
            <Link
              params={{ tskId: approval.task_id }}
              to="/automation/runs/$tskId"
            >
              {t("approvals.openRun")}
              <ChevronRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function useCardsById(): ReadonlyMap<string, BoardCard> {
  const board = useBoard({ policy: POLL_POLICIES.shell });
  return useMemo(
    () =>
      new Map(
        (board.data?.board.columns ?? []).flatMap((column) =>
          column.cards.map((card) => [card.id, card] as const)
        )
      ),
    [board.data]
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface DialogState {
  approval: ApprovalRecord;
  decision: "approve" | "reject";
}

function dialogTexts(
  t: Translate,
  dialog: DialogState,
  cards: ReadonlyMap<string, BoardCard>
): DialogTexts {
  if (dialog.decision === "reject") {
    return rejectTexts(t, dialog.approval);
  }
  return approveTexts(t, dialog.approval, subjectOf(dialog.approval, cards));
}

/** The answer inputs of each answer approval, prefilled from suggestions. */
function useAnswerInputs() {
  const [answers, setAnswers] = useState<
    Record<string, Record<string, AnswerInput>>
  >({});
  const inputsFor = useCallback(
    (approval: ApprovalRecord): Record<string, AnswerInput> => {
      const stored = answers[approval.id];
      if (stored) {
        return stored;
      }
      if (approval.payload.type !== "answer") {
        return {};
      }
      return Object.fromEntries(
        approval.payload.questions.map((question) => [
          question.ref,
          initialAnswer(question),
        ])
      );
    },
    [answers]
  );
  const setInput = useCallback(
    (approval: ApprovalRecord, ref: string, input: AnswerInput) =>
      setAnswers((current) => ({
        ...current,
        [approval.id]: { ...inputsFor(approval), [ref]: input },
      })),
    [inputsFor]
  );
  return { inputsFor, setInput };
}

function canApprove(
  approval: ApprovalRecord | null,
  inputsFor: (approval: ApprovalRecord) => Record<string, AnswerInput>
): approval is ApprovalRecord {
  return (
    approval !== null &&
    approval.state === "pending" &&
    (approval.payload.type !== "answer" ||
      answersComplete(approval.payload.questions, inputsFor(approval)))
  );
}

/** Confirm → decide → report, keeping the failure on the approval (12 §6.1). */
function useDecisionFlow(options: {
  inputsFor: (approval: ApprovalRecord) => Record<string, AnswerInput>;
  list: readonly ApprovalRecord[];
  onDecided: (nextId: string | null) => void;
  refetch: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const decide = useDecideApproval();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<Record<string, DecideFailure>>({});

  async function confirm() {
    if (!dialog) {
      return;
    }
    const { approval, decision } = dialog;
    setBusy(true);
    try {
      const response =
        decision === "approve" && approval.payload.type === "answer"
          ? buildAnswerResponse(
              approval.payload.questions,
              options.inputsFor(approval)
            )
          : undefined;
      await decide({ approval, decision, response });
      setFailures(({ [approval.id]: _dropped, ...rest }) => rest);
      toast.success(
        decision === "approve"
          ? t(`approvals.done.${approval.kind}`)
          : t("approvals.done.rejected")
      );
      options.onDecided(
        stepSelection(
          options.list.filter((entry) => entry.id !== approval.id),
          null,
          1
        )
      );
    } catch (error) {
      const failure = decideFailure(error);
      setFailures((current) => ({ ...current, [approval.id]: failure }));
      toast.error(t(decideFailureKey(failure)));
      if (failure !== "failed") {
        await options.refetch();
      }
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  return { busy, confirm, dialog, failures, setDialog };
}

function Toolbar({
  view,
  pendingCount,
  staleSince,
  onViewChange,
}: {
  view: ApprovalView;
  pendingCount: number;
  staleSince: number | null;
  onViewChange: (view: ApprovalView) => void;
}) {
  const { locale, t } = useTranslation();
  return (
    <div className="band flex flex-wrap items-center gap-2 px-4 py-2 sm:px-5">
      <ToggleGroup
        aria-label={t("approvals.viewLabel")}
        onValueChange={(value) => {
          if (value === "pending" || value === "decided") {
            onViewChange(value);
          }
        }}
        size="sm"
        type="single"
        value={view}
        variant="outline"
      >
        <ToggleGroupItem value="pending">
          {t("approvals.pending")}
          <span className="type-micro text-muted-foreground tabular-nums">
            {pendingCount}
          </span>
        </ToggleGroupItem>
        <ToggleGroupItem value="decided">
          {t("approvals.decided")}
        </ToggleGroupItem>
      </ToggleGroup>
      {staleSince === null ? null : (
        <p
          className="type-caption inline-flex items-center gap-1 text-muted-foreground"
          role="status"
        >
          <CloudOff aria-hidden="true" className="size-3.5" />
          {t("approvals.stale", { time: formatClock(staleSince, locale) })}
        </p>
      )}
      <p className="type-caption ml-auto hidden text-muted-foreground sm:block">
        {t("approvals.keysHint")}
      </p>
    </div>
  );
}

function EmptyQueue({ view }: { view: ApprovalView }) {
  const { t } = useTranslation();
  const pending = view === "pending";
  return (
    <Empty className="border-0 py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleCheck aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          {pending ? t("approvals.empty") : t("approvals.emptyDecided")}
        </EmptyTitle>
        <EmptyDescription>
          {pending ? t("approvals.emptyHelp") : t("approvals.emptyDecidedHelp")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-4 sm:px-5">
      <Alert role="alert" variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{t("approvals.loadErrorTitle")}</AlertTitle>
        <AlertDescription>{t("approvals.loadError")}</AlertDescription>
        <AlertAction>
          <Button onClick={onRetry} size="sm" variant="outline">
            {t("common.retry")}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}

function staleSinceOf(
  view: ApprovalView,
  pending: { stale: boolean; dataUpdatedAt: number }
): number | null {
  return view === "pending" && pending.stale && pending.dataUpdatedAt > 0
    ? pending.dataUpdatedAt
    : null;
}

function DecisionDialog({
  dialog,
  cards,
  busy,
  onConfirm,
  onClose,
}: {
  dialog: DialogState;
  cards: ReadonlyMap<string, BoardCard>;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const texts = dialogTexts(t, dialog, cards);
  const { payload } = dialog.approval;
  return (
    <DecideDialog
      busy={busy}
      confirmLabel={texts.confirmLabel}
      decision={dialog.decision}
      description={<p>{texts.description}</p>}
      onConfirm={onConfirm}
      onOpenChange={(open) => {
        if (!(open || busy)) {
          onClose();
        }
      }}
      open
      title={texts.title}
      typeToConfirm={
        dialog.decision === "approve" && payload.type === "rule_activation"
          ? payload.name
          : null
      }
    />
  );
}

export function ApprovalsPage({
  search = {},
  onSearchChange,
}: {
  search?: ApprovalsSearch;
  onSearchChange?: (next: ApprovalsSearch) => void;
}) {
  const { t } = useTranslation();
  const view: ApprovalView = search.view ?? "pending";
  const pending = usePendingApprovals();
  const decided = useDecidedApprovals(view === "decided");
  const cards = useCardsById();
  const sources = useRuleSources();
  const nowMs = useNow(MINUTE_MS);
  const answers = useAnswerInputs();
  const [localId, setLocalId] = useState<string | null>(
    search.approval ?? null
  );
  const listRef = useRef<HTMLUListElement>(null);

  const query = view === "pending" ? pending : decided;
  const list = useMemo(() => query.data ?? [], [query.data]);
  const selectedId =
    list.find((entry) => entry.id === (localId ?? search.approval))?.id ??
    list[0]?.id ??
    null;
  const selected = list.find((entry) => entry.id === selectedId) ?? null;

  const select = useCallback(
    (id: string | null) => {
      setLocalId(id);
      onSearchChange?.({ ...search, approval: id ?? undefined });
    },
    [onSearchChange, search]
  );
  const flow = useDecisionFlow({
    inputsFor: answers.inputsFor,
    list,
    onDecided: select,
    refetch: pending.refetch,
  });

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    listRef.current
      ?.querySelector<HTMLElement>(`[data-approval-id="${selectedId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  const sourceLabel = useCallback(
    (id: string) => sources.byId.get(id)?.label ?? id,
    [sources.byId]
  );

  useShortcut("j", () => select(stepSelection(list, selectedId, 1)));
  useShortcut("k", () => select(stepSelection(list, selectedId, -1)));
  useShortcut(
    "y",
    () => {
      if (canApprove(selected, answers.inputsFor)) {
        flow.setDialog({ decision: "approve", approval: selected });
      }
    },
    view === "pending"
  );
  useShortcut(
    "x",
    () => {
      if (selected?.state === "pending") {
        flow.setDialog({ decision: "reject", approval: selected });
      }
    },
    view === "pending"
  );

  const staleSince = staleSinceOf(view, pending);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        onViewChange={(next) => {
          setLocalId(null);
          onSearchChange?.({ view: next === "pending" ? undefined : next });
        }}
        pendingCount={pending.data?.length ?? 0}
        staleSince={staleSince}
        view={view}
      />
      {query.isError && !query.data ? (
        <LoadError onRetry={() => query.refetch()} />
      ) : null}
      {query.isPending ? <ListSkeleton /> : null}
      {query.isSuccess && list.length === 0 ? <EmptyQueue view={view} /> : null}
      {list.length > 0 ? (
        <div className="grid min-h-0 flex-1 md:grid-cols-[360px_minmax(0,1fr)]">
          <nav
            aria-label={t("approvals.listLabel")}
            className="min-h-0 border-line border-b md:max-h-[calc(100dvh-10rem)] md:overflow-y-auto md:border-r md:border-b-0"
          >
            <ul ref={listRef}>
              {list.map((approval) => (
                <ApprovalRow
                  approval={approval}
                  key={approval.id}
                  nowMs={nowMs}
                  onSelect={() => select(approval.id)}
                  selected={approval.id === selectedId}
                  subject={subjectOf(approval, cards)}
                />
              ))}
            </ul>
          </nav>
          {selected ? (
            <ApprovalDetail
              answerInputs={answers.inputsFor(selected)}
              approval={selected}
              busy={flow.busy}
              failure={flow.failures[selected.id] ?? null}
              key={selected.id}
              nowMs={nowMs}
              onAnswerChange={(ref, input) =>
                answers.setInput(selected, ref, input)
              }
              onApprove={() =>
                flow.setDialog({ decision: "approve", approval: selected })
              }
              onReject={() =>
                flow.setDialog({ decision: "reject", approval: selected })
              }
              sourceLabel={sourceLabel}
              subject={subjectOf(selected, cards)}
            />
          ) : null}
        </div>
      ) : null}
      {flow.dialog ? (
        <DecisionDialog
          busy={flow.busy}
          cards={cards}
          dialog={flow.dialog}
          onClose={() => flow.setDialog(null)}
          onConfirm={flow.confirm}
        />
      ) : null}
    </div>
  );
}
