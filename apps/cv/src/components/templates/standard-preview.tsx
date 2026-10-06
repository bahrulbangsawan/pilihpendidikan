import { fadeInOnLoad } from "@rulisme/ui/lib/image-fade";
import { ensureUrl, formatPhoneDisplay } from "@rulisme/ui/lib/utils";
import type { CVData } from "@/components/cv-form";
import {
  PreviewCertificateEntry,
  PreviewExperienceEntry,
} from "./preview-entries";
import {
  formatOngoingEndDate,
  getDescriptionLines,
  hasPreviewSectionContent,
} from "./template-utils";

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
              className="image-fade size-16 shrink-0 rounded-full border border-neutral-200 object-cover"
              decoding="async"
              height={64}
              loading="eager"
              ref={fadeInOnLoad}
              src={personalInfo.photoUrl}
              width={64}
            />
          )}
          <div>
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
        if (!hasPreviewSectionContent(data, sectionId)) {
          return null;
        }
        switch (sectionId) {
          case "summary":
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
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.experienceTitle}
                </h2>
                {experience.map((entry) => (
                  <PreviewExperienceEntry
                    className="mt-3"
                    entry={entry}
                    formatMonth={formatMonth}
                    key={entry.id}
                  />
                ))}
              </section>
            );
          case "education":
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.educationTitle}
                </h2>
                {education.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!(entry.institution || entry.degree)) {
                    return acc;
                  }
                  acc.push(
                    <section className="mt-3" key={entry.id}>
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
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
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
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.awardsTitle}
                </h2>
                {awards.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!entry.title) {
                    return acc;
                  }
                  acc.push(
                    <section className="mt-3" key={entry.id}>
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
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.certificatesTitle}
                </h2>
                {certificates.map((entry) => (
                  <PreviewCertificateEntry
                    className="mt-3"
                    entry={entry}
                    formatMonth={formatMonth}
                    key={entry.id}
                  />
                ))}
              </section>
            );
          case "languages":
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
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
            return (
              <section className="mt-5" key={sectionId}>
                <h2 className="border-neutral-200 border-b pb-1 font-semibold text-neutral-900 text-sm">
                  {data.volunteerTitle}
                </h2>
                {volunteer.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!(entry.organization || entry.role)) {
                    return acc;
                  }
                  acc.push(
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
                            formatOngoingEndDate(
                              entry.endDate,
                              entry.current,
                              formatMonth
                            ),
                          ]
                            .filter(Boolean)
                            .join(" – ")}
                        </p>
                      )}
                      {entry.description && (
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                          {getDescriptionLines(entry.description).map(
                            ({ key, text }) => (
                              <li
                                className="text-neutral-700 text-xs leading-relaxed"
                                key={key}
                              >
                                {text}
                              </li>
                            )
                          )}
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
