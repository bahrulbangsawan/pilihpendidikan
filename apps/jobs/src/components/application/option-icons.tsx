// The leading icon of each option in the application's selects and menus
// (interview kinds and outcomes, offer statuses, submission methods): the
// icon is decoration, the label always carries the meaning.

import type {
  InterviewKind,
  InterviewOutcome,
  OfferStatus,
  SubmissionMethod,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Briefcase,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleX,
  Code,
  Flag,
  Globe,
  Hand,
  Mail,
  MessagesSquare,
  NotebookPen,
  Phone,
  PlugZap,
  TimerOff,
  UserX,
  Users,
} from "lucide-react";

const KIND: Record<InterviewKind, LucideIcon> = {
  phone_screen: Phone,
  technical: Code,
  take_home: NotebookPen,
  onsite: Users,
  behavioral: MessagesSquare,
  final: Flag,
  other: Briefcase,
};

const OUTCOME: Record<InterviewOutcome, LucideIcon> = {
  pending: CircleDashed,
  passed: CircleCheck,
  failed: CircleX,
  cancelled: Ban,
  no_show: UserX,
};

const OFFER: Record<OfferStatus, LucideIcon> = {
  open: CircleDot,
  accepted: CircleCheck,
  declined: CircleX,
  expired: TimerOff,
  rescinded: Ban,
};

const METHOD: Record<SubmissionMethod, LucideIcon> = {
  browser: Globe,
  email: Mail,
  ats_api: PlugZap,
  manual: Hand,
};

function OptionIcon({ icon: Icon }: { icon: LucideIcon | undefined }) {
  const Shown = Icon ?? CircleHelp;
  return <Shown aria-hidden="true" />;
}

export const InterviewKindIcon = ({ kind }: { kind: InterviewKind }) => (
  <OptionIcon icon={KIND[kind]} />
);
export const InterviewOutcomeIcon = ({
  outcome,
}: {
  outcome: InterviewOutcome;
}) => <OptionIcon icon={OUTCOME[outcome]} />;
export const OfferStatusIcon = ({ status }: { status: OfferStatus }) => (
  <OptionIcon icon={OFFER[status]} />
);
export const MethodIcon = ({ method }: { method: SubmissionMethod }) => (
  <OptionIcon icon={METHOD[method]} />
);
