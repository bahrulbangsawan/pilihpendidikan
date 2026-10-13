import type { CVData } from "@pilihpendidikan/cv-engine/types";
import {
  formatOngoingEndDate,
  getDescriptionLines,
  hasPreviewSectionContent,
} from "@pilihpendidikan/cv-engine/template-utils";
import { ensureUrl, formatPhoneDisplay } from "@rulisme/ui/lib/utils";

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

function ExperienceEntry({ entry }: { entry: CVData["experience"][number] }) {
  if (!(entry.company || entry.title)) {
    return null;
  }

  const hasDates = entry.startDate || entry.endDate || entry.current;

  return (
    <section className="mt-4">
      {entry.title && (
        <h3 className="font-semibold text-foreground text-sm">{entry.title}</h3>
      )}
      <p className="text-muted-foreground text-xs">
        {entry.company &&
          (entry.url ? (
            <a
              className="text-primary underline"
              href={ensureUrl(entry.url)}
              rel="noopener noreferrer"
              target="_blank"
            >
              {entry.company}
            </a>
          ) : (
            entry.company
          ))}
        {entry.company && hasDates ? " | " : ""}
        {hasDates &&
          [
            formatMonth(entry.startDate),
            formatOngoingEndDate(entry.endDate, entry.current, formatMonth),
          ]
            .filter(Boolean)
            .join(" – ")}
      </p>
      {(entry.workType || entry.locationPolicy) && (
        <p className="mt-1 text-muted-foreground text-xs">
          {[
            WORK_TYPE_LABELS[entry.workType],
            LOCATION_LABELS[entry.locationPolicy],
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {entry.description && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
          {getDescriptionLines(entry.description).map((line) => (
            <li className="text-ink text-xs leading-relaxed" key={line.key}>
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EducationEntry({ entry }: { entry: CVData["education"][number] }) {
  if (!(entry.institution || entry.degree)) {
    return null;
  }

  const hasDates = entry.startDate || entry.endDate || entry.current;
  const dates = hasDates
    ? [
        formatMonth(entry.startDate),
        entry.current ? "Present" : formatMonth(entry.endDate),
      ]
        .filter(Boolean)
        .join(" – ")
    : "";

  return (
    <section className="mt-4">
      {entry.degree && (
        <h3 className="font-semibold text-foreground text-sm">
          {entry.degree}
        </h3>
      )}
      <p className="text-muted-foreground text-xs">
        {[
          entry.institution,
          dates,
          entry.category ? EDUCATION_CATEGORY_LABELS[entry.category] : "",
          entry.gpa ? `GPA: ${entry.gpa}` : "",
        ]
          .filter(Boolean)
          .join(" | ")}
      </p>
    </section>
  );
}

function CertificateEntry({
  entry,
}: {
  entry: CVData["certificates"][number];
}) {
  if (!entry.name) {
    return null;
  }

  return (
    <section className="mt-4">
      <h3 className="font-semibold text-foreground text-sm">
        {entry.url ? (
          <a
            className="text-primary underline"
            href={ensureUrl(entry.url)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {entry.name}
          </a>
        ) : (
          entry.name
        )}
      </h3>
      <p className="text-muted-foreground text-xs">
        {[
          entry.issuer,
          [
            entry.date ? formatMonth(entry.date) : "",
            entry.expiryDate ? formatMonth(entry.expiryDate) : "",
          ]
            .filter(Boolean)
            .join(" – "),
          entry.credentialId ? `ID: ${entry.credentialId}` : "",
        ]
          .filter(Boolean)
          .join(" | ")}
      </p>
    </section>
  );
}

function VolunteerEntry({ entry }: { entry: CVData["volunteer"][number] }) {
  if (!(entry.organization || entry.role)) {
    return null;
  }

  const hasDates = entry.startDate || entry.endDate || entry.current;
  const dates = hasDates
    ? [
        formatMonth(entry.startDate),
        formatOngoingEndDate(entry.endDate, entry.current, formatMonth),
      ]
        .filter(Boolean)
        .join(" – ")
    : "";

  return (
    <section className="mt-4">
      {entry.role && (
        <h3 className="font-semibold text-foreground text-sm">{entry.role}</h3>
      )}
      <p className="text-muted-foreground text-xs">
        {[entry.organization, dates].filter(Boolean).join(" | ")}
      </p>
      {entry.description && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
          {getDescriptionLines(entry.description).map((line) => (
            <li className="text-ink text-xs leading-relaxed" key={line.key}>
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SimplePreview({ data }: { data: CVData }) {
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

  const hasContent =
    personalInfo.fullName ||
    summary ||
    experience.some((e) => e.company || e.title) ||
    education.some((e) => e.institution || e.degree) ||
    skills.some((c) => c.items.length > 0) ||
    awards.some((e) => e.title) ||
    certificates.some((e) => e.name) ||
    languages.some((e) => e.language) ||
    volunteer.some((e) => e.organization || e.role);

  if (!hasContent) {
    return (
      <article className="cv-page mx-auto" id="cv-content">
        <p className="text-center text-muted-foreground text-sm">
          Fill in the form to see your CV preview.
        </p>
      </article>
    );
  }

  return (
    <article className="cv-page mx-auto" id="cv-content">
      {/* Header — centered */}
      <header className="text-center">
        {personalInfo.fullName && (
          <h1 className="font-bold text-foreground text-xl">
            {personalInfo.fullName}
          </h1>
        )}
        {personalInfo.jobTitle && (
          <p className="mt-0.5 text-muted-foreground text-sm">
            {personalInfo.jobTitle}
          </p>
        )}
        {(personalInfo.email ||
          personalInfo.phone ||
          personalInfo.location ||
          personalInfo.linkedIn) && (
          <p className="mt-2 text-muted-foreground text-xs">
            {[
              personalInfo.email,
              personalInfo.phone ? formatPhoneDisplay(personalInfo.phone) : "",
              personalInfo.location,
              personalInfo.linkedIn
                ? `linkedin.com/in/${personalInfo.linkedIn}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </header>

      {data.sectionOrder.map((sectionId) => {
        if (!hasPreviewSectionContent(data, sectionId)) {
          return null;
        }

        switch (sectionId) {
          case "summary":
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-line border-b pb-1 font-semibold text-foreground text-sm">
                  {data.summaryTitle}
                </h2>
                <p className="mt-2 whitespace-pre-line text-ink text-xs leading-relaxed">
                  {summary}
                </p>
              </section>
            );
          case "experience":
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-line border-b pb-1 font-semibold text-foreground text-sm">
                  {data.experienceTitle}
                </h2>
                {experience.map((entry) => (
                  <ExperienceEntry entry={entry} key={entry.id} />
                ))}
              </section>
            );
          case "education":
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-line border-b pb-1 font-semibold text-foreground text-sm">
                  {data.educationTitle}
                </h2>
                {education.map((entry) => (
                  <EducationEntry entry={entry} key={entry.id} />
                ))}
              </section>
            );
          case "skills":
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-line border-b pb-1 font-semibold text-foreground text-sm">
                  {data.skillsTitle}
                </h2>
                <div className="mt-2 space-y-1">
                  {skills.reduce<React.ReactNode[]>((acc, category) => {
                    if (category.items.length === 0) {
                      return acc;
                    }
                    acc.push(
                      <p className="text-ink text-xs" key={category.id}>
                        {category.name && (
                          <span className="font-semibold text-foreground">
                            {category.name}:{" "}
                          </span>
                        )}
                        {category.items.join(", ")}.
                      </p>
                    );
                    return acc;
                  }, [])}
                </div>
              </section>
            );
          case "awards":
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-line border-b pb-1 font-semibold text-foreground text-sm">
                  {data.awardsTitle}
                </h2>
                {awards.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!entry.title) {
                    return acc;
                  }
                  acc.push(
                    <section className="mt-4" key={entry.id}>
                      <h3 className="font-semibold text-foreground text-sm">
                        {entry.title}
                      </h3>
                      <p className="text-muted-foreground text-xs">
                        {[
                          entry.issuer,
                          entry.date ? formatMonth(entry.date) : "",
                        ]
                          .filter(Boolean)
                          .join(" | ")}
                      </p>
                      {entry.description && (
                        <p className="mt-1 whitespace-pre-line text-ink text-xs leading-relaxed">
                          {entry.description}
                        </p>
                      )}
                      {entry.url && (
                        <a
                          className="mt-1 block text-primary text-xs underline"
                          href={ensureUrl(entry.url)}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {entry.url}
                        </a>
                      )}
                    </section>
                  );
                  return acc;
                }, [])}
              </section>
            );
          case "certificates":
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-line border-b pb-1 font-semibold text-foreground text-sm">
                  {data.certificatesTitle}
                </h2>
                {certificates.map((entry) => (
                  <CertificateEntry entry={entry} key={entry.id} />
                ))}
              </section>
            );
          case "languages":
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-line border-b pb-1 font-semibold text-foreground text-sm">
                  {data.languagesTitle}
                </h2>
                <ul className="mt-2 space-y-1">
                  {languages.reduce<React.ReactNode[]>((acc, entry) => {
                    if (!entry.language) {
                      return acc;
                    }
                    acc.push(
                      <li className="text-ink text-xs" key={entry.id}>
                        {entry.language}
                        {entry.proficiency && (
                          <span className="text-muted-foreground">
                            {" "}
                            {"–"} {entry.proficiency}
                          </span>
                        )}
                      </li>
                    );
                    return acc;
                  }, [])}
                </ul>
              </section>
            );
          case "projects":
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-line border-b pb-1 font-semibold text-foreground text-sm">
                  {data.projectsTitle}
                </h2>
                {projects.map((entry) => (
                  <section className="mt-4" key={entry.id}>
                    <h3 className="font-semibold text-foreground text-sm">
                      {entry.url ? (
                        <a
                          className="text-primary underline"
                          href={ensureUrl(entry.url)}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {entry.name}
                        </a>
                      ) : (
                        entry.name
                      )}
                    </h3>
                    {entry.description && (
                      <p className="mt-1 whitespace-pre-line text-ink text-xs leading-relaxed">
                        {entry.description}
                      </p>
                    )}
                  </section>
                ))}
              </section>
            );
          case "volunteer":
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-line border-b pb-1 font-semibold text-foreground text-sm">
                  {data.volunteerTitle}
                </h2>
                {volunteer.map((entry) => (
                  <VolunteerEntry entry={entry} key={entry.id} />
                ))}
              </section>
            );
          default:
            return null;
        }
      })}
    </article>
  );
}
