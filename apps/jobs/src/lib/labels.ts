// Catalogue keys for the contracts' enums, so every screen names a stage,
// interview or source the same way (12 §13 glossary).

import type {
  ActorKind,
  AnalyticsBreakdown,
  AnalyticsMetric,
  ChangeSource,
  InterviewKind,
  InterviewOutcome,
  OfferStatus,
  SourceKind,
  Stage,
  SubmissionMethod,
  SubmissionStatus,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { Translate } from "@/i18n";

export const stageLabel = (t: Translate, stage: Stage) => t(`stages.${stage}`);
export const sourceLabel = (t: Translate, source: SourceKind) =>
  t(`sourceKinds.${source}`);
/** The short source badge on cards: GH, Lever, Ashby, Web… */
export const sourceBadge = (t: Translate, source: SourceKind) =>
  t(`sourceBadges.${source}`);
export const submissionLabel = (t: Translate, status: SubmissionStatus) =>
  t(`submission.${status}`);
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
export const breakdownLabel = (t: Translate, by: AnalyticsBreakdown) =>
  t(`breakdowns.${by}`);
export const metricLabel = (t: Translate, metric: AnalyticsMetric) =>
  t(`metrics.${metric}`);
