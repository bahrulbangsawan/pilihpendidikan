// A task state as a badge: an icon plus the words, never colour alone
// (12 §12). Live states carry the pulse dot (stilled by reduced motion).

import type { TaskState } from "@pilihpendidikan/jobs-contracts/enums";
import { cn } from "@rulisme/ui/lib/utils";
import { Badge } from "@rulisme/ui/ui/badge";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  Hourglass,
  Pause,
  TimerOff,
} from "lucide-react";
import { useTranslation } from "@/i18n";
import { taskStateLabel } from "@/lib/labels";
import { stateTone } from "@/lib/runs-view";

const ICONS: Partial<Record<TaskState, LucideIcon>> = {
  queued: Clock,
  paused: Pause,
  awaiting_approval: Hourglass,
  submitted: CircleCheck,
  succeeded: CircleCheck,
  failed: CircleX,
  cancelled: Ban,
  outcome_unknown: CircleHelp,
  expired: TimerOff,
};

export function TaskStateBadge({
  state,
  className,
}: {
  state: TaskState;
  className?: string;
}) {
  const { t } = useTranslation();
  const tone = stateTone(state);
  const Icon = ICONS[state];
  return (
    <Badge
      className={cn(
        (tone === "bad" || tone === "attention") && "text-destructive",
        className
      )}
      variant={tone === "good" ? "secondary" : "outline"}
    >
      {Icon ? (
        <Icon aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className="pulse-dot size-1.5 rounded-full bg-current"
        />
      )}
      {taskStateLabel(t, state)}
    </Badge>
  );
}
