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

export function StandardPreview({ data }: { data: CVData }) {
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
        <p className="text-center text-neutral-400 text-sm">
          Fill in the form to see your CV preview.
        </p>
      </article>
    );
  }

  return (
    <article className="cv-page mx-auto" id="cv-content">
      {/* Header — two-column: name+title left, contact right */}
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {personalInfo.usePhoto && personalInfo.photoUrl && (
            <img
              alt=""
              className="size-16 shrink-0 rounded-full border border-neutral-200 object-cover"
              src={personalInfo.photoUrl}
            />
          )}
          <div>
            {personalInfo.fullName && (
              <h1 className="font-bold text-neutral-900 text-xl tracking-tight">
                {personalInfo.fullName}
              </h1>
            )}
            {personalInfo.jobTitle && (
              <p className="mt-0.5 text-neutral-500 text-sm">
                {personalInfo.jobTitle}
              </p>
            )}
          </div>
        </div>
        {(personalInfo.email ||
          personalInfo.phone ||
          personalInfo.location ||
          personalInfo.linkedIn) && (
          <div className="space-y-0.5 text-right text-neutral-500 text-xs">
            {personalInfo.email && <p>{personalInfo.email}</p>}
            {personalInfo.phone && (
              <p>{formatPhoneDisplay(personalInfo.phone)}</p>
            )}
            {personalInfo.location && <p>{personalInfo.location}</p>}
            {personalInfo.linkedIn && (
              <p>linkedin.com/in/{personalInfo.linkedIn}</p>
            )}
          </div>
        )}
      </header>

      {data.sectionOrder.map((sectionId) => {
        switch (sectionId) {
          case "summary":
            if (!summary) {
              return null;
            }
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
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
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.experienceTitle}
                </h2>
                {experience
                  .filter((e) => e.company || e.title)
                  .map((entry) => (
                    <section className="mt-3" key={entry.id}>
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
                            .join(" \u2013 ")}
                        </p>
                      )}
                      {(entry.workType || entry.locationPolicy) && (
                        <p className="mt-1 text-neutral-500 text-xs">
                          {[
                            WORK_TYPE_LABELS[entry.workType],
                            LOCATION_LABELS[entry.locationPolicy],
                          ]
                            .filter(Boolean)
                            .join(" \u00b7 ")}
                        </p>
                      )}
                      {entry.description && (
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
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
                  ))}
              </section>
            );
          case "education":
            if (!education.some((e) => e.institution || e.degree)) {
              return null;
            }
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.educationTitle}
                </h2>
                {education
                  .filter((e) => e.institution || e.degree)
                  .map((entry) => (
                    <section className="mt-3" key={entry.id}>
                      <h3 className="font-semibold text-neutral-900 text-sm">
                        {[entry.degree, entry.institution]
                          .filter(Boolean)
                          .join(" \u2013 ")}
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
                              .join(" \u2013 "),
                            entry.category
                              ? EDUCATION_CATEGORY_LABELS[entry.category]
                              : "",
                            entry.gpa ? `GPA: ${entry.gpa}` : "",
                          ]
                            .filter(Boolean)
                            .join(" \u00b7 ")}
                        </p>
                      )}
                    </section>
                  ))}
              </section>
            );
          case "skills":
            if (!skills.some((c) => c.items.length > 0)) {
              return null;
            }
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.skillsTitle}
                </h2>
                <div className="mt-2 space-y-1">
                  {skills
                    .filter((c) => c.items.length > 0)
                    .map((category) => (
                      <p className="text-neutral-700 text-xs" key={category.id}>
                        {category.name && (
                          <span className="font-semibold text-neutral-900">
                            {category.name}:{" "}
                          </span>
                        )}
                        {category.items.join(", ")}.
                      </p>
                    ))}
                </div>
              </section>
            );
          case "awards":
            if (!awards.some((e) => e.title)) {
              return null;
            }
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.awardsTitle}
                </h2>
                {awards
                  .filter((e) => e.title)
                  .map((entry) => (
                    <section className="mt-3" key={entry.id}>
                      <h3 className="font-semibold text-neutral-900 text-sm">
                        {[entry.title, entry.issuer]
                          .filter(Boolean)
                          .join(" \u2013 ")}
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
                  ))}
              </section>
            );
          case "certificates":
            if (!certificates.some((e) => e.name)) {
              return null;
            }
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.certificatesTitle}
                </h2>
                {certificates
                  .filter((e) => e.name)
                  .map((entry) => (
                    <section className="mt-3" key={entry.id}>
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
                        {entry.name && entry.issuer ? " \u2013 " : ""}
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
                          .join(" \u00b7 ")}
                      </p>
                    </section>
                  ))}
              </section>
            );
          case "languages":
            if (!languages.some((e) => e.language)) {
              return null;
            }
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.languagesTitle}
                </h2>
                <ul className="mt-2 space-y-1">
                  {languages
                    .filter((e) => e.language)
                    .map((entry) => (
                      <li className="text-neutral-700 text-xs" key={entry.id}>
                        {entry.language}
                        {entry.proficiency && (
                          <span className="text-neutral-500">
                            {" \u2013 "}
                            {entry.proficiency}
                          </span>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            );
          case "projects":
            if (projects.length === 0) {
              return null;
            }
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.projectsTitle}
                </h2>
                {projects.map((entry) => (
                  <section className="mt-3" key={entry.id}>
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
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.volunteerTitle}
                </h2>
                {volunteer
                  .filter((e) => e.organization || e.role)
                  .map((entry) => (
                    <section className="mt-3" key={entry.id}>
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
                            .join(" \u2013 ")}
                        </p>
                      )}
                      {entry.description && (
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
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
