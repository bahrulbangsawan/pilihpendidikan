// The application's identity and property chips, shared by the details
// sheet and the full page (reui's sheet: title, then a row of property
// chips). The first chip is the stage select (`M`); the others are facts:
// match score, location, source, applied date, posting status.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import type { Stage } from "@pilihpendidikan/jobs-contracts/enums";
import { STAGES } from "@pilihpendidikan/jobs-contracts/enums";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { cn } from "@rulisme/ui/lib/utils";
import { Badge } from "@rulisme/ui/ui/badge";
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { CalendarCheck, Globe, MapPin, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { EntityAvatar } from "@rulisme/ui/ui/entity-avatar";
import { PropertyChip } from "@rulisme/ui/ui/property-chip";
import { StageIcon } from "@/components/board/stage-meta";
import { useTranslation } from "@/i18n";
import { canMoveTo } from "@/lib/board-move";
import { formatDate } from "@/lib/format";
import { sourceLabel, stageLabel } from "@/lib/labels";

/** Company avatar, role title and company name. */
export function ApplicationIdentity({
  detail,
  title,
  className,
}: {
  detail: ApplicationDetail;
  /** The heading element (SheetTitle in the sheet, h1 on the page). */
  title: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <EntityAvatar name={detail.posting.company_name} size="lg" />
      <div className="flex min-w-0 flex-col gap-0.5">
        {title}
        <span className="type-caption truncate text-muted-foreground">
          {detail.posting.company_name}
        </span>
      </div>
    </div>
  );
}

/** The stage as a chip-sized select; `M` opens it. */
function StageSelect({
  stage,
  onMove,
  shortcut,
}: {
  stage: Stage;
  onMove: (target: Stage) => void;
  shortcut: boolean;
}) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  useShortcut("m", () => trigger.current?.click(), shortcut);
  return (
    <span className="inline-flex items-center gap-1">
      <Select onValueChange={(value) => onMove(value as Stage)} value={stage}>
        <SelectTrigger
          aria-keyshortcuts="M"
          aria-label={t("detail.stage")}
          className="h-7 w-auto gap-1.5 rounded-full pr-2 pl-2.5"
          ref={trigger}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STAGES.map((entry) => (
            <SelectItem
              disabled={!canMoveTo(stage, entry)}
              key={entry}
              value={entry}
            >
              <StageIcon className="size-3.5" stage={entry} />
              {stageLabel(t, entry)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {shortcut ? <Kbd aria-hidden="true">M</Kbd> : null}
    </span>
  );
}

export function ApplicationProperties({
  detail,
  onMove,
  shortcut = true,
  className,
}: {
  detail: ApplicationDetail;
  onMove: (target: Stage) => void;
  /** Register `M` for the stage select (one handler per key). */
  shortcut?: boolean;
  className?: string;
}) {
  const { locale, t } = useTranslation();
  const { application, posting, score } = detail;
  const location = posting.locations[0]?.raw;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <StageSelect
        onMove={onMove}
        shortcut={shortcut}
        stage={application.stage}
      />
      {score && score.status === "ready" ? (
        <PropertyChip icon={<Sparkles aria-hidden="true" />}>
          {t("application.matchScore", { score: score.score })}
        </PropertyChip>
      ) : null}
      {location ? (
        <PropertyChip icon={<MapPin aria-hidden="true" />}>
          <span className="max-w-48 truncate">{location}</span>
        </PropertyChip>
      ) : null}
      <PropertyChip icon={<Globe aria-hidden="true" />}>
        {sourceLabel(t, posting.source_kind)}
      </PropertyChip>
      {application.submitted_at === null ? null : (
        <PropertyChip icon={<CalendarCheck aria-hidden="true" />}>
          {t("application.appliedOn", {
            date: formatDate(application.submitted_at, locale),
          })}
        </PropertyChip>
      )}
      {posting.status === "closed" ? (
        <Badge className="h-7 px-2.5" variant="ghost">
          {t("detail.postingClosed")}
        </Badge>
      ) : null}
      {application.archived ? (
        <Badge className="h-7 px-2.5" variant="ghost">
          {t("card.archived")}
        </Badge>
      ) : null}
    </div>
  );
}
