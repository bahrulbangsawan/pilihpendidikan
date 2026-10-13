// The CV document: the one shape the CV builder (apps/cv) edits, the api
// Worker stores in CV_KV as `cv:{id}`, the MCP `cv_*` tools change and the
// PDF templates render. ./schema.ts validates it as a whole.

export interface PersonalInfo {
  fullName: string;
  jobTitle: string;
  email: string;
  phone: string;
  location: string;
  linkedIn: string;
  photoUrl: string;
  usePhoto: boolean;
}

export type WorkType = "" | "full-time" | "part-time" | "internship";
export type LocationPolicy =
  | ""
  | "work-from-office"
  | "work-from-anywhere"
  | "hybrid";

export interface ExperienceEntry {
  id: string;
  company: string;
  url: string;
  title: string;
  workType: WorkType;
  locationPolicy: LocationPolicy;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}

export type EducationCategory =
  | ""
  | "university"
  | "college"
  | "school"
  | "polytechnic"
  | "academy"
  | "language-center"
  | "online-platform"
  | "professional-association";

export interface EducationEntry {
  id: string;
  category: EducationCategory;
  institution: string;
  degree: string;
  gpa: string;
  startDate: string;
  endDate: string;
  current: boolean;
}

export interface AwardEntry {
  id: string;
  title: string;
  issuer: string;
  date: string;
  description: string;
  url: string;
}

export interface CertificateEntry {
  id: string;
  name: string;
  issuer: string;
  date: string;
  expiryDate: string;
  credentialId: string;
  url: string;
}

export interface LanguageEntry {
  id: string;
  language: string;
  proficiency: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  url: string;
  description: string;
}

export interface VolunteerEntry {
  id: string;
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}

export type CVStyle = "basic" | "harvard" | "simple" | "standard";

export interface SkillCategory {
  id: string;
  name: string;
  items: string[];
}

export type CVSectionId =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "awards"
  | "certificates"
  | "languages"
  | "projects"
  | "volunteer";

/** The editable heading of each section: `summaryTitle` … `volunteerTitle`. */
export type CVSectionTitleKey = `${CVSectionId}Title`;

/**
 * Who may read a stored CV by its id (D-25). Absent means "public", the
 * sharing every CV had before the flag existed; tailored variants of the Job
 * Tracker are created "private" (owner-only).
 */
export type CVVisibility = "public" | "private";

export interface CVData {
  /**
   * Selected template. Persisted so the chosen layout round-trips into the
   * print view / PDF (the `/cv/<slug>.pdf` redirect renders whatever is saved
   * here). Optional for backwards-compat with documents stored before the
   * field existed — consumers default to "basic".
   */
  style?: CVStyle;
  /**
   * Who may read the stored document (D-25). Optional; absent = "public".
   * The CV itself never renders it.
   */
  visibility?: CVVisibility;
  personalInfo: PersonalInfo;
  sectionOrder: CVSectionId[];
  summaryTitle: string;
  summary: string;
  experienceTitle: string;
  experience: ExperienceEntry[];
  educationTitle: string;
  education: EducationEntry[];
  skillsTitle: string;
  skills: SkillCategory[];
  awardsTitle: string;
  awards: AwardEntry[];
  certificatesTitle: string;
  certificates: CertificateEntry[];
  languagesTitle: string;
  languages: LanguageEntry[];
  projectsTitle: string;
  projects: ProjectEntry[];
  volunteerTitle: string;
  volunteer: VolunteerEntry[];
}
