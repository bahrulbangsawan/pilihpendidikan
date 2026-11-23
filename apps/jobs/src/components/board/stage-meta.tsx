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

interface StageMeta {
  icon: LucideIcon;
  tone: string;
}

const META: Record<Stage, StageMeta> = {
  saved: { icon: CircleDashed, tone: "text-ink-sec" },
  preparing: {
    icon: CircleDotDashed,
    tone: "text-ink-sec",
  },
  ready: { icon: Circle, tone: "text-foreground" },
  applied: { icon: CircleArrowRight, tone: "text-foreground" },
  interviewing: { icon: CircleDot, tone: "text-success" },
  offer: { icon: CircleDollarSign, tone: "text-success" },
  accepted: { icon: CircleCheck, tone: "text-success" },
  rejected: { icon: CircleX, tone: "text-destructive" },
  withdrawn: { icon: CircleSlash, tone: "text-offgray" },
};

export function StageIcon({
  stage,
  className,
}: {
  stage: Stage;
  className?: string;
}) {
  const { icon: Icon, tone } = META[stage];
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4 shrink-0", tone, className)}
    />
  );
}

const DOT_TONE: Record<Stage, BadgeTone> = {
  saved: "neutral",
  preparing: "neutral",
  ready: "ink",
  applied: "ink",
  interviewing: "success",
  offer: "success",
  accepted: "success",
  rejected: "destructive",
  withdrawn: "neutral",
};

export function StageDot({
  stage,
  className,
}: {
  stage: Stage;
  className?: string;
}) {
  return <StatusDot className={className} tone={DOT_TONE[stage]} />;
}

/** The stage as a 4px chip on a 10% tint of its colour, with the dot. */
export function StageBadge({
  stage,
  className,
}: {
  stage: Stage;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Badge className={className} tone={DOT_TONE[stage]}>
      {stageLabel(t, stage)}
    </Badge>
  );
}
