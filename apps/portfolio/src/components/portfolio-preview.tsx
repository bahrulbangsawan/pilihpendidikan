import { ensureUrl } from "@rulisme/ui/lib/utils";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@rulisme/ui/ui/empty";
import { Presentation } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import type {
  Portfolio,
  PortfolioOwner,
  Project,
  ProjectType,
  Track,
} from "@/components/portfolio-data-model";
import { coverFootLines } from "@/lib/cover-foot";

type Translate = (
  key: string,
  params?: Record<string, string | number>
) => string;

const PROTOCOL_RE = /^https?:\/\//i;
const WWW_RE = /^www\./i;
const TRAILING_SLASH_RE = /\/$/;

// Compact, link-style display of a URL (protocol + www + trailing slash dropped).
function displayUrl(url: string): string {
  return url
    .replace(PROTOCOL_RE, "")
    .replace(WWW_RE, "")
    .replace(TRAILING_SLASH_RE, "");
}

function trackLabel(track: Track, t: Translate): string {
  return t(`options.track.${track}`);
}

function projectTypeLabel(type: ProjectType, t: Translate): string {
  switch (type) {
    case "class-assignment":
      return t("preview.classAssignment");
    case "work-assignment":
      return t("preview.workAssignment");
    default:
      return t("preview.selfInitiated");
  }
}

// Cover column 2 ("Background") — render the owner's affiliation as ≤3 lines.
function backgroundLines(owner: PortfolioOwner, t: Translate): string[] {
  const { affiliation } = owner;
  switch (affiliation.kind) {
    case "student": {
      const status = affiliation.semester
        ? `${t("preview.student")} · ${t("preview.semester")} ${affiliation.semester}`
        : t("preview.student");
      return [
        affiliation.institution,
        status,
        affiliation.program ?? "",
      ].filter(Boolean);
    }
    case "alumni": {
      const status = affiliation.graduationYear
        ? `${t("preview.alumni")} · ${affiliation.graduationYear}`
        : t("preview.alumni");
      return [
        affiliation.institution,
        status,
        affiliation.program ?? "",
      ].filter(Boolean);
    }
    case "professional": {
      const status = affiliation.yearsExperience
        ? `${affiliation.jobTitle ?? ""} · ${affiliation.yearsExperience} ${t("preview.years")}`
        : (affiliation.jobTitle ?? "");
      return [affiliation.organization ?? "", status].filter(Boolean);
    }
    default:
      return [affiliation.note || t("preview.independent")];
  }
}

// Compact one-line affiliation tag for the per-page footer.
function affiliationFootnote(owner: PortfolioOwner, t: Translate): string {
  const { affiliation } = owner;
  switch (affiliation.kind) {
    case "student":
      return [
        affiliation.institution,
        affiliation.semester
          ? `${t("preview.student")}, ${t("preview.semesterShort")} ${affiliation.semester}`
          : t("preview.student"),
      ]
        .filter(Boolean)
        .join(" · ");
    case "alumni":
      return [affiliation.institution, t("preview.alumni")]
        .filter(Boolean)
        .join(" · ");
    case "professional":
      return [affiliation.organization, affiliation.jobTitle]
        .filter(Boolean)
        .join(" · ");
    default:
      return affiliation.note || t("preview.independent");
  }
}

interface FootEntry {
  key: string;
  node: ReactNode;
}

// A cover footer column's entries, each its own block clamped to its share
// of the column's lines (coverFootLines): the first may wrap into the lines
// the others leave, every later entry keeps one line and ends in an
// ellipsis. The PDF's FootLines clamps each entry's Text the same way, so
// the column shows the same lines on screen and on paper.
function FootLines({ entries }: { entries: FootEntry[] }) {
  const lines = coverFootLines(entries.length);
  return (
    <p>
      {entries.slice(0, lines.length).map(({ key, node }, i) => (
        <span
          className="pf-cover__line"
          key={key}
          style={{ WebkitLineClamp: lines[i] }}
        >
          {node}
        </span>
      ))}
    </p>
  );
}

function CoverPage({ data, t }: { data: Portfolio; t: Translate }) {
  const { owner } = data;
  const sub = [owner.fullName, owner.headline].filter(Boolean).join(" · ");

  const years = data.projects
    .map((p) => p.yearAccomplished)
    .filter((y) => y > 0);
  const minY = years.length ? Math.min(...years) : undefined;
  const maxY = years.length ? Math.max(...years) : undefined;
  let worksLine = t("preview.selectedWorks");
  if (minY !== undefined) {
    const range = minY === maxY ? String(minY) : `${minY}–${maxY}`;
    worksLine = t("preview.selectedWorksRange", { range });
  }
  const trackLine = t("preview.trackLine", {
    track: trackLabel(owner.track, t),
  });

  const background = backgroundLines(owner, t);
  const { contact } = owner;
  const website = contact.websiteUrl?.trim();
  const social = contact.socials?.find((s) => s.url.trim());
  // The link the PDF sets: an address typed without its scheme still opens
  // the site, never a path on this app.
  const contactLink = website
    ? { url: ensureUrl(website), label: displayUrl(website) }
    : social && {
        url: ensureUrl(social.url.trim()),
        label: social.label || displayUrl(social.url.trim()),
      };
  const contactEntries: FootEntry[] = [];
  if (contact.phone) {
    contactEntries.push({ key: "phone", node: contact.phone });
  }
  if (contact.email) {
    contactEntries.push({
      key: "email",
      node: <a href={`mailto:${contact.email}`}>{contact.email}</a>,
    });
  }
  if (contactLink) {
    contactEntries.push({
      key: "link",
      node: (
        <a href={contactLink.url} rel="noopener noreferrer" target="_blank">
          {contactLink.label}
        </a>
      ),
    });
  }

  return (
    <section className="pf-page pf-cover">
      <div className="pf-cover__kicker">
        {/* The PDF's arrow path, drawn rather than typed: Inter's latin
            subset has no rightwards arrow (U+2192), so the glyph fell back
            to a system font on paper that must be Inter only. */}
        <span className="pf-dot">
          <svg aria-hidden="true" height="12" viewBox="0 0 24 24" width="12">
            <path
              d="M4 12 L20 12 M13 5 L20 12 L13 19"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            />
          </svg>
        </span>
        {t("preview.kicker", { year: data.cohortYear ?? "" })}
      </div>

      <div>
        <h1 className="pf-cover__title">
          {t("preview.portfolio")}
          <span className="pf-muted">.</span>
        </h1>
        <p className="pf-cover__sub">{sub || t("preview.yourName")}</p>
      </div>

      <div className="pf-cover__foot">
        <div>
          <h4>{owner.fullName || t("preview.author")}</h4>
          <FootLines
            entries={[
              { key: "works", node: worksLine },
              { key: "track", node: trackLine },
            ]}
          />
        </div>
        <div>
          <h4>{t("preview.background")}</h4>
          {/* Keyed by position: two lines may read the same (a program
              named like its institution). */}
          <FootLines
            entries={background.map((line, i) => ({
              key: `line-${i}`,
              node: line,
            }))}
          />
        </div>
        <div>
          <h4>{t("preview.contact")}</h4>
          <FootLines entries={contactEntries} />
        </div>
        <div>
          <h4>{t("preview.submissionFor")}</h4>
          <FootLines
            entries={[
              {
                key: "target",
                node: data.submissionTarget || t("preview.defaultTarget"),
              },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function ProjectPage({
  data,
  project,
  index,
  total,
  t,
}: {
  data: Portfolio;
  project: Project;
  index: number;
  total: number;
  t: Translate;
}) {
  const { owner } = data;
  const media = project.media[0];
  const sow = (project.scopeOfWork ?? []).slice(0, 6);
  const track = project.track ?? owner.track;
  const isTech = track === "tech";
  const tags = (isTech ? project.technologies : project.skills) ?? [];
  const tagLabel = isTech
    ? t("preview.technologies")
    : t("preview.disciplines");
  const isGroup = project.collaboration.kind === "group";
  const publicationUrl = project.publicationUrl?.trim();

  return (
    <section className="pf-page pf-project">
      <div className="pf-project-main">
        <aside className="pf-rail">
          <div className="pf-field">
            <h5>{t("preview.yearAccomplished")}</h5>
            <p>{project.yearAccomplished || "—"}</p>
          </div>
          <div className="pf-field">
            <h5>{t("preview.rolePosition")}</h5>
            <p>{project.role || "—"}</p>
          </div>
          <div className="pf-field">
            <h5>{t("preview.type")}</h5>
            <p>
              <span className="pf-badge">
                {projectTypeLabel(project.projectType, t)}
              </span>
              {isGroup && (
                <>
                  {" "}
                  <span className="pf-badge pf-badge--group">
                    {t("preview.groupProject")}
                  </span>
                </>
              )}
            </p>
          </div>
          {publicationUrl && (
            <div className="pf-field">
              <h5>{t("preview.publicationLink")}</h5>
              <p>
                {/* An address typed without its scheme still opens the
                    site, as in the PDF. */}
                <a
                  href={ensureUrl(publicationUrl)}
                  rel="noreferrer"
                  target="_blank"
                >
                  {displayUrl(publicationUrl)}
                </a>
              </p>
            </div>
          )}
          {sow.length > 0 && (
            <div className="pf-field pf-field--sow">
              <h5>{t("preview.scopeOfWork")}</h5>
              <ul className="pf-sow">
                {sow.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {tags.length > 0 && (
            <div className="pf-field pf-field--tech">
              <h5>{tagLabel}</h5>
              <div className="pf-tag-row">
                {tags.map((tag) => (
                  <span className="pf-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>

        <div className="pf-content">
          <h2>{project.title || t("preview.untitledProject")}</h2>
          <p className="pf-lede">{project.summary}</p>
          <p className="pf-body">{project.description}</p>
          <div className="pf-figure">
            {media?.url ? (
              <img
                alt={media.alt || project.title}
                decoding="async"
                height={media.height}
                src={media.url}
                width={media.width}
              />
            ) : (
              <>
                <div className="pf-ph-title">{t("preview.artworkTitle")}</div>
                <div className="pf-ph-note">{t("preview.artworkNote")}</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="pf-reflect">
        <div>
          <h6>{t("preview.impact")}</h6>
          <p>{project.impact}</p>
        </div>
        <div>
          <h6>{t("preview.learned")}</h6>
          <p>{project.learnings}</p>
        </div>
      </div>

      <div className="pf-pagefoot">
        <span>
          <strong>{owner.fullName || t("preview.author")}</strong>
          {" · "}
          {affiliationFootnote(owner, t)}
        </span>
        <span className="pf-pagefoot__right">
          <span>
            {[
              owner.contact.email,
              data.submissionTarget || t("preview.defaultTarget"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="pf-pagefoot__index">
            {t("preview.projectIndex", { n: index + 1, total })}
          </span>
        </span>
      </div>
    </section>
  );
}

interface PortfolioPreviewProps {
  data: Portfolio;
  /** When true (editor), scale the natural-size A4 deck to fit the pane. */
  fit?: boolean;
}

export function PortfolioPreview({ data, fit = true }: PortfolioPreviewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [deckHeight, setDeckHeight] = useState<number | null>(null);

  const hasContent =
    Boolean(data.owner.fullName.trim()) ||
    data.projects.some(
      (p) => p.title.trim() || p.summary.trim() || p.description.trim()
    );

  useEffect(() => {
    if (!(fit && hasContent)) {
      return;
    }
    const container = containerRef.current;
    const deck = deckRef.current;
    if (!(container && deck)) {
      return;
    }
    const measure = () => {
      const cw = container.clientWidth;
      const dw = deck.offsetWidth; // natural width — transform doesn't affect layout box
      const next = dw > 0 ? Math.min(1, cw / dw) : 1;
      setScale(next);
      setDeckHeight(deck.offsetHeight * next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(deck);
    return () => ro.disconnect();
    // Re-attach when the deck first mounts (empty → has content). Observing the
    // deck handles page-count changes and all subsequent size drift.
  }, [fit, hasContent]);

  // Nothing to show yet: an editor empty state (chrome, not part of the deck).
  if (!hasContent) {
    return (
      <Empty className="py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Presentation aria-hidden="true" />
          </EmptyMedia>
          <EmptyDescription>{t("preview.empty")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const deck = (
    <div
      className="pf-deck"
      ref={deckRef}
      style={fit ? { transform: `scale(${scale})` } : undefined}
    >
      <CoverPage data={data} t={t} />
      {data.projects.map((project, i) => (
        <ProjectPage
          data={data}
          index={i}
          key={project.id}
          project={project}
          t={t}
          total={data.projects.length}
        />
      ))}
    </div>
  );

  if (!fit) {
    return deck;
  }

  return (
    <div
      className="pf-preview-fit"
      ref={containerRef}
      style={deckHeight ? { height: deckHeight } : undefined}
    >
      {deck}
    </div>
  );
}
