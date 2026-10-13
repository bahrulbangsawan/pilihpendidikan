// The CV's closed vocabularies and the blank document. Free of zod so the
// builder's client bundle can create a CV without the schema (./schema.ts
// builds its enums from these tuples).
import type {
  CVData,
  CVSectionId,
  CVSectionTitleKey,
  CVStyle,
  CVVisibility,
  EducationCategory,
  LocationPolicy,
  WorkType,
} from "./types";

/** Every section id, in the order a new CV lists them. */
export const CV_SECTION_IDS = [
  "summary",
  "experience",
  "education",
  "skills",
  "awards",
  "certificates",
  "languages",
  "projects",
  "volunteer",
] as const satisfies readonly CVSectionId[];

/** The section order of a new CV. */
export const DEFAULT_SECTION_ORDER: readonly CVSectionId[] = CV_SECTION_IDS;

export const CV_STYLES = [
  "basic",
  "harvard",
  "simple",
  "standard",
] as const satisfies readonly CVStyle[];

export const CV_VISIBILITIES = [
  "public",
  "private",
] as const satisfies readonly CVVisibility[];

export const WORK_TYPES = [
  "",
  "full-time",
  "part-time",
  "internship",
] as const satisfies readonly WorkType[];

export const LOCATION_POLICIES = [
  "",
  "work-from-office",
  "work-from-anywhere",
  "hybrid",
] as const satisfies readonly LocationPolicy[];

export const EDUCATION_CATEGORIES = [
  "",
  "university",
  "college",
  "school",
  "polytechnic",
  "academy",
  "language-center",
  "online-platform",
  "professional-association",
] as const satisfies readonly EducationCategory[];

/**
 * The section headings of a CV created without titles of its own (the MCP
 * `cv_create` tool). The builder seeds its own, localised headings.
 */
export const DEFAULT_SECTION_TITLES: Readonly<
  Record<CVSectionTitleKey, string>
> = {
  summaryTitle: "Summary",
  experienceTitle: "Experience",
  educationTitle: "Education",
  skillsTitle: "Skills",
  awardsTitle: "Awards",
  certificatesTitle: "Certificates",
  languagesTitle: "Languages",
  projectsTitle: "Projects",
  volunteerTitle: "Volunteer",
};

/** A blank CV: every section empty and in the default order. */
export function createEmptyCV(
  titles: Partial<Record<CVSectionTitleKey, string>> = {}
): CVData {
  const heading = { ...DEFAULT_SECTION_TITLES, ...titles };
  return {
    personalInfo: {
      fullName: "",
      jobTitle: "",
      email: "",
      phone: "",
      location: "",
      linkedIn: "",
      photoUrl: "",
      usePhoto: false,
    },
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    summaryTitle: heading.summaryTitle,
    summary: "",
    experienceTitle: heading.experienceTitle,
    experience: [],
    educationTitle: heading.educationTitle,
    education: [],
    skillsTitle: heading.skillsTitle,
    skills: [],
    awardsTitle: heading.awardsTitle,
    awards: [],
    certificatesTitle: heading.certificatesTitle,
    certificates: [],
    languagesTitle: heading.languagesTitle,
    languages: [],
    projectsTitle: heading.projectsTitle,
    projects: [],
    volunteerTitle: heading.volunteerTitle,
    volunteer: [],
  };
}
