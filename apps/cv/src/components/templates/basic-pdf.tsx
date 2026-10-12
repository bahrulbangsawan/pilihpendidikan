// Static JSX primitives are loaded only behind cv-generator's compile-time SSR
// guard; this browser PDF template is not part of the Workers module graph.
import {
  Document,
  Image,
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
// the photo frame #dadde2, links cobalt #1348dc. Weight 700 for the name,
// 600 for headings and labels; copy set as written, no letter-spacing. The
// preview (basic-preview.tsx) uses the matching token classes.
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
  name: {
    fontSize: 16,
    fontWeight: 700,
    color: "#000000",
    marginBottom: 2,
  },
  jobTitle: { fontSize: 10, color: "#5a6170", marginTop: 4 },
  contact: { fontSize: 8, color: "#5a6170", marginTop: 6 },
  sectionWrap: { marginTop: 16 },
  sectionTitle: {
    fontSize: 8,
    fontWeight: 600,
    color: "#000000",
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#cbcfd4",
  },
  entryWrap: { marginTop: 10 },
  entryTitle: { fontSize: 10, fontWeight: 600, color: "#000000" },
  entryDate: { fontSize: 8, color: "#5a6170", marginTop: 1 },
  bodyText: { fontSize: 9, color: "#393d45", lineHeight: 1.6 },
  bulletRow: { flexDirection: "row", marginTop: 2, paddingLeft: 4 },
  bulletDot: { width: 8, fontSize: 9, color: "#393d45" },
  bulletText: { flex: 1, fontSize: 9, color: "#393d45", lineHeight: 1.6 },
  skillRow: { marginTop: 3 },
  skillLabel: { fontWeight: 600, color: "#000000" },
  langRow: { marginTop: 3 },
  langProficiency: { color: "#5a6170" },
  // A link inside a heading: cobalt, underlined (react-pdf's link default).
  inlineLink: { color: "#1348dc" },
  link: {
    fontSize: 8,
    color: "#1348dc",
    textDecoration: "underline",
    marginTop: 2,
  },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  // A 2pt-radius square in a 1pt frame. react-pdf paints an Image over its
  // own border, so the frame is a View and the image sits inside it.
  photoFrame: {
    width: 48,
    height: 48,
    borderWidth: 1,
    borderColor: "#dadde2",
    borderRadius: 2,
  },
  photo: { width: 46, height: 46, borderRadius: 1, objectFit: "cover" },
  headerContent: { flex: 1 },
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
        <Text style={s.sectionTitle}>{data.summaryTitle}</Text>
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
        <Text style={s.sectionTitle}>{data.experienceTitle}</Text>
        {experience.reduce<React.ReactNode[]>((acc, entry) => {
          if (!(entry.company || entry.title)) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <Text style={s.entryTitle}>
                {entry.title}
                {entry.title && entry.company ? " at " : ""}
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
              {(entry.workType || entry.locationPolicy) && (
                <Text style={s.entryDate}>
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
        <Text style={s.sectionTitle}>{data.educationTitle}</Text>
        {education.reduce<React.ReactNode[]>((acc, entry) => {
          if (!(entry.institution || entry.degree)) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <Text style={s.entryTitle}>
                {[entry.degree, entry.institution].filter(Boolean).join(" – ")}
              </Text>
              {(entry.startDate ||
                entry.endDate ||
                entry.current ||
                entry.gpa ||
                entry.category) && (
                <Text style={s.entryDate}>
                  {[
                    [
                      formatMonth(entry.startDate),
                      entry.current ? "Present" : formatMonth(entry.endDate),
                    ]
                      .filter(Boolean)
                      .join(" – "),
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
        <Text style={s.sectionTitle}>{data.skillsTitle}</Text>
        {skills.reduce<React.ReactNode[]>((acc, cat) => {
          if (cat.items.length === 0) {
            return acc;
          }
          acc.push(
            <Text key={cat.id} style={[s.bodyText, s.skillRow]}>
              {cat.name && <Text style={s.skillLabel}>{cat.name}: </Text>}
              {cat.items.join(", ")}.
            </Text>
          );
          return acc;
        }, [])}
      </View>
    ),
    awards: awards.some((e) => e.title) && (
      <View key="awards" style={s.sectionWrap}>
        <Text style={s.sectionTitle}>{data.awardsTitle}</Text>
        {awards.reduce<React.ReactNode[]>((acc, entry) => {
          if (!entry.title) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <Text style={s.entryTitle}>
                {[entry.title, entry.issuer].filter(Boolean).join(" – ")}
              </Text>
              {entry.date && (
                <Text style={s.entryDate}>{formatMonth(entry.date)}</Text>
              )}
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
        <Text style={s.sectionTitle}>{data.certificatesTitle}</Text>
        {certificates.reduce<React.ReactNode[]>((acc, entry) => {
          if (!entry.name) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <Text style={s.entryTitle}>
                {entry.url ? (
                  <Link src={ensureUrl(entry.url)} style={s.inlineLink}>
                    {entry.name}
                  </Link>
                ) : (
                  entry.name
                )}
                {entry.name && entry.issuer ? " – " : ""}
                {entry.issuer}
              </Text>
              <Text style={s.entryDate}>
                {[
                  [
                    entry.date ? formatMonth(entry.date) : "",
                    entry.expiryDate ? formatMonth(entry.expiryDate) : "",
                  ]
                    .filter(Boolean)
                    .join(" – "),
                  entry.credentialId ? `ID: ${entry.credentialId}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          );
          return acc;
        }, [])}
      </View>
    ),
    languages: languages.some((e) => e.language) && (
      <View key="languages" style={s.sectionWrap}>
        <Text style={s.sectionTitle}>{data.languagesTitle}</Text>
        {languages.reduce<React.ReactNode[]>((acc, entry) => {
          if (!entry.language) {
            return acc;
          }
          acc.push(
            <Text key={entry.id} style={[s.bodyText, s.langRow]}>
              {entry.language}
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
        <Text style={s.sectionTitle}>{data.projectsTitle}</Text>
        {projects.map((entry) => (
          <View key={entry.id} style={s.entryWrap} wrap={false}>
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
        <Text style={s.sectionTitle}>{data.volunteerTitle}</Text>
        {volunteer.reduce<React.ReactNode[]>((acc, entry) => {
          if (!(entry.organization || entry.role)) {
            return acc;
          }
          acc.push(
            <View key={entry.id} style={s.entryWrap} wrap={false}>
              <Text style={s.entryTitle}>
                {[entry.role, entry.organization].filter(Boolean).join(" at ")}
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
        <View style={s.headerRow}>
          {personalInfo.usePhoto && personalInfo.photoUrl && (
            <View style={s.photoFrame}>
              <Image src={personalInfo.photoUrl} style={s.photo} />
            </View>
          )}
          <View style={s.headerContent}>
            {personalInfo.fullName && (
              <Text style={s.name}>{personalInfo.fullName}</Text>
            )}
            {personalInfo.jobTitle && (
              <Text style={s.jobTitle}>{personalInfo.jobTitle}</Text>
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
                  .join(" · ")}
              </Text>
            )}
          </View>
        </View>
        {data.sectionOrder.map((sectionId) => sections[sectionId])}
      </Page>
    </Document>
  );
}
