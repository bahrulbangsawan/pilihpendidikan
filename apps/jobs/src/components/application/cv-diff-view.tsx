// The tailored CV against the base, side by side (08 §4.5, §7): every
// tailored bullet sits next to the source bullets it came from; hovering or
// focusing a tailored bullet marks its sources and shows them with their ids,
// so each changed line can be checked against what the user actually wrote.
// Rewritten words (rephrase / merge) are highlighted, moved bullets say so,
// excluded entries are struck through, notes_for_user are warnings (never CV
// content, V10). All text is the user's own CV or model output: plain text.

import { CV_SECTION_IDS } from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import { cn } from "@rulisme/ui/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@rulisme/ui/ui/alert";
import { Badge } from "@rulisme/ui/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import type { DiffBullet, DiffModel } from "@/lib/cv-diff";

const SECTIONS: ReadonlySet<string> = new Set(CV_SECTION_IDS);

/** A CV section's name; an unknown section shows as it is. */
function sectionLabel(t: Translate, section: string): string {
  return SECTIONS.has(section) ? t(`cv.sections.${section}`) : section;
}

function OperationBadge({ bullet }: { bullet: DiffBullet }) {
  const { t } = useTranslation();
  return (
    <Badge
      className="shrink-0"
      variant={bullet.rewritten ? "secondary" : "outline"}
    >
      {t(`cv.diff.operations.${bullet.operation}`)}
    </Badge>
  );
}

function SourceList({
  bullet,
  marked,
}: {
  bullet: DiffBullet;
  marked: boolean;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {bullet.sources.map((source) => (
        <li
          className={cn(
            "type-body-compact rounded-sm px-1.5 py-0.5 text-muted-foreground transition-colors duration-150 ease-standard",
            marked && "bg-highlight text-foreground"
          )}
          data-source-id={source.id}
          key={source.id}
        >
          {source.text}
        </li>
      ))}
    </ul>
  );
}

function BulletRow({
  bullet,
  marked,
  onMark,
}: {
  bullet: DiffBullet;
  marked: boolean;
  onMark: (key: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="grid gap-2 border-line border-t py-2 md:grid-cols-2 md:gap-4">
      <div className="order-2 md:order-1">
        <p className="type-caption text-muted-foreground md:sr-only">
          {t("cv.diff.fromYourCv")}
        </p>
        <SourceList bullet={bullet} marked={marked} />
      </div>
      <div className="order-1 flex items-start gap-2 md:order-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-pressed={marked}
              className={cn(
                "type-body flex-1 rounded-sm px-1.5 py-0.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-ring",
                bullet.rewritten && "bg-highlight"
              )}
              data-bullet-key={bullet.key}
              onBlur={() => onMark(null)}
              onClick={() => onMark(marked ? null : bullet.key)}
              onFocus={() => onMark(bullet.key)}
              onMouseEnter={() => onMark(bullet.key)}
              onMouseLeave={() => onMark(null)}
              type="button"
            >
              {bullet.text}
              <span className="sr-only">
                {` ${t("cv.diff.derivedFrom", {
                  sources: bullet.sources
                    .map((source) => source.text)
                    .join(" / "),
                })}`}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm" side="top">
            <span className="flex flex-col gap-1">
              <span className="type-caption weight-semibold">
                {t("cv.diff.sourceTitle", { count: bullet.sources.length })}
              </span>
              {bullet.sources.map((source) => (
                <span className="type-caption" key={source.id}>
                  {source.id}: {source.text}
                </span>
              ))}
            </span>
          </TooltipContent>
        </Tooltip>
        <OperationBadge bullet={bullet} />
      </div>
    </li>
  );
}

export function CvDiffView({ model }: { model: DiffModel }) {
  const { t } = useTranslation();
  const [marked, setMarked] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-5" data-slot="cv-diff">
      {model.notes.length > 0 ? (
        <Alert>
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>{t("cv.diff.notesTitle")}</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {model.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="type-caption text-muted-foreground">
        {t("cv.diff.legend", { count: model.rewrittenCount })}
        {model.fallbacksToKeep > 0
          ? ` ${t("cv.diff.fallbacks", { count: model.fallbacksToKeep })}`
          : ""}
      </p>

      {model.summary ? (
        <section
          aria-labelledby="cv-diff-summary"
          className="flex flex-col gap-2"
        >
          <h3 className="type-body weight-semibold" id="cv-diff-summary">
            {t("cv.diff.summary")}
          </h3>
          <div className="grid gap-2 md:grid-cols-2 md:gap-4">
            <div className="flex flex-col gap-1">
              <span className="type-caption text-muted-foreground">
                {t("cv.diff.before")}
              </span>
              <p className="type-body text-muted-foreground">
                {model.summary.from || t("cv.diff.empty")}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="type-caption text-muted-foreground">
                {t("cv.diff.after")}
              </span>
              <p
                className={cn(
                  "type-body rounded-sm px-1.5 py-0.5",
                  model.summary.changed && "bg-highlight"
                )}
              >
                {model.summary.to || t("cv.diff.empty")}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {model.sectionOrder.changed ? (
        <section
          aria-labelledby="cv-diff-order"
          className="flex flex-col gap-1"
        >
          <h3 className="type-body weight-semibold" id="cv-diff-order">
            {t("cv.diff.sectionOrder")}
          </h3>
          <p className="type-caption flex flex-wrap items-center gap-1 text-muted-foreground">
            {model.sectionOrder.to.map((section, index) => (
              <span className="inline-flex items-center gap-1" key={section}>
                {index > 0 ? (
                  <ArrowRight aria-hidden="true" className="size-3" />
                ) : null}
                {sectionLabel(t, section)}
              </span>
            ))}
          </p>
        </section>
      ) : null}

      <div className="hidden grid-cols-2 gap-4 md:grid">
        <span className="type-caption text-muted-foreground">
          {t("cv.diff.fromYourCv")}
        </span>
        <span className="type-caption text-muted-foreground">
          {t("cv.diff.tailored")}
        </span>
      </div>

      {model.entries.map((entry) => (
        <section
          aria-label={entry.label}
          className="flex flex-col"
          key={entry.entryId}
        >
          <h3 className="type-body weight-semibold pb-1 text-foreground">
            {entry.label}
          </h3>
          <ul className="flex flex-col">
            {entry.bullets.map((bullet) => (
              <BulletRow
                bullet={bullet}
                key={bullet.key}
                marked={marked === bullet.key}
                onMark={setMarked}
              />
            ))}
          </ul>
        </section>
      ))}

      {model.excluded.length > 0 ? (
        <section
          aria-labelledby="cv-diff-excluded"
          className="flex flex-col gap-1"
        >
          <h3 className="type-body weight-semibold" id="cv-diff-excluded">
            {t("cv.diff.excluded")}
          </h3>
          <ul className="flex flex-col gap-1">
            {model.excluded.map((entry) => (
              <li
                className="type-body flex items-center gap-2 text-muted-foreground"
                key={`${entry.section}:${entry.entryId}`}
              >
                <del className="line-through">{entry.label}</del>
                <span className="type-caption">
                  {sectionLabel(t, entry.section)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
