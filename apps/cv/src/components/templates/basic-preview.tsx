import { ensureUrl, formatPhoneDisplay } from "@rulisme/ui/lib/utils";
import type { CVData } from "@/components/cv-form";

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

export function BasicPreview({ data }: { data: CVData }) {
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
    <article className="cv-page mx-auto" id="cv-content">
      {/* Header */}
      <header className="flex items-start gap-4">
        {personalInfo.usePhoto && personalInfo.photoUrl && (
          <img
            alt=""
            className="size-16 shrink-0 rounded-full border border-neutral-200 object-cover"
            src={personalInfo.photoUrl}
          />
        )}
        <div className="min-w-0 flex-1">
          {personalInfo.fullName && (
            <h1 className="font-semibold text-neutral-900 text-xl tracking-tight">
              {personalInfo.fullName}
            </h1>
          )}
          {personalInfo.jobTitle && (
            <p className="mt-0.5 text-neutral-500 text-sm">
              {personalInfo.jobTitle}
            </p>
          )}
          {(personalInfo.email ||
            personalInfo.phone ||
            personalInfo.location ||
            personalInfo.linkedIn) && (
            <p className="mt-2 text-neutral-500 text-xs">
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
            </p>
          )}
        </div>
      </header>

      {data.sectionOrder.map((sectionId) => {
        switch (sectionId) {
          case "summary":
            if (!summary) {
              return null;
            }
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-xs uppercase tracking-wider">
                  {data.summaryTitle}
                </h2>
                <p className="mt-2 text-neutral-700 text-xs leading-relaxed">
                  {summary}
                </p>
              </section>
            );
          case "experience":
            if (!experience.some((e) => e.company || e.title)) {
              return null;
            }
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-xs uppercase tracking-wider">
                  {data.experienceTitle}
                </h2>
                {experience.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!(entry.company || entry.title)) {
                    return acc;
                  }
                  acc.push(
                    <section className="mt-4" key={entry.id}>
                      <h3 className="font-semibold text-neutral-900 text-sm">
                        {entry.title}
                        {entry.title && entry.company ? " at " : ""}
                        {entry.url ? (
                          <a
                            className="underline"
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
                        <p className="text-neutral-500 text-xs">
                          {[
                            formatMonth(entry.startDate),
                            entry.current
                              ? "Present"
                              : entry.endDate
                                ? formatMonth(entry.endDate)
                                : "Present",
                          ]
                            .filter(Boolean)
                            .join(" – ")}
                        </p>
                      )}
                      {(entry.workType || entry.locationPolicy) && (
                        <p className="mt-1 text-neutral-500 text-xs">
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
                          {/* index key is safe: static newline-split, never reordered */}
                          {entry.description
                            .split("\n")
                            .filter((l) => l.trim())
                            .map((line, i) => (
                              <li
                                className="text-neutral-700 text-xs leading-relaxed"
                                key={i}
                              >
                                {line.trim()}
                              </li>
                            ))}
                        </ul>
                      )}
                    </section>
                  );
                  return acc;
                }, [])}
              </section>
            );
          case "education":
            if (!education.some((e) => e.institution || e.degree)) {
              return null;
            }
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-xs uppercase tracking-wider">
                  {data.educationTitle}
                </h2>
                {education.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!(entry.institution || entry.degree)) {
                    return acc;
                  }
                  acc.push(
                    <section className="mt-4" key={entry.id}>
                      <h3 className="font-semibold text-neutral-900 text-sm">
                        {[entry.degree, entry.institution]
                          .filter(Boolean)
                          .join(" – ")}
                      </h3>
                      {(entry.startDate ||
                        entry.endDate ||
                        entry.current ||
                        entry.gpa ||
                        entry.category) && (
                        <p className="text-neutral-500 text-xs">
                          {[
                            [
                              formatMonth(entry.startDate),
                              entry.current
                                ? "Present"
                                : formatMonth(entry.endDate),
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
                        </p>
                      )}
                    </section>
                  );
                  return acc;
                }, [])}
              </section>
            );
          case "skills":
            if (!skills.some((c) => c.items.length > 0)) {
              return null;
            }
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-xs uppercase tracking-wider">
                  {data.skillsTitle}
                </h2>
                <div className="mt-2 space-y-1">
                  {skills.reduce<React.ReactNode[]>((acc, category) => {
                    if (category.items.length === 0) {
                      return acc;
                    }
                    acc.push(
                      <p className="text-neutral-700 text-xs" key={category.id}>
                        {category.name && (
                          <span className="font-semibold text-neutral-900">
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
            if (!awards.some((e) => e.title)) {
              return null;
            }
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-xs uppercase tracking-wider">
                  {data.awardsTitle}
                </h2>
                {awards.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!entry.title) {
                    return acc;
                  }
                  acc.push(
                    <section className="mt-4" key={entry.id}>
                      <h3 className="font-semibold text-neutral-900 text-sm">
                        {[entry.title, entry.issuer]
                          .filter(Boolean)
                          .join(" – ")}
                      </h3>
                      {entry.date && (
                        <p className="text-neutral-500 text-xs">
                          {formatMonth(entry.date)}
                        </p>
                      )}
                      {entry.description && (
                        <p className="mt-1 text-neutral-700 text-xs leading-relaxed">
                          {entry.description}
                        </p>
                      )}
                      {entry.url && (
                        <a
                          className="mt-1 block text-neutral-500 text-xs underline"
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
            if (!certificates.some((e) => e.name)) {
              return null;
            }
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-xs uppercase tracking-wider">
                  {data.certificatesTitle}
                </h2>
                {certificates.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!entry.name) {
                    return acc;
                  }
                  acc.push(
                    <section className="mt-4" key={entry.id}>
                      <h3 className="font-semibold text-neutral-900 text-sm">
                        {entry.url ? (
                          <a
                            className="underline"
                            href={ensureUrl(entry.url)}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {entry.name}
                          </a>
                        ) : (
                          entry.name
                        )}
                        {entry.name && entry.issuer ? " – " : ""}
                        {entry.issuer}
                      </h3>
                      <p className="text-neutral-500 text-xs">
                        {[
                          [
                            entry.date ? formatMonth(entry.date) : "",
                            entry.expiryDate
                              ? formatMonth(entry.expiryDate)
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" – "),
                          entry.credentialId ? `ID: ${entry.credentialId}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </section>
                  );
                  return acc;
                }, [])}
              </section>
            );
          case "languages":
            if (!languages.some((e) => e.language)) {
              return null;
            }
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-xs uppercase tracking-wider">
                  {data.languagesTitle}
                </h2>
                <ul className="mt-2 space-y-1">
                  {languages.reduce<React.ReactNode[]>((acc, entry) => {
                    if (!entry.language) {
                      return acc;
                    }
                    acc.push(
                      <li className="text-neutral-700 text-xs" key={entry.id}>
                        {entry.language}
                        {entry.proficiency && (
                          <span className="text-neutral-500">
                            {" – "}
                            {entry.proficiency}
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
            if (projects.length === 0) {
              return null;
            }
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-xs uppercase tracking-wider">
                  {data.projectsTitle}
                </h2>
                {projects.map((entry) => (
                  <section className="mt-4" key={entry.id}>
                    <h3 className="font-semibold text-neutral-900 text-sm">
                      {entry.url ? (
                        <a
                          className="underline"
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
                      <p className="mt-1 text-neutral-700 text-xs leading-relaxed">
                        {entry.description}
                      </p>
                    )}
                  </section>
                ))}
              </section>
            );
          case "volunteer":
            if (!volunteer.some((e) => e.organization || e.role)) {
              return null;
            }
            return (
              <section className="mt-6" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-xs uppercase tracking-wider">
                  {data.volunteerTitle}
                </h2>
                {volunteer.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!(entry.organization || entry.role)) {
                    return acc;
                  }
                  acc.push(
                    <section className="mt-4" key={entry.id}>
                      <h3 className="font-semibold text-neutral-900 text-sm">
                        {[entry.role, entry.organization]
                          .filter(Boolean)
                          .join(" at ")}
                      </h3>
                      {(entry.startDate || entry.endDate || entry.current) && (
                        <p className="text-neutral-500 text-xs">
                          {[
                            formatMonth(entry.startDate),
                            entry.current
                              ? "Present"
                              : entry.endDate
                                ? formatMonth(entry.endDate)
                                : "Present",
                          ]
                            .filter(Boolean)
                            .join(" – ")}
                        </p>
                      )}
                      {entry.description && (
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                          {/* index key is safe: static newline-split, never reordered */}
                          {entry.description
                            .split("\n")
                            .filter((l) => l.trim())
                            .map((line, i) => (
                              <li
                                className="text-neutral-700 text-xs leading-relaxed"
                                key={i}
                              >
                                {line.trim()}
                              </li>
                            ))}
                        </ul>
                      )}
                    </section>
                  );
                  return acc;
                }, [])}
              </section>
            );
          default:
            return null;
        }
      })}
    </article>
  );
}
