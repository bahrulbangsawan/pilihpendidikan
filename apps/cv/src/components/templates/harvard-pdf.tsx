// Static JSX primitives are loaded only behind cv-generator's compile-time SSR
// guard; this browser PDF template is not part of the Workers module graph.
import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { ensureUrl, formatPhoneDisplay } from "@rulisme/ui/lib/utils";
import type { CVData, CVSectionId } from "@/components/cv-form";
import { PDF_FONT_FAMILY } from "@/lib/pdf-fonts";
import {
  formatOngoingEndDate,
  getDescriptionLines,
  getTextLines,
} from "./template-utils";

// Zedative on paper: Inter (registered in src/lib/pdf-fonts.ts), name and
// headings #000000, body ink #393d45, dates and meta #5a6170, rules #cbcfd4,
// links cobalt #1348dc. Weight 700 for the name, 600 for headings and labels;
// copy set as written, no letter-spacing. The preview (harvard-preview.tsx)
// uses the matching token classes.
const s = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_FAMILY,
    backgroundColor: "#ffffff",
    paddingTop: 32,
    paddingBottom: 32,
    paddingHorizontal: 40,
    fontSize: 9,
    color: "#393d45",
    lineHeight: 1.5,
  },
  headerWrap: { alignItems: "center", marginBottom: 4 },
  name: {
    fontSize: 16,
    fontWeight: 700,
    color: "#000000",
    textAlign: "center",
  },
  contact: { fontSize: 8, color: "#5a6170", marginTop: 6, textAlign: "center" },
  sectionWrap: { marginTop: 10 },
  sectionTitleWrap: {
    borderTopWidth: 1,
    borderTopColor: "#cbcfd4",
    borderBottomWidth: 1,
    borderBottomColor: "#cbcfd4",
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitleText: {
    fontSize: 8,
    fontWeight: 600,
    color: "#000000",
    textAlign: "center",
  },
  entryWrap: { marginTop: 6 },
  entryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  entryTitle: { fontSize: 10, fontWeight: 600, color: "#000000", flex: 1 },
  entryDate: { fontSize: 8, color: "#5a6170", marginLeft: 8, flexShrink: 0 },
  // The meta line under an entry row starts flush with the title, as in
  // the preview (entryDate's left margin only spaces it from the title).
  entryMeta: { fontSize: 8, color: "#5a6170" },
  bodyText: { fontSize: 9, color: "#393d45", lineHeight: 1.6 },
  bulletRow: { flexDirection: "row", marginTop: 2, paddingLeft: 4 },
  bulletDot: { width: 8, fontSize: 9, color: "#393d45" },
  bulletText: { flex: 1, fontSize: 9, color: "#393d45", lineHeight: 1.6 },
  skillRow: { marginTop: 3 },
  skillLabel: { fontWeight: 600, color: "#000000" },
  langRow: { marginTop: 3 },
  langLabel: { fontWeight: 600, color: "#000000" },
  langProficiency: { color: "#5a6170" },
  // A link inside a heading: cobalt, underlined (react-pdf's link default).
  inlineLink: { color: "#1348dc" },
  link: {
    fontSize: 8,
    color: "#1348dc",
    textDecoration: "underline",
    marginTop: 2,
  },
  entrySubtext: { fontSize: 8, color: "#5a6170", marginTop: 1 },
});

function formatMonth(value: string): string {
  if (!value) {
    return "";
  }
  const [year, month] = value.split("-");
  if (!(year && month)) {
    return value;
  }
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

const WORK_TYPE_LABELS: Record<string, string> = {
  "full-time": "Full-Time",
  "part-time": "Part-Time",
  internship: "Internship",
};
const LOCATION_LABELS: Record<string, string> = {
  "work-from-office": "Work From Office",
  "work-from-anywhere": "Work From Anywhere",
  hybrid: "Hybrid",
};
const EDUCATION_CATEGORY_LABELS: Record<string, string> = {
  university: "University",
  college: "College / Institute",
  school: "School (K-12)",
  polytechnic: "Polytechnic / Vocational",
  academy: "Academy",
  "language-center": "Language / Tuition Center",
  "online-platform": "Online Learning Platform",
  "professional-association": "Professional Association",
};

export function CVDocument({ data }: { data: CVData }) {
  const {
    personalInfo,
    summary,
    experience,
    education,
    skills,
    awards,
    certificates,
    languages,
    projects,
    volunteer,
  } = data;

  // Sections follow the order the user set (the form's drag handles, the
  // MCP reorder tool), exactly as the preview lists them.
  const sections: Record<CVSectionId, React.ReactNode> = {
    summary: summary && (
      <View key="summary" style={s.sectionWrap}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionTitleText}>{data.summaryTitle}</Text>
        </View>
        <View style={{ marginTop: 6 }}>
          {getTextLines(summary).map(({ key, text }) => (
            <Text key={key} style={s.bodyText}>
              {text}
            </Text>
          ))}
        </View>
      </View>
    ),
    experience: experience.some((e) => e.company || e.title) && (
      <View key="experience" style={s.sectionWrap}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionTitleText}>{data.experienceTitle}</Text>
        </View>
        {experience.reduce<React.ReactNode[]>((acc, entry) => {
          if (!(entry.company || entry.title)) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <View style={s.entryRow}>
                <Text style={s.entryTitle}>
                  {entry.title}
                  {entry.title && entry.company ? ", " : ""}
                  {entry.url ? (
                    <Link src={ensureUrl(entry.url)} style={s.inlineLink}>
                      {entry.company}
                    </Link>
                  ) : (
                    entry.company
                  )}
                </Text>
                {(entry.startDate || entry.endDate || entry.current) && (
                  <Text style={s.entryDate}>
                    {[
                      formatMonth(entry.startDate),
                      formatOngoingEndDate(
                        entry.endDate,
                        entry.current,
                        formatMonth
                      ),
                    ]
                      .filter(Boolean)
                      .join(" – ")}
                  </Text>
                )}
              </View>
              {(entry.workType || entry.locationPolicy) && (
                <Text style={s.entryMeta}>
                  {[
                    WORK_TYPE_LABELS[entry.workType],
                    LOCATION_LABELS[entry.locationPolicy],
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              )}
              {getDescriptionLines(entry.description).map(({ key, text }) => (
                <View key={key} style={s.bulletRow}>
                  <Text style={s.bulletDot}>{"•"}</Text>
                  <Text style={s.bulletText}>{text}</Text>
                </View>
              ))}
            </View>
          );
          return acc;
        }, [])}
      </View>
    ),
    education: education.some((e) => e.institution || e.degree) && (
      <View key="education" style={s.sectionWrap}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionTitleText}>{data.educationTitle}</Text>
        </View>
        {education.reduce<React.ReactNode[]>((acc, entry) => {
          if (!(entry.institution || entry.degree)) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <View style={s.entryRow}>
                <Text style={s.entryTitle}>
                  {entry.degree}
                  {entry.degree && entry.institution ? ", " : ""}
                  {entry.institution}
                </Text>
                {(entry.startDate || entry.endDate || entry.current) && (
                  <Text style={s.entryDate}>
                    {[
                      formatMonth(entry.startDate),
                      entry.current ? "Present" : formatMonth(entry.endDate),
                    ]
                      .filter(Boolean)
                      .join(" – ")}
                  </Text>
                )}
              </View>
              {(entry.gpa || entry.category) && (
                <Text style={s.entryMeta}>
                  {[
                    entry.category
                      ? EDUCATION_CATEGORY_LABELS[entry.category]
                      : "",
                    entry.gpa ? `GPA: ${entry.gpa}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              )}
            </View>
          );
          return acc;
        }, [])}
      </View>
    ),
    skills: skills.some((c) => c.items.length > 0) && (
      <View key="skills" style={s.sectionWrap}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionTitleText}>{data.skillsTitle}</Text>
        </View>
        {skills.reduce<React.ReactNode[]>((acc, cat) => {
          if (cat.items.length === 0) {
            return acc;
          }
          acc.push(
            <Text key={cat.id} style={[s.bodyText, s.skillRow]}>
              {cat.name && <Text style={s.skillLabel}>{cat.name}: </Text>}
              {cat.items.join(", ")}
            </Text>
          );
          return acc;
        }, [])}
      </View>
    ),
    awards: awards.some((e) => e.title) && (
      <View key="awards" style={s.sectionWrap}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionTitleText}>{data.awardsTitle}</Text>
        </View>
        {awards.reduce<React.ReactNode[]>((acc, entry) => {
          if (!entry.title) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <View style={s.entryRow}>
                <Text style={s.entryTitle}>
                  {entry.title}
                  {entry.issuer ? `, ${entry.issuer}` : ""}
                </Text>
                {entry.date && (
                  <Text style={s.entryDate}>{formatMonth(entry.date)}</Text>
                )}
              </View>
              {entry.description && (
                <View style={{ marginTop: 2 }}>
                  {getTextLines(entry.description).map(({ key, text }) => (
                    <Text key={key} style={s.bodyText}>
                      {text}
                    </Text>
                  ))}
                </View>
              )}
              {entry.url && (
                <Link src={ensureUrl(entry.url)} style={s.link}>
                  {entry.url}
                </Link>
              )}
            </View>
          );
          return acc;
        }, [])}
      </View>
    ),
    certificates: certificates.some((e) => e.name) && (
      <View key="certificates" style={s.sectionWrap}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionTitleText}>{data.certificatesTitle}</Text>
        </View>
        {certificates.reduce<React.ReactNode[]>((acc, entry) => {
          if (!entry.name) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <View style={s.entryRow}>
                <Text style={s.entryTitle}>
                  {entry.url ? (
                    <Link src={ensureUrl(entry.url)} style={s.inlineLink}>
                      {entry.name}
                    </Link>
                  ) : (
                    entry.name
                  )}
                  {entry.issuer ? `, ${entry.issuer}` : ""}
                </Text>
                {(entry.date || entry.expiryDate) && (
                  <Text style={s.entryDate}>
                    {[
                      entry.date ? formatMonth(entry.date) : "",
                      entry.expiryDate ? formatMonth(entry.expiryDate) : "",
                    ]
                      .filter(Boolean)
                      .join(" – ")}
                  </Text>
                )}
              </View>
              {entry.credentialId && (
                <Text style={s.entrySubtext}>
                  Credential ID: {entry.credentialId}
                </Text>
              )}
            </View>
          );
          return acc;
        }, [])}
      </View>
    ),
    languages: languages.some((e) => e.language) && (
      <View key="languages" style={s.sectionWrap}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionTitleText}>{data.languagesTitle}</Text>
        </View>
        {languages.reduce<React.ReactNode[]>((acc, entry) => {
          if (!entry.language) {
            return acc;
          }
          acc.push(
            <Text key={entry.id} style={[s.bodyText, s.langRow]}>
              <Text style={s.langLabel}>{entry.language}</Text>
              {entry.proficiency && (
                <Text style={s.langProficiency}>
                  {" "}
                  {"–"} {entry.proficiency}
                </Text>
              )}
            </Text>
          );
          return acc;
        }, [])}
      </View>
    ),
    projects: projects.length > 0 && (
      <View key="projects" style={s.sectionWrap}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionTitleText}>{data.projectsTitle}</Text>
        </View>
        {projects.map((entry) => (
          <View key={entry.id} style={s.entryWrap} wrap={false}>
            <View style={s.entryRow}>
              {entry.url ? (
                <Link
                  src={ensureUrl(entry.url)}
                  style={[s.entryTitle, s.inlineLink]}
                >
                  {entry.name}
                </Link>
              ) : (
                <Text style={s.entryTitle}>{entry.name}</Text>
              )}
            </View>
            {entry.description && (
              <View style={{ marginTop: 2 }}>
                {getTextLines(entry.description).map(({ key, text }) => (
                  <Text key={key} style={s.bodyText}>
                    {text}
                  </Text>
                ))}
              </View>
            )}
          </View>
        ))}
      </View>
    ),
    volunteer: volunteer.some((e) => e.organization || e.role) && (
      <View key="volunteer" style={s.sectionWrap}>
        <View style={s.sectionTitleWrap}>
          <Text style={s.sectionTitleText}>{data.volunteerTitle}</Text>
        </View>
        {volunteer.reduce<React.ReactNode[]>((acc, entry) => {
          if (!(entry.organization || entry.role)) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <View style={s.entryRow}>
                <Text style={s.entryTitle}>
                  {entry.role}
                  {entry.role && entry.organization ? ", " : ""}
                  {entry.organization}
                </Text>
                {(entry.startDate || entry.endDate || entry.current) && (
                  <Text style={s.entryDate}>
                    {[
                      formatMonth(entry.startDate),
                      formatOngoingEndDate(
                        entry.endDate,
                        entry.current,
                        formatMonth
                      ),
                    ]
                      .filter(Boolean)
                      .join(" – ")}
                  </Text>
                )}
              </View>
              {getDescriptionLines(entry.description).map(({ key, text }) => (
                <View key={key} style={s.bulletRow}>
                  <Text style={s.bulletDot}>{"•"}</Text>
                  <Text style={s.bulletText}>{text}</Text>
                </View>
              ))}
            </View>
          );
          return acc;
        }, [])}
      </View>
    ),
  };

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.headerWrap}>
          {personalInfo.fullName && (
            <Text style={s.name}>{personalInfo.fullName}</Text>
          )}
          {(personalInfo.email ||
            personalInfo.phone ||
            personalInfo.location ||
            personalInfo.linkedIn) && (
            <Text style={s.contact}>
              {[
                personalInfo.email,
                personalInfo.phone
                  ? formatPhoneDisplay(personalInfo.phone)
                  : "",
                personalInfo.location,
                personalInfo.linkedIn
                  ? `linkedin.com/in/${personalInfo.linkedIn}`
                  : "",
              ]
                .filter(Boolean)
                .join(" | ")}
            </Text>
          )}
        </View>
        {data.sectionOrder.map((sectionId) => sections[sectionId])}
      </Page>
    </Document>
  );
}
