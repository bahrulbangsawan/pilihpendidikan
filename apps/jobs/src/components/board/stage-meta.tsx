// One status glyph per stage (reui's lane header icons): a lucide circle in
// a semantic tone, the matching dot, and the stage chip (a tinted Badge).
// The tone is never the only signal: every glyph sits next to the stage name.

import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { cn } from "@rulisme/ui/lib/utils";
import type { BadgeTone } from "@rulisme/ui/ui/badge";
import { Badge } from "@rulisme/ui/ui/badge";
import { StatusDot } from "@rulisme/ui/ui/status-dot";
import { useTranslation } from "@/i18n";
import { stageLabel } from "@/lib/labels";
import type { LucideIcon } from "lucide-react";
import {
  Circle,
  CircleArrowRight,
  CircleCheck,
  CircleDashed,
  CircleDollarSign,
  CircleDot,
  CircleDotDashed,
  CircleSlash,
  CircleX,
} from "lucide-react";

// One tone per stage, chosen so neighbouring lanes differ: the pipeline
// before applying runs grey → violet → blue, applied is amber, the good
// outcomes green, a rejection red and a withdrawal grey again.
const TONE: Record<Stage, BadgeTone> = {
  saved: "neutral",
  preparing: "violet",
  ready: "blue",
  applied: "amber",
  interviewing: "success",
  offer: "success",
  accepted: "success",
  rejected: "destructive",
  withdrawn: "neutral",
};

const ICON: Record<Stage, LucideIcon> = {
  saved: CircleDashed,
  preparing: CircleDotDashed,
  ready: Circle,
  applied: CircleArrowRight,
  interviewing: CircleDot,
  offer: CircleDollarSign,
  accepted: CircleCheck,
  rejected: CircleX,
  withdrawn: CircleSlash,
};

const TONE_TEXT: Record<BadgeTone, string> = {
  neutral: "text-offgray",
  ink: "text-foreground",
  link: "text-link",
  success: "text-success",
  destructive: "text-destructive",
  blue: "text-tone-blue",
  violet: "text-tone-violet",
  amber: "text-tone-amber",
};

/** The stage's tone, for anything else that colours by stage. */
export function stageTone(stage: Stage): BadgeTone {
  return TONE[stage];
}

export function StageIcon({
  stage,
  className,
}: {
  stage: Stage;
  className?: string;
}) {
  const Icon = ICON[stage];
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4 shrink-0", TONE_TEXT[TONE[stage]], className)}
    />
  );
}

export function StageDot({
  stage,
  className,
}: {
  stage: Stage;
  className?: string;
}) {
  return <StatusDot className={className} tone={TONE[stage]} />;
}

/** The stage as a 4px chip on a 12% tint of its tone, with the dot. */
export function StageBadge({
  stage,
  className,
}: {
  stage: Stage;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Badge className={className} tone={TONE[stage]}>
      {stageLabel(t, stage)}
    </Badge>
  );
}
