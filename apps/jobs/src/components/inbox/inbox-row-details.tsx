// An inbox row's expanded part (12 §4): the description excerpt as plain
// text, the score explanation with its components, the provenance block
// (adapter and version, fetch method, run, extraction confidence, first and
// last seen, posting status) and the duplicates — the other sources that
// produced this job, so one row visibly stands for several listings. The
// provenance and duplicates blocks are shared with the job page (12 §5).

import type { InboxItem } from "@pilihpendidikan/jobs-contracts/api";
import type { JobPostingRecord } from "@pilihpendidikan/jobs-contracts/records";
import { FETCH_MODES } from "@pilihpendidikan/jobs-contracts/records";
import { Button } from "@rulisme/ui/ui/button";
import { ExternalLink } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { PlainText } from "@/components/rich-text";
import type { Translate } from "@/i18n";
import { useTranslation } from "@/i18n";
import { formatDateTime, formatPercent } from "@/lib/format";
import { alternateListings, provenanceOf } from "@/lib/inbox-state";
import { postingStatusLabel, sourceLabel } from "@/lib/labels";
import { displayUrl, safeHref } from "@/lib/safe-url";
import { ScoreBreakdown } from "./score-breakdown";

const EXCERPT_CHARS = 600;
const ADAPTER_LABEL_KEYS: ReadonlySet<string> = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "workday",
  "career_page",
  "generic_listing",
  "custom_url",
]);

/** The first ~600 characters, cut at a word. */
export function excerptOf(text: string, limit = EXCERPT_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  const cut = trimmed.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** An adapter id in words ("Greenhouse"); unknown ids as they are. */
export function adapterName(t: Translate, adapter: string): string {
  return ADAPTER_LABEL_KEYS.has(adapter)
    ? t(`sourceKinds.${adapter}`)
    : adapter;
}

function fetchModeName(t: Translate, mode: string): string {
  return (FETCH_MODES as readonly string[]).includes(mode)
    ? t(`fetchModes.${mode}`)
    : mode;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="type-micro text-muted-foreground">{label}</dt>
      <dd className="type-caption break-words text-foreground">{children}</dd>
    </div>
  );
}

/** Where a posting came from (15 §11 extraction provenance). */
export function ProvenanceFacts({
  posting,
  runId,
  sourceName,
}: {
  posting: JobPostingRecord;
  runId: string | null;
  /** The user's label of the source, when it came from one. */
  sourceName: string | null;
}) {
  const { locale, t } = useTranslation();
  const provenance = provenanceOf(posting);
  const unknown = t("inbox.details.unknown");
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
      <Fact label={t("inbox.details.adapter")}>
        {provenance.adapter
          ? adapterName(t, provenance.adapter)
          : sourceLabel(t, posting.source_kind)}
        {provenance.adapterVersion ? (
          <span className="text-muted-foreground">
            {" "}
            {t("inbox.details.version", { version: provenance.adapterVersion })}
          </span>
        ) : null}
      </Fact>
      <Fact label={t("inbox.details.fetchMode")}>
        {provenance.fetchMode
          ? fetchModeName(t, provenance.fetchMode)
          : unknown}
      </Fact>
      <Fact label={t("inbox.details.run")}>
        {runId ?? provenance.runId ?? unknown}
      </Fact>
      <Fact label={t("inbox.details.confidence")}>
        {provenance.confidence === null
          ? unknown
          : formatPercent(provenance.confidence, locale)}
      </Fact>
      <Fact label={t("inbox.details.firstSeen")}>
        {formatDateTime(posting.first_seen_at, locale)}
      </Fact>
      <Fact label={t("inbox.details.lastSeen")}>
        {formatDateTime(posting.last_seen_at, locale)}
      </Fact>
      <Fact label={t("inbox.details.status")}>
        {postingStatusLabel(t, posting.status)}
      </Fact>
      {sourceName ? (
        <Fact label={t("inbox.details.source")}>{sourceName}</Fact>
      ) : null}
    </dl>
  );
}

/** Other listings of the same job: alternates and the dedupe group. */
export function DuplicateListings({
  posting,
  duplicates,
}: {
  posting: JobPostingRecord;
  duplicates: number;
}) {
  const { t } = useTranslation();
  const alternates = alternateListings(posting);
  if (alternates.length === 0 && duplicates === 0) {
    return (
      <p className="type-caption text-muted-foreground">
        {t("inbox.details.noDuplicates")}
      </p>
    );
  }
  return (
    <ul className="type-caption flex flex-col gap-1">
      {alternates.map((alternate) => {
        const url = safeHref(alternate.url);
        return (
          <li
            className="flex min-w-0 flex-wrap gap-x-1.5"
            key={`${alternate.adapter}:${alternate.url ?? ""}`}
          >
            <span className="text-foreground">
              {adapterName(t, alternate.adapter)}
            </span>
            {alternate.fetchMode ? (
              <span className="text-muted-foreground">
                · {fetchModeName(t, alternate.fetchMode)}
              </span>
            ) : null}
            {url ? (
              <a
                className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
                href={url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {displayUrl(url)}
              </a>
            ) : null}
          </li>
        );
      })}
      {duplicates > 0 ? (
        <li className="text-muted-foreground">
          {t("inbox.details.duplicateGroup", { count: duplicates })}
        </li>
      ) : null}
    </ul>
  );
}

export function InboxRowDetails({
  item,
  onOpen,
}: {
  item: InboxItem;
  onOpen: (item: InboxItem, event?: MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const { posting } = item;
  const href = `/jobs/${encodeURIComponent(item.user_job.id)}`;
  const postingHref = safeHref(posting.canonical_url ?? posting.apply_url);

  return (
    <div className="grid gap-5 whitespace-normal px-1 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="flex flex-col gap-1.5">
          <h3 className="type-caption weight-semibold text-foreground">
            {t("detail.description")}
          </h3>
          {posting.description_text ? (
            <PlainText
              className="type-body-compact max-w-[72ch]"
              text={excerptOf(posting.description_text)}
            />
          ) : (
            <p className="type-body-compact text-muted-foreground">
              {t("detail.noDescription")}
            </p>
          )}
        </section>
        {item.score && item.score.status !== "failed" ? (
          <section className="type-caption flex max-w-md flex-col gap-1.5">
            <h3 className="weight-semibold text-foreground">
              {t("inbox.score.heading")}
            </h3>
            {item.score.status === "queued" ? (
              <p className="text-muted-foreground">{t("card.scoring")}</p>
            ) : (
              <ScoreBreakdown load postingId={posting.id} score={item.score} />
            )}
          </section>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={href} onClick={(event) => onOpen(item, event)}>
              {t("inbox.details.openJob")}
            </a>
          </Button>
          {postingHref ? (
            <Button asChild size="sm" variant="ghost">
              <a href={postingHref} rel="noopener noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" data-icon="inline-start" />
                {t("detail.openPosting")}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="type-caption weight-semibold text-foreground">
            {t("inbox.details.provenance")}
          </h3>
          <ProvenanceFacts
            posting={posting}
            runId={item.provenance.run_id}
            sourceName={item.provenance.source_label}
          />
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="type-caption weight-semibold text-foreground">
            {t("inbox.details.duplicates")}
          </h3>
          <DuplicateListings duplicates={item.duplicates} posting={posting} />
        </section>
      </div>
    </div>
  );
}
