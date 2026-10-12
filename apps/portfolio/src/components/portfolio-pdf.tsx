// Static JSX primitives are loaded only behind portfolio-generator's compile-
// time SSR guard; this browser PDF template never enters the Workers graph.
import {
  Document,
  Image,
  Link,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import { ensureUrl } from "@rulisme/ui/lib/utils";
import type { ReactNode } from "react";
import type {
  Portfolio,
  PortfolioOwner,
  Project,
  ProjectType,
  Track,
} from "@/components/portfolio-data-model";
import { coverFootLines } from "@/lib/cover-foot";
// Registers Inter before the first render.
import { PDF_FONT_FAMILY } from "@/lib/pdf-fonts";
import { toPdfText } from "@/lib/pdf-text";

type Translate = (
  key: string,
  params?: Record<string, string | number>
) => string;

const PROTOCOL_RE = /^https?:\/\//i;
const WWW_RE = /^www\./i;
const TRAILING_SLASH_RE = /\/$/;

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

function backgroundLines(owner: PortfolioOwner, t: Translate): string[] {
  const { affiliation } = owner;
  switch (affiliation.kind) {
    case "student":
      return [
        affiliation.institution,
        affiliation.semester
          ? `${t("preview.student")} · ${t("preview.semester")} ${affiliation.semester}`
          : t("preview.student"),
        affiliation.program ?? "",
      ].filter(Boolean);
    case "alumni":
      return [
        affiliation.institution,
        affiliation.graduationYear
          ? `${t("preview.alumni")} · ${affiliation.graduationYear}`
          : t("preview.alumni"),
        affiliation.program ?? "",
      ].filter(Boolean);
    case "professional":
      return [
        affiliation.organization ?? "",
        affiliation.yearsExperience
          ? `${affiliation.jobTitle ?? ""} · ${affiliation.yearsExperience} ${t("preview.years")}`
          : (affiliation.jobTitle ?? ""),
      ].filter(Boolean);
    default:
      return [affiliation.note || t("preview.independent")];
  }
}

// The page footer's one-line affiliation, worded exactly as the preview's.
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

// Print colours, kept in sync by hand with the `.pf-*` deck CSS in
// src/styles.css (TYPOGRAPHY.md § Exceptions: literals, never re-themed).
// Project pages are Zedative ink on white paper; the cover sits on Zedative's
// dark `shot` surface, and links take the cobalt (lifted on the dark cover).
const PAPER = "#ffffff";
const FG = "#000000"; // fg — project title, headings, the author's name
const INK = "#393d45"; // ink — body copy (summary, description, reflection)
const MUTED = "#5a6170"; // fg-muted — rail values, chips, meta, footer — 6.22:1
const LINE = "#cbcfd4"; // line — the hairline rules
const BORDER = "#dadde2"; // border — chip and image frames
const PANEL = "#fafafa"; // bg-2 — chip and image-slot fill
const ACCENT = "#1348dc"; // links on paper — 7.03:1
const COVER_BG = "#2f343e"; // Zedative `shot`
const COVER_FG = "#fafafa"; // 11.96:1 on the cover
const COVER_SOFT = "#b4b9c3"; // kicker, subtitle — 6.34:1
const COVER_FAINT = "#9aa1ad"; // footer columns — 4.80:1
const COVER_DOT = "#858c99"; // the title's decorative full stop
const COVER_LINE = "#4a505c"; // the rule above the cover footer
const COVER_ACCENT = "#7c9cff"; // cobalt lifted for the dark cover — 4.79:1
// Zedative's xs radius (2px): the chips (tags, badges) and the image tile.
// Never pills, never rounded cards.
const RADIUS_XS = 2;
// The hairline frame around the image tile.
const FRAME = 1;
// react-pdf reads `flexShrink: 0` as 1 (its layout sets `value || 1`), so
// "this box gives way first" is spelled as a ratio: it shrinks this many times
// faster than its siblings, which keep their size. Scope of Work is the rail's
// one flexible field (portfolio-data-model.ts): when the rail is full (six
// items beside six wrapped tag rows) it gives way and sheds whole items;
// without it yoga squeezed every rail box and their text dropped out.
const GIVE_WAY = 10_000;

// Project image — a TRUE 16:9 card (never cropped). Height is the limiting
// dimension on A4 landscape (a full-content-width 16:9 would be 317pt tall and
// overflow once you add the text + reflect strip + footer), so the card is the
// largest exact-16:9 that fits and is centered in the content column.
const FIGURE_H = 261;
const FIGURE_W = Math.round((FIGURE_H * 16) / 9); // 464 — exact 16:9

// Type is Zedative's one family, Inter (registered in src/lib/pdf-fonts.ts),
// set once on each page and inherited. Three weights, as in the preview: 400
// text, 600 headings and names, 700 the cover title. Copy renders as written,
// in sentence case, with no case transform and no tracking. Sizes, spacing and
// the fixed line boxes are the locked layout's.
const s = StyleSheet.create({
  cover: {
    flexDirection: "column",
    justifyContent: "space-between",
    backgroundColor: COVER_BG,
    paddingHorizontal: 40,
    paddingVertical: 40,
    fontFamily: PDF_FONT_FAMILY,
    fontWeight: 400,
  },
  coverKickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coverDot: {
    width: 16,
    height: 16,
    borderWidth: 1,
    borderColor: COVER_FG,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  // maxLines + ellipsis are the PDF's line clamps (LINES), as
  // -webkit-line-clamp and nowrap/ellipsis are the preview's.
  coverKicker: {
    color: COVER_SOFT,
    fontSize: 9,
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  coverTitle: { color: COVER_FG, fontSize: 80, fontWeight: 700 },
  coverTitleDot: { color: COVER_DOT },
  coverSub: {
    marginTop: 14,
    color: COVER_SOFT,
    fontSize: 22,
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  coverFoot: {
    flexDirection: "row",
    gap: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: COVER_LINE,
  },
  coverCol1: { flex: 1.2 },
  coverCol: { flex: 1 },
  coverH4: {
    marginBottom: 6,
    color: COVER_FG,
    fontSize: 8,
    fontWeight: 600,
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  coverP: {
    color: COVER_FAINT,
    fontSize: 9,
    lineHeight: 1.5,
    textOverflow: "ellipsis",
  },
  coverLink: { color: COVER_ACCENT, textDecoration: "none" },

  project: {
    paddingTop: 40,
    paddingBottom: 16, // tight bottom gutter so the footer sits flush at the edge
    paddingHorizontal: 40,
    backgroundColor: PAPER,
    fontFamily: PDF_FONT_FAMILY,
    fontWeight: 400,
  },
  // Fixed-height rail+content row = the text block + the 16:9 figure below it
  // (406 = 131 text + 14 gap + 261 figure). Fixed (not flexGrow) keeps one
  // project on exactly one A4 page; the spacer below pins the reflect strip +
  // footer flush to the bottom.
  body: { flexDirection: "row", gap: 28, height: 406, overflow: "hidden" },
  // Absorbs leftover slack so the reflect strip + footer pack flush at the bottom.
  spacer: { flexGrow: 1 },
  rail: { width: 170, flexDirection: "column" },
  field: { marginBottom: 16 },
  // The rail's last field (the tags) sits at the foot of the rail, as the
  // preview's `.pf-field--tech` does: its auto margin takes the rail's spare
  // height, which is none once the rail is full and Scope of Work gives way.
  fieldLast: { marginTop: "auto", marginBottom: 0 },
  fieldSow: { flexShrink: GIVE_WAY, minHeight: 0, overflow: "hidden" },
  fieldLabel: { marginBottom: 4, color: FG, fontSize: 8, fontWeight: 600 },
  // 1-line clamps mirror the HTML preview's nowrap/ellipsis rail rows so a long
  // value can't wrap to 2 lines and balloon the rail past the A4 page height.
  fieldValue: {
    height: 13,
    overflow: "hidden",
    color: MUTED,
    fontSize: 10,
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  fieldLink: {
    height: 13,
    overflow: "hidden",
    color: ACCENT,
    fontSize: 10,
    textDecoration: "none",
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS_XS,
    backgroundColor: PANEL,
    color: MUTED,
    fontSize: 8,
  },
  badgeGroup: { borderColor: LINE, color: FG },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  tag: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS_XS,
    backgroundColor: PANEL,
    color: MUTED,
    fontSize: 9,
  },
  // A column that wraps: an item that no longer fits moves to a second column
  // beside the rail, which the clip hides, so the list only ever loses whole
  // items (the preview's `.pf-sow` does the same).
  sowList: {
    flexDirection: "column",
    flexWrap: "wrap",
    flexShrink: GIVE_WAY,
    minHeight: 0,
    overflow: "hidden",
  },
  sowItem: {
    flexDirection: "row",
    width: "100%",
    marginBottom: 2,
    color: MUTED,
    fontSize: 10,
  },
  sowDot: { width: 10, color: MUTED },
  // maxLines keeps a long item to its one line with an ellipsis. Without it a
  // wrapped item vanished: its two lines overflow the 14pt box, and react-pdf
  // keeps no line of an overflowing box that is exactly one line tall.
  sowText: {
    height: 14,
    overflow: "hidden",
    flex: 1,
    color: MUTED,
    fontSize: 10,
    lineHeight: 1.4,
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  content: { flex: 1 },
  // Fixed heights + overflow:hidden clamp each block to its line budget so the
  // figure/reflect/footer below always sit at the same Y — one project, one page.
  title: {
    height: 30, // 1 line
    overflow: "hidden",
    color: FG,
    fontSize: 24,
    fontWeight: 600,
  },
  lede: {
    height: 36, // 2 lines
    overflow: "hidden",
    marginTop: 10,
    color: INK,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.4,
  },
  bodyText: {
    height: 47, // 3 lines
    overflow: "hidden",
    marginTop: 8,
    color: INK,
    fontSize: 10,
    lineHeight: 1.5,
  },
  // Exact 16:9 card (FIGURE_W × FIGURE_H), left-aligned in the content column.
  // Sized below full width because a full-width 16:9 would be too tall for one
  // A4 page. A Zedative tile: 2px corners, 1px `border` frame.
  figure: {
    width: FIGURE_W,
    height: FIGURE_H,
    alignSelf: "flex-start",
    marginTop: 14,
    borderWidth: FRAME,
    borderColor: BORDER,
    borderRadius: RADIUS_XS,
    backgroundColor: PANEL,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  // The image fills the tile inside its frame, as the preview's <img> fills
  // `.pf-figure`'s content box, so the frame shows on all four sides (a
  // full-size image covered the side rules and lost a point top and bottom).
  // The upload is pre-validated 16:9; inside the hairline, cover trims less
  // than a point, as the preview's object-fit does.
  figureImage: {
    width: FIGURE_W - 2 * FRAME,
    height: FIGURE_H - 2 * FRAME,
    objectFit: "cover",
    borderRadius: RADIUS_XS - FRAME,
  },
  // The empty slot's title and two-line note, as the preview's `.pf-ph-title`
  // and `.pf-ph-note` (15px and 12px on a 1.5 line, the note 440px wide at
  // most) in points.
  figurePlaceholder: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 1.5,
    textAlign: "center",
  },
  figureNote: {
    maxWidth: 330,
    marginTop: 4.5,
    color: MUTED,
    fontSize: 9,
    lineHeight: 1.5,
    textAlign: "center",
    maxLines: 2,
    textOverflow: "ellipsis",
  },
  reflect: {
    flexDirection: "row",
    gap: 28,
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  reflectCol: { flex: 1 },
  reflectLabel: { marginBottom: 5, color: FG, fontSize: 8, fontWeight: 600 },
  reflectText: {
    height: 47, // 3 lines
    overflow: "hidden",
    color: INK,
    fontSize: 10,
    lineHeight: 1.5,
  },
  // One line (LINES.project.pageFooter): the left text takes the room the
  // right cluster leaves and ends in an ellipsis, as the preview's spans do.
  pagefoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  pagefootText: {
    color: MUTED,
    fontSize: 8,
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  pagefootLeft: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  pagefootStrong: { color: FG, fontWeight: 600 },
  pagefootRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  // The contact line stops at a fixed width (react-pdf wraps text at the
  // width it measures, not at the width a shrinking row leaves it), so the
  // name keeps at least a third of the 762pt row and the index stays whole.
  pagefootContact: { maxWidth: 440 },
  pagefootIndex: { color: MUTED, fontSize: 8 },
});

interface FootEntry {
  key: string;
  node: ReactNode;
}

// A cover footer column's entries, each its own Text clamped to its share of
// the column's lines (coverFootLines): the first may wrap into the lines the
// others leave, every later entry keeps one line and ends in an ellipsis.
// The preview's FootLines clamps each entry's block the same way. (One Text
// per entry also keeps newlines out of the PDF: react-pdf sets a newline
// character, which Inter lacks, in its built-in, unembedded Helvetica.)
function FootLines({ entries }: { entries: FootEntry[] }) {
  const lines = coverFootLines(entries.length);
  return (
    <>
      {entries.slice(0, lines.length).map(({ key, node }, i) => (
        <Text key={key} style={[s.coverP, { maxLines: lines[i] }]}>
          {node}
        </Text>
      ))}
    </>
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
  const worksLine =
    minY === undefined
      ? t("preview.selectedWorks")
      : t("preview.selectedWorksRange", {
          range: minY === maxY ? String(minY) : `${minY}–${maxY}`,
        });
  const trackLine = t("preview.trackLine", {
    track: trackLabel(owner.track, t),
  });
  const background = backgroundLines(owner, t);
  const { contact } = owner;
  const website = contact.websiteUrl?.trim();
  const social = contact.socials?.find((sl) => sl.url.trim());
  const contactLink = website
    ? { url: ensureUrl(website), label: displayUrl(website) }
    : social && {
        url: ensureUrl(social.url),
        label: social.label || displayUrl(social.url),
      };
  const contactEntries: FootEntry[] = [];
  if (contact.phone) {
    contactEntries.push({ key: "phone", node: contact.phone });
  }
  if (contact.email) {
    contactEntries.push({
      key: "email",
      node: (
        <Link src={`mailto:${contact.email}`} style={s.coverLink}>
          {contact.email}
        </Link>
      ),
    });
  }
  if (contactLink) {
    contactEntries.push({
      key: "link",
      node: (
        <Link src={contactLink.url} style={s.coverLink}>
          {contactLink.label}
        </Link>
      ),
    });
  }

  return (
    <Page orientation="landscape" size="A4" style={s.cover}>
      <View style={s.coverKickerRow}>
        <View style={s.coverDot}>
          <Svg height={9} viewBox="0 0 24 24" width={9}>
            <Path
              d="M4 12 L20 12 M13 5 L20 12 L13 19"
              fill="none"
              stroke={COVER_FG}
              strokeWidth={2.5}
            />
          </Svg>
        </View>
        <Text style={s.coverKicker}>
          {t("preview.kicker", { year: data.cohortYear ?? "" })}
        </Text>
      </View>
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
          <FootLines
            entries={[
              { key: "works", node: worksLine },
              { key: "track", node: trackLine },
            ]}
          />
        </View>
        <View style={s.coverCol}>
          <Text style={s.coverH4}>{t("preview.background")}</Text>
          {/* Keyed by position: two lines may read the same (a program
              named like its institution). */}
          <FootLines
            entries={background.map((line, i) => ({
              key: `line-${i}`,
              node: line,
            }))}
          />
        </View>
        <View style={s.coverCol}>
          <Text style={s.coverH4}>{t("preview.contact")}</Text>
          <FootLines entries={contactEntries} />
        </View>
        <View style={s.coverCol}>
          <Text style={s.coverH4}>{t("preview.submissionFor")}</Text>
          <FootLines
            entries={[
              {
                key: "target",
                node: data.submissionTarget || t("preview.defaultTarget"),
              },
            ]}
          />
        </View>
      </View>
    </Page>
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

  return (
    <Page orientation="landscape" size="A4" style={s.project}>
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
            <View style={[s.field, s.fieldSow]}>
              <Text style={s.fieldLabel}>{t("preview.scopeOfWork")}</Text>
              <View style={s.sowList}>
                {sow.map((item) => (
                  <View key={item} style={s.sowItem}>
                    <Text style={s.sowDot}>{"•"}</Text>
                    <Text style={s.sowText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {tags.length > 0 ? (
            <View style={[s.field, s.fieldLast]}>
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
          <Text style={s.lede}>{project.summary}</Text>
          <Text style={s.bodyText}>{project.description}</Text>
          <View style={s.figure}>
            {media?.url ? (
              <Image src={media.url} style={s.figureImage} />
            ) : (
              <>
                <Text style={s.figurePlaceholder}>
                  {t("preview.artworkTitle")}
                </Text>
                <Text style={s.figureNote}>{t("preview.artworkNote")}</Text>
              </>
            )}
          </View>
        </View>
      </View>
      <View style={s.spacer} />
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
        <Text style={[s.pagefootText, s.pagefootLeft]}>
          <Text style={s.pagefootStrong}>
            {owner.fullName || t("preview.author")}
          </Text>
          {" · "}
          {affiliationFootnote(owner, t)}
        </Text>
        <View style={s.pagefootRight}>
          <Text style={[s.pagefootText, s.pagefootContact]}>
            {[
              owner.contact.email,
              data.submissionTarget || t("preview.defaultTarget"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text style={s.pagefootIndex}>
            {t("preview.projectIndex", { n: index + 1, total })}
          </Text>
        </View>
      </View>
    </Page>
  );
}

export function PortfolioDocument({
  data: portfolio,
  t,
}: {
  data: Portfolio;
  t: Translate;
}) {
  const data = toPdfText(portfolio);
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
  );
}
