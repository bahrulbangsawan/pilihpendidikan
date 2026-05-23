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
import type { CVData } from "@/components/cv-form";

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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerLeft: {},
  headerRight: { textAlign: "right" },
  name: {
    fontSize: 16,
    fontWeight: 700,
    color: "#171717",
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  jobTitle: { fontSize: 10, color: "#737373", marginTop: 4 },
  contactLine: { fontSize: 8, color: "#737373", marginTop: 1 },
  sectionWrap: { marginTop: 12 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: "#171717",
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  entryWrap: { marginTop: 8 },
  entryTitle: { fontSize: 10, fontWeight: "bold", color: "#171717" },
  entryDate: { fontSize: 8, color: "#737373", marginTop: 1 },
  bodyText: { fontSize: 9, color: "#404040", lineHeight: 1.6 },
  bulletRow: { flexDirection: "row", marginTop: 2, paddingLeft: 4 },
  bulletDot: { width: 8, fontSize: 9, color: "#404040" },
  bulletText: { flex: 1, fontSize: 9, color: "#404040", lineHeight: 1.6 },
  skillRow: { marginTop: 3 },
  skillLabel: { fontWeight: "bold", color: "#171717" },
  langRow: { marginTop: 3 },
  langProficiency: { color: "#737373" },
  link: {
    fontSize: 8,
    color: "#737373",
    textDecoration: "underline",
    marginTop: 2,
  },
  photo: { width: 48, height: 48, borderRadius: 24, objectFit: "cover" },
  headerLeftWithPhoto: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
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
        {/* Header — two-column: name+title left, contact right */}
        <View style={s.header}>
          <View
            style={
              personalInfo.usePhoto && personalInfo.photoUrl
                ? s.headerLeftWithPhoto
                : s.headerLeft
            }
          >
            {personalInfo.usePhoto && personalInfo.photoUrl && (
              <Image src={personalInfo.photoUrl} style={s.photo} />
            )}
            <View>
              {personalInfo.fullName && (
                <Text style={s.name}>{personalInfo.fullName}</Text>
              )}
              {personalInfo.jobTitle && (
                <Text style={s.jobTitle}>{personalInfo.jobTitle}</Text>
              )}
            </View>
          </View>
          {(personalInfo.email ||
            personalInfo.phone ||
            personalInfo.location ||
            personalInfo.linkedIn) && (
            <View style={s.headerRight}>
              {personalInfo.email && (
                <Text style={s.contactLine}>{personalInfo.email}</Text>
              )}
              {personalInfo.phone && (
                <Text style={s.contactLine}>
                  {formatPhoneDisplay(personalInfo.phone)}
                </Text>
              )}
              {personalInfo.location && (
                <Text style={s.contactLine}>{personalInfo.location}</Text>
              )}
              {personalInfo.linkedIn && (
                <Text style={s.contactLine}>
                  linkedin.com/in/{personalInfo.linkedIn}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Summary */}
        {summary && (
          <View style={s.sectionWrap}>
            <Text style={s.sectionTitle}>{data.summaryTitle}</Text>
            <Text style={[s.bodyText, { marginTop: 4 }]}>{summary}</Text>
          </View>
        )}

        {/* Experience */}
        {experience.some((e) => e.company || e.title) && (
          <View style={s.sectionWrap}>
            <Text style={s.sectionTitle}>{data.experienceTitle}</Text>
            {experience
              .filter((e) => e.company || e.title)
              .map((entry) => (
                <View key={entry.id} style={s.entryWrap} wrap={false}>
                  <Text style={s.entryTitle}>
                    {entry.title}
                    {entry.title && entry.company ? " at " : ""}
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
                        entry.current
                          ? "Present"
                          : entry.endDate
                            ? formatMonth(entry.endDate)
                            : "Present",
                      ]
                        .filter(Boolean)
                        .join(" \u2013 ")}
                    </Text>
                  )}
                  {(entry.workType || entry.locationPolicy) && (
                    <Text style={s.entryDate}>
                      {[
                        WORK_TYPE_LABELS[entry.workType],
                        LOCATION_LABELS[entry.locationPolicy],
                      ]
                        .filter(Boolean)
                        .join(" \u00b7 ")}
                    </Text>
                  )}
                  {entry.description &&
                    entry.description
                      .split("\n")
                      .filter((l) => l.trim())
                      .map((line, i) => (
                        <View key={i} style={s.bulletRow}>
                          <Text style={s.bulletDot}>{"\u2022"}</Text>
                          <Text style={s.bulletText}>{line.trim()}</Text>
                        </View>
                      ))}
                </View>
              ))}
          </View>
        )}

        {/* Education */}
        {education.some((e) => e.institution || e.degree) && (
          <View style={s.sectionWrap}>
            <Text style={s.sectionTitle}>{data.educationTitle}</Text>
            {education
              .filter((e) => e.institution || e.degree)
              .map((entry) => (
                <View key={entry.id} style={s.entryWrap} wrap={false}>
                  <Text style={s.entryTitle}>
                    {[entry.degree, entry.institution]
                      .filter(Boolean)
                      .join(" \u2013 ")}
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
                          entry.current
                            ? "Present"
                            : formatMonth(entry.endDate),
                        ]
                          .filter(Boolean)
                          .join(" \u2013 "),
                        entry.category
                          ? EDUCATION_CATEGORY_LABELS[entry.category]
                          : "",
                        entry.gpa ? `GPA: ${entry.gpa}` : "",
                      ]
                        .filter(Boolean)
                        .join(" \u00b7 ")}
                    </Text>
                  )}
                </View>
              ))}
          </View>
        )}

        {/* Skills */}
        {skills.some((c) => c.items.length > 0) && (
          <View style={s.sectionWrap}>
            <Text style={s.sectionTitle}>{data.skillsTitle}</Text>
            {skills
              .filter((c) => c.items.length > 0)
              .map((cat) => (
                <Text key={cat.id} style={[s.bodyText, s.skillRow]}>
                  {cat.name && <Text style={s.skillLabel}>{cat.name}: </Text>}
                  {cat.items.join(", ")}.
                </Text>
              ))}
          </View>
        )}

        {/* Awards */}
        {awards.some((e) => e.title) && (
          <View style={s.sectionWrap}>
            <Text style={s.sectionTitle}>{data.awardsTitle}</Text>
            {awards
              .filter((e) => e.title)
              .map((entry) => (
                <View key={entry.id} style={s.entryWrap} wrap={false}>
                  <Text style={s.entryTitle}>
                    {[entry.title, entry.issuer]
                      .filter(Boolean)
                      .join(" \u2013 ")}
                  </Text>
                  {entry.date && (
                    <Text style={s.entryDate}>{formatMonth(entry.date)}</Text>
                  )}
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
              ))}
          </View>
        )}

        {/* Certificates */}
        {certificates.some((e) => e.name) && (
          <View style={s.sectionWrap}>
            <Text style={s.sectionTitle}>{data.certificatesTitle}</Text>
            {certificates
              .filter((e) => e.name)
              .map((entry) => (
                <View key={entry.id} style={s.entryWrap} wrap={false}>
                  <Text style={s.entryTitle}>
                    {entry.url ? (
                      <Link src={ensureUrl(entry.url)}>{entry.name}</Link>
                    ) : (
                      entry.name
                    )}
                    {entry.name && entry.issuer ? " \u2013 " : ""}
                    {entry.issuer}
                  </Text>
                  <Text style={s.entryDate}>
                    {[
                      [
                        entry.date ? formatMonth(entry.date) : "",
                        entry.expiryDate ? formatMonth(entry.expiryDate) : "",
                      ]
                        .filter(Boolean)
                        .join(" \u2013 "),
                      entry.credentialId ? `ID: ${entry.credentialId}` : "",
                    ]
                      .filter(Boolean)
                      .join(" \u00b7 ")}
                  </Text>
                </View>
              ))}
          </View>
        )}

        {/* Languages */}
        {languages.some((e) => e.language) && (
          <View style={s.sectionWrap}>
            <Text style={s.sectionTitle}>{data.languagesTitle}</Text>
            {languages
              .filter((e) => e.language)
              .map((entry) => (
                <Text key={entry.id} style={[s.bodyText, s.langRow]}>
                  {entry.language}
                  {entry.proficiency && (
                    <Text style={s.langProficiency}>
                      {" "}
                      {"\u2013"} {entry.proficiency}
                    </Text>
                  )}
                </Text>
              ))}
          </View>
        )}

        {/* Projects */}
        {projects.length > 0 && (
          <View style={s.sectionWrap}>
            <Text style={s.sectionTitle}>{data.projectsTitle}</Text>
            {projects.map((entry) => (
              <View key={entry.id} style={s.entryWrap} wrap={false}>
                {entry.url ? (
                  <Link src={ensureUrl(entry.url)} style={s.entryTitle}>
                    {entry.name}
                  </Link>
                ) : (
                  <Text style={s.entryTitle}>{entry.name}</Text>
                )}
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
            <Text style={s.sectionTitle}>{data.volunteerTitle}</Text>
            {volunteer
              .filter((e) => e.organization || e.role)
              .map((entry) => (
                <View key={entry.id} style={s.entryWrap} wrap={false}>
                  <Text style={s.entryTitle}>
                    {[entry.role, entry.organization]
                      .filter(Boolean)
                      .join(" at ")}
                  </Text>
                  {(entry.startDate || entry.endDate || entry.current) && (
                    <Text style={s.entryDate}>
                      {[
                        formatMonth(entry.startDate),
                        entry.current
                          ? "Present"
                          : entry.endDate
                            ? formatMonth(entry.endDate)
                            : "Present",
                      ]
                        .filter(Boolean)
                        .join(" \u2013 ")}
                    </Text>
                  )}
                  {entry.description &&
                    entry.description
                      .split("\n")
                      .filter((l) => l.trim())
                      .map((line, i) => (
                        <View key={i} style={s.bulletRow}>
                          <Text style={s.bulletDot}>{"\u2022"}</Text>
                          <Text style={s.bulletText}>{line.trim()}</Text>
                        </View>
                      ))}
                </View>
              ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
