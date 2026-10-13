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

  return (
    <section className="mt-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-foreground text-sm">
          {entry.title}
          {entry.title && entry.company ? ", " : ""}
          {entry.url ? (
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
          )}
        </h3>
        {(entry.startDate || entry.endDate || entry.current) && (
          <span className="ml-4 shrink-0 text-muted-foreground text-xs">
            {[
              formatMonth(entry.startDate),
              formatOngoingEndDate(entry.endDate, entry.current, formatMonth),
            ]
              .filter(Boolean)
              .join(" – ")}
          </span>
        )}
      </div>
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
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
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

  return (
    <section className="mt-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-foreground text-sm">
          {entry.degree}
          {entry.degree && entry.institution ? ", " : ""}
          {entry.institution}
        </h3>
        {(entry.startDate || entry.endDate || entry.current) && (
          <span className="ml-4 shrink-0 text-muted-foreground text-xs">
            {[
              formatMonth(entry.startDate),
              entry.current ? "Present" : formatMonth(entry.endDate),
            ]
              .filter(Boolean)
              .join(" – ")}
          </span>
        )}
      </div>
      {(entry.gpa || entry.category) && (
        <p className="text-muted-foreground text-xs">
          {[
            entry.category ? EDUCATION_CATEGORY_LABELS[entry.category] : "",
            entry.gpa ? `GPA: ${entry.gpa}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
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
    <section className="mt-3">
      <div className="flex items-baseline justify-between">
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
          {entry.issuer ? `, ${entry.issuer}` : ""}
        </h3>
        {(entry.date || entry.expiryDate) && (
          <span className="ml-4 shrink-0 text-muted-foreground text-xs">
            {[
              entry.date ? formatMonth(entry.date) : "",
              entry.expiryDate ? formatMonth(entry.expiryDate) : "",
            ]
              .filter(Boolean)
              .join(" – ")}
          </span>
        )}
      </div>
      {entry.credentialId && (
        <p className="text-muted-foreground text-xs">
          Credential ID: {entry.credentialId}
        </p>
      )}
    </section>
  );
}

function VolunteerEntry({ entry }: { entry: CVData["volunteer"][number] }) {
  if (!(entry.organization || entry.role)) {
    return null;
  }

  return (
    <section className="mt-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-foreground text-sm">
          {entry.role}
          {entry.role && entry.organization ? ", " : ""}
          {entry.organization}
        </h3>
        {(entry.startDate || entry.endDate || entry.current) && (
          <span className="ml-4 shrink-0 text-muted-foreground text-xs">
            {[
              formatMonth(entry.startDate),
              formatOngoingEndDate(entry.endDate, entry.current, formatMonth),
            ]
              .filter(Boolean)
              .join(" – ")}
          </span>
        )}
      </div>
      {entry.description && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
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

export function HarvardPreview({ data }: { data: CVData }) {
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
          Fill in the form to preview your Harvard CV.
        </p>
      </article>
    );
  }

  return (
    <article className="cv-page mx-auto" id="cv-content">
      {/* Header */}
      <header className="mb-3 text-center">
        {personalInfo.fullName && (
          <h1 className="font-bold text-foreground text-xl">
            {personalInfo.fullName}
          </h1>
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
              .join(" | ")}
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
              <section className="mt-3" key={sectionId}>
                <h2 className="border-line border-t border-b py-1 text-center font-semibold text-foreground text-xs">
                  {data.summaryTitle}
                </h2>
                <p className="mt-2 whitespace-pre-line text-ink text-xs leading-relaxed">
                  {summary}
                </p>
              </section>
            );
          case "experience":
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-line border-t border-b py-1 text-center font-semibold text-foreground text-xs">
                  {data.experienceTitle}
                </h2>
                {experience.map((entry) => (
                  <ExperienceEntry entry={entry} key={entry.id} />
                ))}
              </section>
            );
          case "education":
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-line border-t border-b py-1 text-center font-semibold text-foreground text-xs">
                  {data.educationTitle}
                </h2>
                {education.map((entry) => (
                  <EducationEntry entry={entry} key={entry.id} />
                ))}
              </section>
            );
          case "skills":
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-line border-t border-b py-1 text-center font-semibold text-foreground text-xs">
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
                        {category.items.join(", ")}
                      </p>
                    );
                    return acc;
                  }, [])}
                </div>
              </section>
            );
          case "awards":
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-line border-t border-b py-1 text-center font-semibold text-foreground text-xs">
                  {data.awardsTitle}
                </h2>
                {awards.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!entry.title) {
                    return acc;
                  }
                  acc.push(
                    <section className="mt-3" key={entry.id}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="font-semibold text-foreground text-sm">
                          {entry.title}
                          {entry.issuer ? `, ${entry.issuer}` : ""}
                        </h3>
                        {entry.date && (
                          <span className="ml-4 shrink-0 text-muted-foreground text-xs">
                            {formatMonth(entry.date)}
                          </span>
                        )}
                      </div>
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
              <section className="mt-3" key={sectionId}>
                <h2 className="border-line border-t border-b py-1 text-center font-semibold text-foreground text-xs">
                  {data.certificatesTitle}
                </h2>
                {certificates.map((entry) => (
                  <CertificateEntry entry={entry} key={entry.id} />
                ))}
              </section>
            );
          case "languages":
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-line border-t border-b py-1 text-center font-semibold text-foreground text-xs">
                  {data.languagesTitle}
                </h2>
                <div className="mt-2 space-y-1">
                  {languages.reduce<React.ReactNode[]>((acc, entry) => {
                    if (!entry.language) {
                      return acc;
                    }
                    acc.push(
                      <p className="text-ink text-xs" key={entry.id}>
                        <span className="font-semibold text-foreground">
                          {entry.language}
                        </span>
                        {entry.proficiency && (
                          <span className="text-muted-foreground">
                            {" "}
                            {"–"} {entry.proficiency}
                          </span>
                        )}
                      </p>
                    );
                    return acc;
                  }, [])}
                </div>
              </section>
            );
          case "projects":
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-line border-t border-b py-1 text-center font-semibold text-foreground text-xs">
                  {data.projectsTitle}
                </h2>
                {projects.map((entry) => (
                  <section className="mt-3" key={entry.id}>
                    <div className="flex items-baseline justify-between">
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
                    </div>
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
              <section className="mt-3" key={sectionId}>
                <h2 className="border-line border-t border-b py-1 text-center font-semibold text-foreground text-xs">
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
