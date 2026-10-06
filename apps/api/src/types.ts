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

export const DEFAULT_SECTION_ORDER: CVSectionId[] = [
  "summary",
  "experience",
  "education",
  "skills",
  "awards",
  "certificates",
  "languages",
  "projects",
  "volunteer",
];

export type CVStyle = "basic" | "harvard" | "simple" | "standard";

export interface CVData {
  // Selected template; persisted so the chosen layout round-trips into the
  // print view / PDF redirect. Optional for documents stored before the field
  // existed — consumers default to "basic".
  style?: CVStyle;
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

export function createEmptyCV(): CVData {
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
    summaryTitle: "Summary",
    summary: "",
    experienceTitle: "Experience",
    experience: [],
    educationTitle: "Education",
    education: [],
    skillsTitle: "Skills",
    skills: [],
    awardsTitle: "Awards",
    awards: [],
    certificatesTitle: "Certificates",
    certificates: [],
    languagesTitle: "Languages",
    languages: [],
    projectsTitle: "Projects",
    projects: [],
    volunteerTitle: "Volunteer",
    volunteer: [],
  };
}

// ─── Invoice types ────────────────────────────────────────────

export interface InvoiceSenderInfo {
  companyName: string;
  address: string;
  city: string;
  kecamatan: string;
  state: string;
  postalCode: string;
  country: string;
  email: string;
  logoUrl: string;
}

export interface InvoiceRecipientInfo {
  name: string;
  address: string;
  city: string;
  kecamatan: string;
  stateRegion: string;
  postalCode: string;
  country: string;
  email: string;
}

export interface InvoiceSubItem {
  id: string;
  label: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  period: string;
  qty: number;
  unitPrice: number;
  amount: number;
  subItems: InvoiceSubItem[];
}

export interface InvoiceAdjustment {
  id: string;
  label: string;
  type: "add" | "deduct";
  mode: "percentage" | "fixed";
  value: number;
}

export interface InvoiceCustomField {
  id: string;
  label: string;
  value: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  dateOfIssue: string;
  dateDue: string;
  currency: string;
  accentColor: string;
  from: InvoiceSenderInfo;
  billTo: InvoiceRecipientInfo;
  items: InvoiceLineItem[];
  adjustments: InvoiceAdjustment[];
  customFields: InvoiceCustomField[];
  notes: string;
  taxRate: number;
}

export function createEmptyInvoice(): InvoiceData {
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  return {
    invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}`,
    dateOfIssue: today,
    dateDue: due,
    currency: "USD",
    accentColor: "#2563eb",
    from: {
      companyName: "",
      address: "",
      city: "",
      kecamatan: "",
      state: "",
      postalCode: "",
      country: "",
      email: "",
      logoUrl: "",
    },
    billTo: {
      name: "",
      address: "",
      city: "",
      kecamatan: "",
      stateRegion: "",
      postalCode: "",
      country: "",
      email: "",
    },
    items: [],
    adjustments: [],
    customFields: [],
    notes: "",
    taxRate: 0,
  };
}

// Authoritative line total: a line item's own qty × unitPrice PLUS the sum of
// its sub-item amounts. This is the single source of truth for a line's value.
// Readers compute from first principles instead of trusting the denormalized
// `item.amount`, so a stale `amount` (e.g. written by a path that forgot to roll
// sub-items up) can never under-report a total. When `item.amount` is already
// correct this returns exactly that value, so there is never any double counting.
export function invoiceLineTotal(item: InvoiceLineItem): number {
  const own = item.qty * item.unitPrice;
  const subTotal = item.subItems.reduce((sum, sub) => sum + sub.amount, 0);
  return own + subTotal;
}

// Invoice subtotal = sum of every line's authoritative total (see
// invoiceLineTotal). Shared by invoice_get_totals and the markdown export so the
// MCP tool and the REST API can never diverge from the rendered document.
export function invoiceSubtotal(items: InvoiceLineItem[]): number {
  return items.reduce((sum, item) => sum + invoiceLineTotal(item), 0);
}

// ─── Jobs tracker types ───────────────────────────────────────
//
// Per-user job-application tracker persisted as KV `job:{id}`, mirroring the
// invoice storage model: one JSON blob per resource, ownership stamped at
// create time under `owner:job:{id}` (see jobs-management.ts / helpers.ts).
// A "job" is one tracked application; it owns ordered `sections`, each owning
// ordered `items`. Item fields are deliberately generic (title + notes + url +
// done) so a section can model a checklist, interview rounds, a contact list,
// etc. — the tracker is free-form by design.

export const JOB_STATUSES = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "accepted",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobItem {
  id: string;
  title: string;
  notes: string;
  url: string;
  done: boolean;
}

export interface JobSection {
  id: string;
  name: string;
  items: JobItem[];
}

export interface JobData {
  id: string;
  title: string;
  status: JobStatus;
  // Hiring company name (free text), its public URL (validated as a URL on
  // write, "" when unset), and a free-text compensation band.
  company: string;
  companyUrl: string;
  salaryRange: string;
  // The role's posted description and requirement bullets, each an ordered list
  // of free-text lines edited through collapsible array editors.
  jobDescription: string[];
  requirements: string[];
  // Scheduled interview date as an ISO calendar date ("YYYY-MM-DD"), or "" when
  // none is set. Optional so blobs stored before the field existed round-trip
  // unchanged; the REST API + jobs_* tools write it going forward.
  interviewDate?: string;
  sections: JobSection[];
  createdAt: string;
  updatedAt: string;
}

export function createEmptyJob(): JobData {
  const now = new Date().toISOString();
  return {
    id: "",
    title: "",
    status: "saved",
    company: "",
    companyUrl: "",
    salaryRange: "",
    jobDescription: [],
    requirements: [],
    interviewDate: "",
    sections: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Fill in any field a stored blob predates, so every read of a job (MCP tools,
// the REST API) sees a complete JobData regardless of when it was first
// written. Applied at the `getJob()` read boundary in helpers.ts; the input is
// `Partial<JobData>` because a blob written before these fields shipped is
// genuinely missing them at runtime even though the on-disk type claims JobData.
export function normalizeJobData(raw: Partial<JobData>): JobData {
  const now = new Date().toISOString();
  return {
    id: raw.id ?? "",
    title: raw.title ?? "",
    status: raw.status ?? "saved",
    company: raw.company ?? "",
    companyUrl: raw.companyUrl ?? "",
    salaryRange: raw.salaryRange ?? "",
    jobDescription: raw.jobDescription ?? [],
    requirements: raw.requirements ?? [],
    interviewDate: raw.interviewDate ?? "",
    sections: raw.sections ?? [],
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  };
}

// ─── Portfolio types ──────────────────────────────────────────
//
// Per-user portfolio builder persisted as KV `portfolio:{id}`, mirroring the
// cv / invoice storage model: one JSON blob per resource, ownership stamped at
// create time under `owner:portfolio:{id}` (see portfolio-management.ts /
// helpers.ts). This shape is a verbatim STRUCTURAL MIRROR of
// apps/portfolio's `Portfolio` type (src/components/portfolio-data-model.ts)
// so one portfolio round-trips byte-for-byte between the portfolio_* MCP tools,
// `GET/PUT /api/portfolio/:id`, and the builder app.
//
// This is the per-user "Apple Developer Academy"-style portfolio document.

export type PortfolioTrack = "tech" | "design" | "domain";

// Discriminated union — the owner may be a current student, an alumnus, a
// working professional, or independent. Mirrors the app's `Affiliation` union;
// `student`/`alumni` require `institution`, the other two have all-optional
// sub-fields.
export type PortfolioAffiliation =
  | {
      kind: "student";
      institution: string;
      program?: string;
      semester?: number;
    }
  | {
      kind: "alumni";
      institution: string;
      program?: string;
      graduationYear?: number;
    }
  | {
      kind: "professional";
      organization?: string;
      jobTitle?: string;
      yearsExperience?: number;
    }
  | { kind: "independent"; note?: string };

export interface PortfolioSocialLink {
  label: string;
  url: string;
}

export interface PortfolioContactInfo {
  email: string;
  phone?: string;
  websiteUrl?: string;
  socials?: PortfolioSocialLink[];
}

export type PortfolioProjectType =
  | "self-initiated"
  | "class-assignment"
  | "work-assignment";

export type PortfolioCollaboration =
  | { kind: "individual" }
  | { kind: "group"; teamSize?: number; role: string };

export interface PortfolioMediaAsset {
  type: "image" | "video";
  url: string;
  alt: string;
  caption?: string;
  // Intrinsic pixel dimensions — the app validates these as exactly 16:9 at the
  // upload boundary; the tools document the same constraint.
  width: number;
  height: number;
  posterUrl?: string;
  publicationUrl?: string;
}

export interface PortfolioProject {
  id: string;
  order: number; // 1..PORTFOLIO_MAX_PROJECTS
  title: string;
  yearAccomplished: number;
  role: string;
  publicationUrl?: string;
  summary: string;
  description: string;
  projectType: PortfolioProjectType;
  collaboration: PortfolioCollaboration;
  impact: string;
  learnings: string;
  scopeOfWork?: string[];
  track?: PortfolioTrack;
  technologies?: string[];
  repositoryUrl?: string;
  marketplaceUrl?: string;
  documentationUrl?: string;
  skills?: string[];
  media: PortfolioMediaAsset[];
}

export interface PortfolioOwnerInfo {
  fullName: string;
  headline?: string;
  affiliation: PortfolioAffiliation;
  contact: PortfolioContactInfo;
  track: PortfolioTrack;
}

export interface PortfolioData {
  owner: PortfolioOwnerInfo;
  submissionTarget?: string;
  cohortYear?: number;
  projects: PortfolioProject[]; // length constrained to <= PORTFOLIO_MAX_PROJECTS
  updatedAt: string; // ISO 8601
}

// PDF: "maximum of 5 projects". Enforced by the add-project tool.
export const PORTFOLIO_MAX_PROJECTS = 5;

// A blank portfolio that is a COMPLETE, renderable `PortfolioData`. The builder
// app sets a loaded remote document directly (unmerged), so a freshly created
// portfolio must already satisfy the full shape — this mirrors the app's
// `makeEmptyPortfolio()` factory (portfolio-form.tsx) field-for-field.
export function createEmptyPortfolio(): PortfolioData {
  return {
    owner: {
      fullName: "",
      headline: "",
      affiliation: { kind: "student", institution: "", program: "" },
      contact: { email: "", phone: "", websiteUrl: "", socials: [] },
      track: "tech",
    },
    submissionTarget: "Apple Developer Academy Indonesia",
    cohortYear: 2025,
    projects: [],
    updatedAt: new Date().toISOString(),
  };
}
