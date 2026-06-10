import { ensureUrl, formatPhoneDisplay } from "@rulisme/ui/lib/utils"
import type { CVData } from "@/components/cv-form"

function formatMonth(value: string): string {
  if (!value) {
    return ""
  }
  const [year, month] = value.split("-")
  if (!(year && month)) {
    return value
  }
  const date = new Date(Number(year), Number(month) - 1)
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

const WORK_TYPE_LABELS: Record<string, string> = {
  "full-time": "Full-Time",
  "part-time": "Part-Time",
  internship: "Internship",
}
const LOCATION_LABELS: Record<string, string> = {
  "work-from-office": "Work From Office",
  "work-from-anywhere": "Work From Anywhere",
  hybrid: "Hybrid",
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
  } = data

  const hasContent =
    personalInfo.fullName ||
    summary ||
    experience.some((e) => e.company || e.title) ||
    education.some((e) => e.institution || e.degree) ||
    skills.some((c) => c.items.length > 0) ||
    awards.some((e) => e.title) ||
    certificates.some((e) => e.name) ||
    languages.some((e) => e.language) ||
    volunteer.some((e) => e.organization || e.role)

  if (!hasContent) {
    return (
      <article className="cv-page mx-auto" id="cv-content">
        <p className="text-center text-sm text-neutral-400">
          Fill in the form to preview your Harvard CV.
        </p>
      </article>
    )
  }

  return (
    <article className="cv-page mx-auto" id="cv-content">
      {/* Header */}
      <header className="mb-3 text-center">
        {personalInfo.fullName && (
          <h1 className="text-xl font-semibold tracking-tight text-neutral-700">
            {personalInfo.fullName}
          </h1>
        )}
        {(personalInfo.email ||
          personalInfo.phone ||
          personalInfo.location ||
          personalInfo.linkedIn) && (
          <p className="mt-2 text-xs text-neutral-500">
            {[
              personalInfo.email,
              personalInfo.phone ? formatPhoneDisplay(personalInfo.phone) : "",
              personalInfo.location,
              personalInfo.linkedIn
                ? `linkedin.com/in/${personalInfo.linkedIn}`
                : "",
            ]
              .filter(Boolean)
              .join("  |  ")}
          </p>
        )}
      </header>

      {data.sectionOrder.map((sectionId) => {
        switch (sectionId) {
          case "summary":
            if (!summary) {
              return null
            }
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-t border-b border-neutral-900 py-1 text-center text-xs font-semibold tracking-wider text-neutral-900 uppercase">
                  {data.summaryTitle}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-neutral-700">
                  {summary}
                </p>
              </section>
            )
          case "experience":
            if (!experience.some((e) => e.company || e.title)) {
              return null
            }
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-t border-b border-neutral-900 py-1 text-center text-xs font-semibold tracking-wider text-neutral-900 uppercase">
                  {data.experienceTitle}
                </h2>
                {experience.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!(entry.company || entry.title)) {
                    return acc
                  }
                  acc.push(
                    <section className="mt-3" key={entry.id}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-sm font-semibold text-neutral-700">
                          {entry.title}
                          {entry.title && entry.company ? ", " : ""}
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
                        {(entry.startDate ||
                          entry.endDate ||
                          entry.current) && (
                          <span className="ml-4 shrink-0 text-xs text-neutral-700">
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
                          </span>
                        )}
                      </div>
                      {(entry.workType || entry.locationPolicy) && (
                        <p className="mt-1 text-xs text-neutral-500">
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
                          {/* index key is safe: static newline-split, never reordered */}
                          {entry.description
                            .split("\n")
                            .filter((l) => l.trim())
                            .map((line, i) => (
                              <li
                                className="text-xs leading-relaxed text-neutral-700"
                                key={i}
                              >
                                {line.trim()}
                              </li>
                            ))}
                        </ul>
                      )}
                    </section>
                  )
                  return acc
                }, [])}
              </section>
            )
          case "education":
            if (!education.some((e) => e.institution || e.degree)) {
              return null
            }
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-t border-b border-neutral-900 py-1 text-center text-xs font-semibold tracking-wider text-neutral-900 uppercase">
                  {data.educationTitle}
                </h2>
                {education.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!(entry.institution || entry.degree)) {
                    return acc
                  }
                  acc.push(
                    <section className="mt-3" key={entry.id}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-sm font-semibold text-neutral-700">
                          {entry.degree}
                          {entry.degree && entry.institution ? ", " : ""}
                          {entry.institution}
                        </h3>
                        {(entry.startDate ||
                          entry.endDate ||
                          entry.current) && (
                          <span className="ml-4 shrink-0 text-xs text-neutral-700">
                            {[
                              formatMonth(entry.startDate),
                              entry.current
                                ? "Present"
                                : formatMonth(entry.endDate),
                            ]
                              .filter(Boolean)
                              .join(" – ")}
                          </span>
                        )}
                      </div>
                      {(entry.gpa || entry.category) && (
                        <p className="text-xs text-neutral-500">
                          {[
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
                  )
                  return acc
                }, [])}
              </section>
            )
          case "skills":
            if (!skills.some((c) => c.items.length > 0)) {
              return null
            }
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-t border-b border-neutral-900 py-1 text-center text-xs font-semibold tracking-wider text-neutral-900 uppercase">
                  {data.skillsTitle}
                </h2>
                <div className="mt-2 space-y-1">
                  {skills.reduce<React.ReactNode[]>((acc, category) => {
                    if (category.items.length === 0) {
                      return acc
                    }
                    acc.push(
                      <p className="text-xs text-neutral-700" key={category.id}>
                        {category.name && (
                          <span className="font-semibold">
                            {category.name}:{" "}
                          </span>
                        )}
                        {category.items.join(", ")}
                      </p>
                    )
                    return acc
                  }, [])}
                </div>
              </section>
            )
          case "awards":
            if (!awards.some((e) => e.title)) {
              return null
            }
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-t border-b border-neutral-900 py-1 text-center text-xs font-semibold tracking-wider text-neutral-900 uppercase">
                  {data.awardsTitle}
                </h2>
                {awards.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!entry.title) {
                    return acc
                  }
                  acc.push(
                    <section className="mt-3" key={entry.id}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-sm font-semibold text-neutral-700">
                          {entry.title}
                          {entry.issuer ? `, ${entry.issuer}` : ""}
                        </h3>
                        {entry.date && (
                          <span className="ml-4 shrink-0 text-xs text-neutral-700">
                            {formatMonth(entry.date)}
                          </span>
                        )}
                      </div>
                      {entry.description && (
                        <p className="mt-1 text-xs leading-relaxed text-neutral-700">
                          {entry.description}
                        </p>
                      )}
                      {entry.url && (
                        <a
                          className="mt-1 block text-xs text-neutral-900 underline"
                          href={ensureUrl(entry.url)}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {entry.url}
                        </a>
                      )}
                    </section>
                  )
                  return acc
                }, [])}
              </section>
            )
          case "certificates":
            if (!certificates.some((e) => e.name)) {
              return null
            }
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-t border-b border-neutral-900 py-1 text-center text-xs font-semibold tracking-wider text-neutral-900 uppercase">
                  {data.certificatesTitle}
                </h2>
                {certificates.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!entry.name) {
                    return acc
                  }
                  acc.push(
                    <section className="mt-3" key={entry.id}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-sm font-semibold text-neutral-700">
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
                          {entry.issuer ? `, ${entry.issuer}` : ""}
                        </h3>
                        {(entry.date || entry.expiryDate) && (
                          <span className="ml-4 shrink-0 text-xs text-neutral-700">
                            {[
                              entry.date ? formatMonth(entry.date) : "",
                              entry.expiryDate
                                ? formatMonth(entry.expiryDate)
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" – ")}
                          </span>
                        )}
                      </div>
                      {entry.credentialId && (
                        <p className="text-xs text-neutral-700">
                          Credential ID: {entry.credentialId}
                        </p>
                      )}
                    </section>
                  )
                  return acc
                }, [])}
              </section>
            )
          case "languages":
            if (!languages.some((e) => e.language)) {
              return null
            }
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-t border-b border-neutral-900 py-1 text-center text-xs font-semibold tracking-wider text-neutral-900 uppercase">
                  {data.languagesTitle}
                </h2>
                <div className="mt-2 space-y-1">
                  {languages.reduce<React.ReactNode[]>((acc, entry) => {
                    if (!entry.language) {
                      return acc
                    }
                    acc.push(
                      <p className="text-xs text-neutral-700" key={entry.id}>
                        <span className="font-semibold">{entry.language}</span>
                        {entry.proficiency && (
                          <span>
                            {" "}
                            {"–"} {entry.proficiency}
                          </span>
                        )}
                      </p>
                    )
                    return acc
                  }, [])}
                </div>
              </section>
            )
          case "projects":
            if (projects.length === 0) {
              return null
            }
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-t border-b border-neutral-900 py-1 text-center text-xs font-semibold tracking-wider text-neutral-900 uppercase">
                  {data.projectsTitle}
                </h2>
                {projects.map((entry) => (
                  <section className="mt-3" key={entry.id}>
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-sm font-semibold text-neutral-700">
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
                    </div>
                    {entry.description && (
                      <p className="mt-1 text-xs leading-relaxed text-neutral-700">
                        {entry.description}
                      </p>
                    )}
                  </section>
                ))}
              </section>
            )
          case "volunteer":
            if (!volunteer.some((e) => e.organization || e.role)) {
              return null
            }
            return (
              <section className="mt-3" key={sectionId}>
                <h2 className="border-t border-b border-neutral-900 py-1 text-center text-xs font-semibold tracking-wider text-neutral-900 uppercase">
                  {data.volunteerTitle}
                </h2>
                {volunteer.reduce<React.ReactNode[]>((acc, entry) => {
                  if (!(entry.organization || entry.role)) {
                    return acc
                  }
                  acc.push(
                    <section className="mt-3" key={entry.id}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-sm font-semibold text-neutral-700">
                          {entry.role}
                          {entry.role && entry.organization ? ", " : ""}
                          {entry.organization}
                        </h3>
                        {(entry.startDate ||
                          entry.endDate ||
                          entry.current) && (
                          <span className="ml-4 shrink-0 text-xs text-neutral-700">
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
                          </span>
                        )}
                      </div>
                      {entry.description && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {/* index key is safe: static newline-split, never reordered */}
                          {entry.description
                            .split("\n")
                            .filter((l) => l.trim())
                            .map((line, i) => (
                              <li
                                className="text-xs leading-relaxed text-neutral-700"
                                key={i}
                              >
                                {line.trim()}
                              </li>
                            ))}
                        </ul>
                      )}
                    </section>
                  )
                  return acc
                }, [])}
              </section>
            )
          default:
            return null
        }
      })}
    </article>
  )
}
