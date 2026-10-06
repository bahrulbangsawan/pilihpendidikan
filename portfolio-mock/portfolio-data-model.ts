// Portfolio data model — Apple Developer Academy Indonesia submission
// Target app: apps/portfolio
//
// Source of truth: the two ADA 2025 guidance PDFs.
// Submission output is a single PDF (FullName_Portfolio_Academy2025).
// This model describes the structured content the web app renders to that PDF.

export const SUBMISSION_TARGET = "Apple Developer Academy Indonesia" as const;
export const COHORT_YEAR = 2025 as const;
export const MAX_PROJECTS = 5 as const; // PDF: "maximum of 5 projects"
export const CV_MAX_PAGES = 2 as const; // PDF: "no more than 2 pages"

// Page geometry. Output renders to A4 landscape (297 × 210 mm).
export const PAGE = { size: "A4", orientation: "landscape" } as const;

// Project images are a FIXED 16:9 slot. Uploads that are not exactly 16:9
// must be rejected — no cropping, no letterboxing, no resize.
export const IMAGE_ASPECT_RATIO = { w: 16, h: 9 } as const;
export const IMAGE_RATIO = IMAGE_ASPECT_RATIO.w / IMAGE_ASPECT_RATIO.h; // 1.777…
export const RECOMMENDED_IMAGE_SIZE = { width: 1920, height: 1080 } as const;
// Allow tiny float error from odd source dimensions when validating ratio.
export const IMAGE_RATIO_TOLERANCE = 0.01 as const;

// ---- Field length limits (hard caps) ----
// Every text field has a fixed max so the rendered page layout is
// deterministic and nothing can reflow out of its slot. The HTML mock
// enforces the same caps visually via -webkit-line-clamp.
// Scope of Work is the only variable-length field: it grows by bullet
// items but is bounded by maxItems so it can never push the Technologies
// block past the page divider.
export const LIMITS = {
  owner: {
    fullName: 60,
    headline: 64, // cover subtitle, single line
    institution: 70, // student / alumni
    program: 60, // degree or program of study
    organization: 70, // professional
    jobTitle: 60, // professional
    note: 70, // independent
  },
  contact: {
    email: 254,
    phone: 24,
    websiteUrl: 120,
    socialLabel: 24,
    socialUrl: 200,
  },
  project: {
    title: 40, // 1 line max in layout
    role: 40, // single rail line
    summary: 160, // subtitle / lede, 2 lines max
    description: 270, // problem body, 3 lines max
    impact: 180, // reflection cell, 3 lines max
    learnings: 180, // reflection cell, 3 lines max
    publicationUrl: 200,
    // Scope of Work — flexible but bounded:
    scopeOfWork: { maxItems: 6, maxCharsPerItem: 32 },
    technologies: { maxItems: 6, maxCharsPerItem: 18 },
    skills: { maxItems: 6, maxCharsPerItem: 18 },
  },
  media: {
    alt: 120,
    caption: 100,
  },
} as const;

// ---- Line limits (max rendered lines per text field) ----
// Mirrors the -webkit-line-clamp values in the HTML mock. The renderer must
// clamp to these so no field ever overflows its slot. Character caps in LIMITS
// keep input within these line budgets; the clamp is the hard visual ceiling.
export const LINES = {
  cover: {
    kicker: 1,
    title: 1,
    subtitle: 1, // cover__sub
    contactLabel: 1, // cover__foot h4
    contactValue: 3, // cover__foot p
  },
  project: {
    title: 1,
    summary: 2, // subtitle / lede
    description: 3, // problem body
    railLabel: 1, // field h5
    railValue: 1, // field p (Year, Role, Type, Publication)
    scopeOfWorkItem: 1, // each bullet, 1 line
    reflectionLabel: 1, // Impact / What I learned headings
    impact: 3,
    learnings: 3,
    pageFooter: 1,
  },
  media: {
    caption: 2,
    alt: 2,
  },
} as const;

// Focus area. Drives which project extras are surfaced. Applies equally to
// students and working professionals (ADA maps these to Tech/Design/Domain).
export type Track = "tech" | "design" | "domain";

// The owner's background is general — a portfolio author may be a current
// student, an alumnus, or a working professional. A discriminated union keeps
// each case's required fields explicit instead of forcing an education shape.
export type Affiliation =
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
  | { kind: "independent"; note?: string }; // freelancer, self-taught, between roles

// PDF: "self-initiated or was a class / work assignment".
export type ProjectType =
  | "self-initiated"
  | "class-assignment"
  | "work-assignment";

// PDF: individual vs GROUP PROJECT (state role when group).
export type Collaboration =
  | { kind: "individual" }
  | { kind: "group"; teamSize?: number; role: string };

export type SocialLink = {
  // e.g. "LinkedIn", "GitHub", "Behance", "Dribbble"
  label: string;
  url: string;
};

// PDF cover: phone, email, professional networking account, portfolio link.
export type ContactInfo = {
  email: string;
  phone?: string;
  websiteUrl?: string; // personal portfolio site
  socials?: SocialLink[];
};

// PDF: images, or for video — screenshots of scenes + link to online publication.
export type MediaAsset = {
  type: "image" | "video";
  url: string;
  alt: string;
  caption?: string;
  // Intrinsic pixel dimensions — required so the uploader can verify the
  // 16:9 constraint before accepting the file. width / height must equal
  // IMAGE_RATIO within IMAGE_RATIO_TOLERANCE.
  width: number;
  height: number;
  posterUrl?: string; // required visual (still) for video assets — also 16:9
  publicationUrl?: string; // required online link for video assets
};

// Upload guard. Use at the file-input boundary; reject anything not 16:9.
export const isValidImageRatio = (width: number, height: number): boolean =>
  height > 0 && Math.abs(width / height - IMAGE_RATIO) <= IMAGE_RATIO_TOLERANCE;

export type Project = {
  id: string;
  order: number; // 1..MAX_PROJECTS, drives "Project N of 5"

  // Cover-row metadata (left rail on the template).
  title: string;
  yearAccomplished: number;
  role: string; // e.g. "Designer", "Project Manager", "iOS Developer"
  publicationUrl?: string;

  // Concept description — must demonstrate reasoning: problem understanding,
  // research, problem solving, logical explanation. (1–2 sentence summary first.)
  summary: string; // one- or two-sentence project summary
  description: string; // full concept/process narrative

  // Reflection fields the PDF explicitly asks for.
  projectType: ProjectType;
  collaboration: Collaboration;
  impact: string; // "the impact you've made on the project"
  learnings: string; // "what did you learn from working on this project"

  // Concise list of what the owner actually did on the project (rail chips).
  scopeOfWork?: string[];

  // Track-specific extras (PDF "Portfolio (2)").
  track?: Track;
  technologies?: string[]; // tech track
  repositoryUrl?: string; // tech track — public repo
  marketplaceUrl?: string; // tech track — App Store / marketplace
  documentationUrl?: string; // tech / domain
  skills?: string[]; // design / domain disciplines applied

  media: MediaAsset[];
};

export type PortfolioOwner = {
  fullName: string;
  headline?: string; // short positioning line / desired area of expertise
  affiliation: Affiliation; // student, alumni, professional, or independent
  contact: ContactInfo;
  track: Track; // primary focus area
};

export type Portfolio = {
  owner: PortfolioOwner;
  // Free-form target — e.g. an academy, a job application, or a public site.
  // Defaults to SUBMISSION_TARGET for the ADA use case.
  submissionTarget?: string;
  cohortYear?: number; // only relevant for cohort-based submissions
  projects: Project[]; // length constrained to <= MAX_PROJECTS
  updatedAt: string; // ISO 8601
};

// ---- Lightweight invariants (enforce in a validator / Zod schema) ----
// 1. projects.length >= 1 && projects.length <= MAX_PROJECTS
// 2. affiliation: "student" requires institution; "alumni" requires institution;
//    "professional"/"independent" have no required sub-field (all optional)
// 3. every project.order is unique within 1..MAX_PROJECTS
// 4. video MediaAsset requires posterUrl + publicationUrl
// 5. collaboration.kind === "group" requires non-empty role
// 6. every text field length <= its LIMITS entry (reject, don't truncate input)
// 7. scopeOfWork.length <= LIMITS.project.scopeOfWork.maxItems and each item
//    <= maxCharsPerItem — this is the only field allowed to vary the rail height
// 8. every image (and every video posterUrl still) must satisfy
//    isValidImageRatio(width, height) — exactly 16:9, else reject the upload
export type ValidationIssue = { path: string; message: string };
