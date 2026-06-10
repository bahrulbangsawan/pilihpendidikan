import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@/i18n"
import {
  type Portfolio,
  type PortfolioOwner,
  type Project,
  type ProjectType,
  type Track,
} from "@/components/portfolio-data-model"

type Translate = (
  key: string,
  params?: Record<string, string | number>
) => string

const PROTOCOL_RE = /^https?:\/\//i
const WWW_RE = /^www\./i
const TRAILING_SLASH_RE = /\/$/

// Compact, link-style display of a URL (protocol + www + trailing slash dropped).
function displayUrl(url: string): string {
  return url
    .replace(PROTOCOL_RE, "")
    .replace(WWW_RE, "")
    .replace(TRAILING_SLASH_RE, "")
}

function trackLabel(track: Track, t: Translate): string {
  return t(`options.track.${track}`)
}

function projectTypeLabel(type: ProjectType, t: Translate): string {
  switch (type) {
    case "class-assignment":
      return t("preview.classAssignment")
    case "work-assignment":
      return t("preview.workAssignment")
    default:
      return t("preview.selfInitiated")
  }
}

// Cover column 2 ("Background") — render the owner's affiliation as ≤3 lines.
function backgroundLines(owner: PortfolioOwner, t: Translate): string[] {
  const { affiliation } = owner
  switch (affiliation.kind) {
    case "student": {
      const status = affiliation.semester
        ? `${t("preview.student")} · ${t("preview.semester")} ${affiliation.semester}`
        : t("preview.student")
      return [
        affiliation.institution,
        status,
        affiliation.program ?? "",
      ].filter(Boolean)
    }
    case "alumni": {
      const status = affiliation.graduationYear
        ? `${t("preview.alumni")} · ${affiliation.graduationYear}`
        : t("preview.alumni")
      return [
        affiliation.institution,
        status,
        affiliation.program ?? "",
      ].filter(Boolean)
    }
    case "professional": {
      const status = affiliation.yearsExperience
        ? `${affiliation.jobTitle ?? ""} · ${affiliation.yearsExperience} ${t("preview.years")}`
        : (affiliation.jobTitle ?? "")
      return [affiliation.organization ?? "", status].filter(Boolean)
    }
    default:
      return [affiliation.note || t("preview.independent")]
  }
}

// Compact one-line affiliation tag for the per-page footer.
function affiliationFootnote(owner: PortfolioOwner, t: Translate): string {
  const { affiliation } = owner
  switch (affiliation.kind) {
    case "student":
      return [
        affiliation.institution,
        affiliation.semester
          ? `${t("preview.student")}, ${t("preview.semesterShort")} ${affiliation.semester}`
          : t("preview.student"),
      ]
        .filter(Boolean)
        .join(" · ")
    case "alumni":
      return [affiliation.institution, t("preview.alumni")]
        .filter(Boolean)
        .join(" · ")
    case "professional":
      return [affiliation.organization, affiliation.jobTitle]
        .filter(Boolean)
        .join(" · ")
    default:
      return affiliation.note || t("preview.independent")
  }
}

function CoverPage({ data, t }: { data: Portfolio; t: Translate }) {
  const { owner } = data
  const sub = [owner.fullName, owner.headline].filter(Boolean).join(" · ")

  const years = data.projects
    .map((p) => p.yearAccomplished)
    .filter((y) => y > 0)
  const minY = years.length ? Math.min(...years) : undefined
  const maxY = years.length ? Math.max(...years) : undefined
  const worksLine =
    minY === undefined
      ? t("preview.selectedWorks")
      : minY === maxY
        ? t("preview.selectedWorksRange", { range: String(minY) })
        : t("preview.selectedWorksRange", { range: `${minY}–${maxY}` })
  const trackLine = t("preview.trackLine", {
    track: trackLabel(owner.track, t),
  })

  const background = backgroundLines(owner, t)
  const { contact } = owner
  const website = contact.websiteUrl?.trim()
  const social = contact.socials?.find((s) => s.url.trim())

  return (
    <section className="pf-page pf-cover">
      <div className="pf-cover__kicker">
        <span className="pf-dot">→</span>
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
          <p>
            {worksLine}
            <br />
            {trackLine}
          </p>
        </div>
        <div>
          <h4>{t("preview.background")}</h4>
          <p>
            {background.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static affiliation lines, never reordered
              <span key={i}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        </div>
        <div>
          <h4>{t("preview.contact")}</h4>
          <p>
            {contact.phone && (
              <>
                {contact.phone}
                <br />
              </>
            )}
            {contact.email && (
              <>
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
                <br />
              </>
            )}
            {website ? (
              <a href={website} rel="noreferrer" target="_blank">
                {displayUrl(website)}
              </a>
            ) : social ? (
              <a href={social.url} rel="noreferrer" target="_blank">
                {social.label || displayUrl(social.url)}
              </a>
            ) : null}
          </p>
        </div>
        <div>
          <h4>{t("preview.submissionFor")}</h4>
          <p>{data.submissionTarget || t("preview.defaultTarget")}</p>
        </div>
      </div>
    </section>
  )
}

function ProjectPage({
  data,
  project,
  index,
  total,
  t,
}: {
  data: Portfolio
  project: Project
  index: number
  total: number
  t: Translate
}) {
  const { owner } = data
  const media = project.media[0]
  const sow = (project.scopeOfWork ?? []).slice(0, 6)
  const track = project.track ?? owner.track
  const isTech = track === "tech"
  const tags = (isTech ? project.technologies : project.skills) ?? []
  const tagLabel = isTech ? t("preview.technologies") : t("preview.disciplines")
  const isGroup = project.collaboration.kind === "group"

  return (
    <section className="pf-page pf-project">
      <span className="pf-project__index">
        {t("preview.projectIndex", { n: index + 1, total })}
      </span>

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
        {project.publicationUrl && (
          <div className="pf-field">
            <h5>{t("preview.publicationLink")}</h5>
            <p>
              <a href={project.publicationUrl} rel="noreferrer" target="_blank">
                {displayUrl(project.publicationUrl)}
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
      </div>

      <div className="pf-figure">
        {media?.url ? (
          <img alt={media.alt || project.title} src={media.url} />
        ) : (
          <>
            <div className="pf-ph-title">{t("preview.artworkTitle")}</div>
            <div className="pf-ph-note">{t("preview.artworkNote")}</div>
          </>
        )}
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
        <span>
          {[
            owner.contact.email,
            data.submissionTarget || t("preview.defaultTarget"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </section>
  )
}

interface PortfolioPreviewProps {
  data: Portfolio
  /** When true (editor), scale the natural-size A4 deck to fit the pane. */
  fit?: boolean
}

export function PortfolioPreview({ data, fit = true }: PortfolioPreviewProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [deckHeight, setDeckHeight] = useState<number | null>(null)

  const hasContent =
    Boolean(data.owner.fullName.trim()) ||
    data.projects.some(
      (p) => p.title.trim() || p.summary.trim() || p.description.trim()
    )

  useEffect(() => {
    if (!fit) {
      return
    }
    const container = containerRef.current
    const deck = deckRef.current
    if (!(container && deck)) {
      return
    }
    const measure = () => {
      const cw = container.clientWidth
      const dw = deck.offsetWidth // natural width — transform doesn't affect layout box
      const next = dw > 0 ? Math.min(1, cw / dw) : 1
      setScale(next)
      setDeckHeight(deck.offsetHeight * next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    ro.observe(deck)
    return () => ro.disconnect()
    // Re-attach when the deck first mounts (empty → has content) and when the
    // page count changes; the ResizeObserver handles all subsequent size drift.
  }, [fit, hasContent, data.projects.length])

  if (!hasContent) {
    return (
      <div className="pf-empty">
        <p className="text-sm text-muted-foreground">{t("preview.empty")}</p>
      </div>
    )
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
  )

  if (!fit) {
    return deck
  }

  return (
    <div
      className="pf-preview-fit"
      ref={containerRef}
      style={deckHeight ? { height: deckHeight } : undefined}
    >
      {deck}
    </div>
  )
}
