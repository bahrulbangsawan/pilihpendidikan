// The application's side column (12 §5.1) and the pieces the details sheet
// reuses: "Next step" — exactly one recommended action, the screen's only
// primary button, behind `Y` — and the follow-up, each in a card.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { SectionCard } from "@rulisme/ui/blocks/settings";
import type { ApplicationPatch } from "@/hooks/use-conflict-write";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import type { NextStep } from "@/lib/next-step";
import { computeNextStep } from "@/lib/next-step";
import { FollowUpCard } from "./follow-up-card";

export const DETAIL_TABS = [
  "overview",
  "cv",
  "interviews",
  "offers",
  "timeline",
  "notes",
  "checklists",
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/** The why line and the button label of a next step. */
export function nextStepCopy(
  t: Translate,
  step: NextStep
): { why: string; action: string } {
  switch (step.kind) {
    case "review_cv":
      return {
        why: t("application.nextStep.reviewCvWhy"),
        action: t("application.nextStep.reviewCv"),
      };
    case "add_interview":
      return {
        why: t("application.nextStep.addInterviewWhy"),
        action: t("application.nextStep.addInterview"),
      };
    default:
      return {
        why: t("application.nextStep.markAppliedWhy"),
        action: t("application.nextStep.markApplied"),
      };
  }
}

/** The primary button of a next step, behind `Y`. */
export function NextStepButton({
  step,
  onRun,
  shortcutEnabled = true,
  className,
}: {
  step: NextStep;
  onRun: (step: NextStep) => void;
  /** False while another `Y` owner is on screen (one handler per key). */
  shortcutEnabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  useShortcut("y", () => onRun(step), shortcutEnabled);
  return (
    <Button
      aria-keyshortcuts="Y"
      className={className}
      onClick={() => onRun(step)}
    >
      {nextStepCopy(t, step).action}
      <Kbd aria-hidden="true">Y</Kbd>
    </Button>
  );
}

export function NextStepCard({
  detail,
  onRun,
  shortcutEnabled,
  withButton = true,
}: {
  detail: ApplicationDetail;
  onRun: (step: NextStep) => void;
  shortcutEnabled: boolean;
  /** The sheet puts the button in its footer instead. */
  withButton?: boolean;
}) {
  const { t } = useTranslation();
  const step = computeNextStep(detail);
  return (
    <SectionCard id="next-step-heading" title={t("nextStep.heading")}>
      {step ? (
        <>
          <p className="type-body text-pretty">{nextStepCopy(t, step).why}</p>
          {withButton ? (
            <NextStepButton
              className="self-start"
              onRun={onRun}
              shortcutEnabled={shortcutEnabled}
              step={step}
            />
          ) : null}
        </>
      ) : (
        <p className="type-body text-muted-foreground">{t("nextStep.none")}</p>
      )}
    </SectionCard>
  );
}

export function FollowUpSection({
  detail,
  nowMs,
  onAccept,
  onEdit,
}: {
  detail: ApplicationDetail;
  nowMs: number;
  onAccept: (changes: ApplicationPatch) => Promise<unknown>;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <FollowUpCard
        detail={detail}
        nowMs={nowMs}
        onAccept={onAccept}
        onEdit={onEdit}
      />
    </div>
  );
}

export function NextStepRail({
  detail,
  nowMs,
  onRun,
  onAcceptFollowUp,
  onEditFollowUp,
  shortcutEnabled = true,
}: {
  detail: ApplicationDetail;
  nowMs: number;
  onRun: (step: NextStep) => void;
  onAcceptFollowUp: (changes: ApplicationPatch) => Promise<unknown>;
  onEditFollowUp: () => void;
  /** False while the CV tab's own Approve owns `Y` (one handler per key). */
  shortcutEnabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <aside aria-label={t("detail.rail")} className="flex flex-col gap-3">
      <NextStepCard
        detail={detail}
        onRun={onRun}
        shortcutEnabled={shortcutEnabled}
      />
      <FollowUpSection
        detail={detail}
        nowMs={nowMs}
        onAccept={onAcceptFollowUp}
        onEdit={onEditFollowUp}
      />
    </aside>
  );
}
