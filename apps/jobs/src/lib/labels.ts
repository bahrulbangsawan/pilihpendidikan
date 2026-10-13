// Catalogue keys for the contracts' enums, so every screen names a stage,
// mode or source the same way (12 §13 glossary).

import type {
  ActorKind,
  AnalyticsBreakdown,
  AnalyticsMetric,
  ApplicationMode,
  ApprovalKind,
  ApprovalState,
  ChangeSource,
  DeviceCapability,
  DevicePlatform,
  DiscoveryErrorClass,
  DiscoveryRunStatus,
  InboxState,
  InterviewKind,
  InterviewOutcome,
  OfferStatus,
  PauseReason,
  PostingStatus,
  ProgressStage,
  SourceKind,
  Stage,
  SubmissionMethod,
  SubmissionStatus,
  TaskKind,
  TaskState,
} from "@pilihpendidikan/jobs-contracts/enums";
import { TASK_ERROR_CLASSES } from "@pilihpendidikan/jobs-contracts/enums";
import type { Translate } from "@/i18n";

export const stageLabel = (t: Translate, stage: Stage) => t(`stages.${stage}`);
export const modeLabel = (t: Translate, mode: ApplicationMode) =>
  t(`modes.${mode}`);
export const sourceLabel = (t: Translate, source: SourceKind) =>
  t(`sourceKinds.${source}`);
/** The short source badge on cards: GH, Lever, Ashby, Web… */
export const sourceBadge = (t: Translate, source: SourceKind) =>
  t(`sourceBadges.${source}`);
export const submissionLabel = (t: Translate, status: SubmissionStatus) =>
  t(`submission.${status}`);
export const taskStateLabel = (t: Translate, state: TaskState) =>
  t(`taskStates.${state}`);
export const actorLabel = (t: Translate, actor: ActorKind) =>
  t(`actors.${actor}`);
export const changeSourceLabel = (t: Translate, source: ChangeSource) =>
  t(`changeSources.${source}`);
export const interviewKindLabel = (t: Translate, kind: InterviewKind) =>
  t(`interviewKinds.${kind}`);
export const interviewOutcomeLabel = (
  t: Translate,
  outcome: InterviewOutcome
) => t(`interviewOutcomes.${outcome}`);
export const offerStatusLabel = (t: Translate, status: OfferStatus) =>
  t(`offerStatuses.${status}`);
export const methodLabel = (t: Translate, method: SubmissionMethod) =>
  t(`methods.${method}`);
export const approvalKindLabel = (t: Translate, kind: ApprovalKind) =>
  t(`approvalKinds.${kind}`);
export const approvalStateLabel = (t: Translate, state: ApprovalState) =>
  t(`approvalStates.${state}`);
export const taskKindLabel = (t: Translate, kind: TaskKind) =>
  t(`taskKinds.${kind}`);
export const runStatusLabel = (t: Translate, status: DiscoveryRunStatus) =>
  t(`runStatuses.${status}`);
export const discoveryErrorLabel = (
  t: Translate,
  errorClass: DiscoveryErrorClass
) => t(`discoveryErrors.${errorClass}`);
export const inboxStateLabel = (t: Translate, state: InboxState) =>
  t(`inboxStates.${state}`);
export const platformLabel = (t: Translate, platform: DevicePlatform) =>
  t(`platforms.${platform}`);
export const capabilityLabel = (t: Translate, capability: DeviceCapability) =>
  t(`capabilities.${capability}`);
export const postingStatusLabel = (t: Translate, status: PostingStatus) =>
  t(`postingStatuses.${status}`);
export const breakdownLabel = (t: Translate, by: AnalyticsBreakdown) =>
  t(`breakdowns.${by}`);
export const metricLabel = (t: Translate, metric: AnalyticsMetric) =>
  t(`metrics.${metric}`);
export const progressStageLabel = (t: Translate, stage: ProgressStage) =>
  t(`progressStages.${stage}`);
export const pauseReasonLabel = (t: Translate, reason: PauseReason) =>
  t(`pauseReasons.${reason}`);

const KNOWN_TASK_ERRORS: ReadonlySet<string> = new Set(TASK_ERROR_CLASSES);

/** A task's `error_class` in words; unknown classes show as they are. */
export function taskErrorLabel(t: Translate, errorClass: string): string {
  return KNOWN_TASK_ERRORS.has(errorClass)
    ? t(`taskErrors.${errorClass}`)
    : errorClass;
}
