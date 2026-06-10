// prefer-dynamic-import for @react-pdf/renderer is skipped: this module is
// loaded via dynamic import() at the call site (portfolio-generator.tsx
// handleDownloadPDF). The static import here is required for @react-pdf JSX
// primitives to work.
import {
  Document,
  Image,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer"
import { ensureUrl } from "@rulisme/ui/lib/utils"
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

function backgroundLines(owner: PortfolioOwner, t: Translate): string[] {
  const { affiliation } = owner
  switch (affiliation.kind) {
    case "student":
      return [
        affiliation.institution,
        affiliation.semester
          ? `${t("preview.student")} · ${t("preview.semester")} ${affiliation.semester}`
          : t("preview.student"),
        affiliation.program ?? "",
      ].filter(Boolean)
    case "alumni":
      return [
        affiliation.institution,
        affiliation.graduationYear
          ? `${t("preview.alumni")} · ${affiliation.graduationYear}`
          : t("preview.alumni"),
        affiliation.program ?? "",
      ].filter(Boolean)
    case "professional":
      return [
        affiliation.organization ?? "",
        affiliation.yearsExperience
          ? `${affiliation.jobTitle ?? ""} · ${affiliation.yearsExperience} ${t("preview.years")}`
          : (affiliation.jobTitle ?? ""),
      ].filter(Boolean)
    default:
      return [affiliation.note || t("preview.independent")]
  }
}

function affiliationFootnote(owner: PortfolioOwner, t: Translate): string {
  const { affiliation } = owner
  switch (affiliation.kind) {
    case "student":
      return [affiliation.institution, t("preview.student")]
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

const INK = "#1d1d1f"
const INK_SOFT = "#6e6e73"
const INK_FAINT = "#a1a1a6"
const LINE = "#e3e3e6"
const PANEL = "#f5f5f7"
const ACCENT = "#6f839f"
const COVER_BG = "#121212"
const OFF_WHITE = "#faf9f6"
const PALE_STONE = "#b4b4b2"

const FIGURE_W = 360
const FIGURE_H = 202.5 // 16:9

const s = StyleSheet.create({
  cover: {
    flexDirection: "column",
    justifyContent: "space-between",
    backgroundColor: COVER_BG,
    paddingHorizontal: 40,
    paddingVertical: 40,
    fontFamily: "Helvetica",
  },
  coverKicker: {
    color: PALE_STONE,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  coverTitle: {
    color: OFF_WHITE,
    fontSize: 80,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -2,
  },
  coverTitleDot: { color: "#868684" },
  coverSub: {
    marginTop: 14,
    color: PALE_STONE,
    fontSize: 22,
    letterSpacing: -0.4,
  },
  coverFoot: {
    flexDirection: "row",
    gap: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#2a2a2d",
  },
  coverCol1: { flex: 1.2 },
  coverCol: { flex: 1 },
  coverH4: {
    marginBottom: 6,
    color: OFF_WHITE,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  coverP: { color: "#98989d", fontSize: 9, lineHeight: 1.5 },
  coverLink: { color: ACCENT, fontSize: 9, textDecoration: "none" },

  project: {
    paddingHorizontal: 40,
    paddingVertical: 40,
    backgroundColor: "#ffffff",
    fontFamily: "Helvetica",
  },
  index: {
    position: "absolute",
    top: 40,
    right: 40,
    color: INK_FAINT,
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  body: { flexDirection: "row", gap: 28 },
  rail: { width: 170, flexDirection: "column" },
  field: { marginBottom: 16 },
  fieldLabel: {
    marginBottom: 4,
    color: INK,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  fieldValue: { color: INK_SOFT, fontSize: 10 },
  fieldLink: { color: ACCENT, fontSize: 10, textDecoration: "none" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 4,
    backgroundColor: PANEL,
    color: INK_SOFT,
    fontSize: 8,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  badgeGroup: { borderColor: "#d6d6da", color: INK },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  tag: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 4,
    backgroundColor: PANEL,
    color: INK_SOFT,
    fontSize: 9,
  },
  sowItem: {
    flexDirection: "row",
    marginBottom: 2,
    color: INK_SOFT,
    fontSize: 10,
  },
  sowDot: { width: 10, color: INK_FAINT },
  sowText: { flex: 1, color: INK_SOFT, fontSize: 10, lineHeight: 1.4 },
  content: { flex: 1 },
  title: {
    color: INK,
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.6,
  },
  lede: {
    marginTop: 10,
    color: INK,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.4,
  },
  bodyText: { marginTop: 8, color: INK_SOFT, fontSize: 10, lineHeight: 1.5 },
  figure: {
    width: FIGURE_W,
    height: FIGURE_H,
    marginTop: 14,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 12,
    backgroundColor: PANEL,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  figureImage: { width: FIGURE_W, height: FIGURE_H, objectFit: "cover" },
  figurePlaceholder: { color: INK_SOFT, fontSize: 11, textAlign: "center" },
  reflect: {
    flexDirection: "row",
    gap: 28,
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  reflectCol: { flex: 1 },
  reflectLabel: {
    marginBottom: 5,
    color: INK_FAINT,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  reflectText: { color: INK_SOFT, fontSize: 10, lineHeight: 1.5 },
  pagefoot: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  pagefootText: { color: INK_FAINT, fontSize: 8 },
  pagefootStrong: { color: INK_SOFT, fontFamily: "Helvetica-Bold" },
})

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
      : t("preview.selectedWorksRange", {
          range: minY === maxY ? String(minY) : `${minY}–${maxY}`,
        })
  const background = backgroundLines(owner, t)
  const { contact } = owner
  const website = contact.websiteUrl?.trim()
  const social = contact.socials?.find((sl) => sl.url.trim())

  return (
    <Page orientation="landscape" size="A4" style={s.cover}>
      <Text style={s.coverKicker}>
        {"→  "}
        {t("preview.kicker", { year: data.cohortYear ?? "" })}
      </Text>
      <View>
        <Text style={s.coverTitle}>
          {t("preview.portfolio")}
          <Text style={s.coverTitleDot}>.</Text>
        </Text>
        <Text style={s.coverSub}>{sub || t("preview.yourName")}</Text>
      </View>
      <View style={s.coverFoot}>
        <View style={s.coverCol1}>
          <Text style={s.coverH4}>{owner.fullName || t("preview.author")}</Text>
          <Text style={s.coverP}>{worksLine}</Text>
          <Text style={s.coverP}>
            {t("preview.trackLine", { track: trackLabel(owner.track, t) })}
          </Text>
        </View>
        <View style={s.coverCol}>
          <Text style={s.coverH4}>{t("preview.background")}</Text>
          {background.map((line) => (
            <Text key={line} style={s.coverP}>
              {line}
            </Text>
          ))}
        </View>
        <View style={s.coverCol}>
          <Text style={s.coverH4}>{t("preview.contact")}</Text>
          {contact.phone ? <Text style={s.coverP}>{contact.phone}</Text> : null}
          {contact.email ? (
            <Link src={`mailto:${contact.email}`} style={s.coverLink}>
              {contact.email}
            </Link>
          ) : null}
          {website ? (
            <Link src={ensureUrl(website)} style={s.coverLink}>
              {displayUrl(website)}
            </Link>
          ) : social ? (
            <Link src={ensureUrl(social.url)} style={s.coverLink}>
              {social.label || displayUrl(social.url)}
            </Link>
          ) : null}
        </View>
        <View style={s.coverCol}>
          <Text style={s.coverH4}>{t("preview.submissionFor")}</Text>
          <Text style={s.coverP}>
            {data.submissionTarget || t("preview.defaultTarget")}
          </Text>
        </View>
      </View>
    </Page>
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
    <Page orientation="landscape" size="A4" style={s.project}>
      <Text style={s.index}>
        {t("preview.projectIndex", { n: index + 1, total })}
      </Text>
      <View style={s.body}>
        <View style={s.rail}>
          <View style={s.field}>
            <Text style={s.fieldLabel}>{t("preview.yearAccomplished")}</Text>
            <Text style={s.fieldValue}>{project.yearAccomplished || "—"}</Text>
          </View>
          <View style={s.field}>
            <Text style={s.fieldLabel}>{t("preview.rolePosition")}</Text>
            <Text style={s.fieldValue}>{project.role || "—"}</Text>
          </View>
          <View style={s.field}>
            <Text style={s.fieldLabel}>{t("preview.type")}</Text>
            <View style={s.badgeRow}>
              <Text style={s.badge}>
                {projectTypeLabel(project.projectType, t)}
              </Text>
              {isGroup ? (
                <Text style={[s.badge, s.badgeGroup]}>
                  {t("preview.groupProject")}
                </Text>
              ) : null}
            </View>
          </View>
          {project.publicationUrl ? (
            <View style={s.field}>
              <Text style={s.fieldLabel}>{t("preview.publicationLink")}</Text>
              <Link src={ensureUrl(project.publicationUrl)} style={s.fieldLink}>
                {displayUrl(project.publicationUrl)}
              </Link>
            </View>
          ) : null}
          {sow.length > 0 ? (
            <View style={s.field}>
              <Text style={s.fieldLabel}>{t("preview.scopeOfWork")}</Text>
              {sow.map((item) => (
                <View key={item} style={s.sowItem}>
                  <Text style={s.sowDot}>{"•"}</Text>
                  <Text style={s.sowText}>{item}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {tags.length > 0 ? (
            <View style={s.field}>
              <Text style={s.fieldLabel}>{tagLabel}</Text>
              <View style={s.tagRow}>
                {tags.map((tag) => (
                  <Text key={tag} style={s.tag}>
                    {tag}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
        </View>
        <View style={s.content}>
          <Text style={s.title}>
            {project.title || t("preview.untitledProject")}
          </Text>
          {project.summary ? (
            <Text style={s.lede}>{project.summary}</Text>
          ) : null}
          {project.description ? (
            <Text style={s.bodyText}>{project.description}</Text>
          ) : null}
          <View style={s.figure}>
            {media?.url ? (
              <Image src={media.url} style={s.figureImage} />
            ) : (
              <Text style={s.figurePlaceholder}>
                {t("preview.artworkTitle")}
              </Text>
            )}
          </View>
        </View>
      </View>
      <View style={s.reflect}>
        <View style={s.reflectCol}>
          <Text style={s.reflectLabel}>{t("preview.impact")}</Text>
          <Text style={s.reflectText}>{project.impact}</Text>
        </View>
        <View style={s.reflectCol}>
          <Text style={s.reflectLabel}>{t("preview.learned")}</Text>
          <Text style={s.reflectText}>{project.learnings}</Text>
        </View>
      </View>
      <View style={s.pagefoot}>
        <Text style={s.pagefootText}>
          <Text style={s.pagefootStrong}>
            {owner.fullName || t("preview.author")}
          </Text>
          {" · "}
          {affiliationFootnote(owner, t)}
        </Text>
        <Text style={s.pagefootText}>
          {[
            owner.contact.email,
            data.submissionTarget || t("preview.defaultTarget"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
    </Page>
  )
}

export function PortfolioDocument({
  data,
  t,
}: {
  data: Portfolio
  t: Translate
}) {
  return (
    <Document>
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
    </Document>
  )
}
