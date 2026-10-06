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
import type { CVData } from "@/components/cv-form";
import { formatOngoingEndDate, getDescriptionLines } from "./template-utils";

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
    paddingTop: 32,
    paddingBottom: 32,
    paddingHorizontal: 40,
    fontSize: 9,
    color: "#404040",
    lineHeight: 1.5,
  },
  headerWrap: { alignItems: "center", marginBottom: 4 },
  name: {
    fontSize: 16,
    fontWeight: 700,
    color: "#171717",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  contact: { fontSize: 8, color: "#737373", marginTop: 6, textAlign: "center" },
  sectionWrap: { marginTop: 10 },
  sectionTitleWrap: {
    borderTopWidth: 1,
    borderTopColor: "#171717",
    borderBottomWidth: 1,
    borderBottomColor: "#171717",
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitleText: {
    fontSize: 8,
    fontWeight: 700,
    color: "#171717",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    textAlign: "center",
  },
  entryWrap: { marginTop: 6 },
  entryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  entryTitle: { fontSize: 10, fontWeight: "bold", color: "#404040", flex: 1 },
  entryDate: { fontSize: 8, color: "#404040", marginLeft: 8, flexShrink: 0 },
  bodyText: { fontSize: 9, color: "#404040", lineHeight: 1.6 },
  bulletRow: { flexDirection: "row", marginTop: 2, paddingLeft: 4 },
  bulletDot: { width: 8, fontSize: 9, color: "#404040" },
  bulletText: { flex: 1, fontSize: 9, color: "#404040", lineHeight: 1.6 },
  skillRow: { marginTop: 3 },
  skillLabel: { fontWeight: "bold", color: "#404040" },
  langRow: { marginTop: 3 },
  langProficiency: { color: "#666666" },
  link: {
    fontSize: 8,
    color: "#171717",
    textDecoration: "underline",
    marginTop: 2,
  },
  entrySubtext: { fontSize: 8, color: "#404040", marginTop: 1 },
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
                .join("  |  ")}
            </Text>
          )}
        </View>

        {/* Summary */}
        {summary && (
          <View style={s.sectionWrap}>
            <View style={s.sectionTitleWrap}>
              <Text style={s.sectionTitleText}>{data.summaryTitle}</Text>
            </View>
            <Text style={[s.bodyText, { marginTop: 6 }]}>{summary}</Text>
          </View>
        )}

        {/* Experience */}
        {experience.some((e) => e.company || e.title) && (
          <View style={s.sectionWrap}>
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
                        <Link src={ensureUrl(entry.url)}>{entry.company}</Link>
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
                    <Text style={s.entryDate}>
                      {[
                        WORK_TYPE_LABELS[entry.workType],
                        LOCATION_LABELS[entry.locationPolicy],
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  )}
                  {getDescriptionLines(entry.description).map(
                    ({ key, text }) => (
                      <View key={key} style={s.bulletRow}>
                        <Text style={s.bulletDot}>{"•"}</Text>
                        <Text style={s.bulletText}>{text}</Text>
                      </View>
                    )
                  )}
                </View>
              );
              return acc;
            }, [])}
          </View>
        )}

        {/* Education */}
        {education.some((e) => e.institution || e.degree) && (
          <View style={s.sectionWrap}>
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
                          entry.current
                            ? "Present"
                            : formatMonth(entry.endDate),
                        ]
                          .filter(Boolean)
                          .join(" – ")}
                      </Text>
                    )}
                  </View>
                  {(entry.gpa || entry.category) && (
                    <Text style={s.entryDate}>
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
        )}

        {/* Skills */}
        {skills.some((c) => c.items.length > 0) && (
          <View style={s.sectionWrap}>
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
        )}

        {/* Awards */}
        {awards.some((e) => e.title) && (
          <View style={s.sectionWrap}>
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
                    <Text style={[s.bodyText, { marginTop: 2 }]}>
                      {entry.description}
                    </Text>
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
        )}

        {/* Certificates */}
        {certificates.some((e) => e.name) && (
          <View style={s.sectionWrap}>
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
                        <Link src={ensureUrl(entry.url)}>{entry.name}</Link>
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
        )}

        {/* Languages */}
        {languages.some((e) => e.language) && (
          <View style={s.sectionWrap}>
            <View style={s.sectionTitleWrap}>
              <Text style={s.sectionTitleText}>{data.languagesTitle}</Text>
            </View>
            {languages.reduce<React.ReactNode[]>((acc, entry) => {
              if (!entry.language) {
                return acc;
              }
              acc.push(
                <Text key={entry.id} style={[s.bodyText, s.langRow]}>
                  <Text style={{ fontWeight: "bold" }}>{entry.language}</Text>
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
        )}

        {/* Projects */}
        {projects.length > 0 && (
          <View style={s.sectionWrap}>
            <View style={s.sectionTitleWrap}>
              <Text style={s.sectionTitleText}>{data.projectsTitle}</Text>
            </View>
            {projects.map((entry) => (
              <View key={entry.id} style={s.entryWrap} wrap={false}>
                <View style={s.entryRow}>
                  {entry.url ? (
                    <Link src={ensureUrl(entry.url)} style={s.entryTitle}>
                      {entry.name}
                    </Link>
                  ) : (
                    <Text style={s.entryTitle}>{entry.name}</Text>
                  )}
                </View>
                {entry.description && (
                  <Text style={[s.bodyText, { marginTop: 2 }]}>
                    {entry.description}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Volunteer */}
        {volunteer.some((e) => e.organization || e.role) && (
          <View style={s.sectionWrap}>
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
                  {getDescriptionLines(entry.description).map(
                    ({ key, text }) => (
                      <View key={key} style={s.bulletRow}>
                        <Text style={s.bulletDot}>{"•"}</Text>
                        <Text style={s.bulletText}>{text}</Text>
                      </View>
                    )
                  )}
                </View>
              );
              return acc;
            }, [])}
          </View>
        )}
      </Page>
    </Document>
  );
}
