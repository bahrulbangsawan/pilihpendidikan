// Zod v4 schemas for the CV: the field formats and entry inputs the MCP
// `cv_*` tools validate (moved here from apps/api/src/schemas.ts, unchanged),
// and CVDataSchema, the whole stored document composed from those entries.
import { z } from "zod";
import {
  CV_SECTION_IDS,
  CV_STYLES,
  CV_VISIBILITIES,
  DEFAULT_SECTION_TITLES,
  EDUCATION_CATEGORIES,
  LOCATION_POLICIES,
  WORK_TYPES,
} from "./document";
import type { CVSectionTitleKey } from "./types";

const URL_RE = /^https?:\/\/.+/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const OPTIONAL_YEAR_MONTH_RE = /^(\d{4}-(0[1-9]|1[0-2]))?$/;

// ─── Field formats (MCP tool inputs) ─────────────────────────

export const dateField = z
  .string()
  .regex(YEAR_MONTH_RE, "Must be YYYY-MM format (e.g. 2024-03)");

export const optionalDateField = z
  .string()
  .regex(OPTIONAL_YEAR_MONTH_RE, "Must be YYYY-MM format or empty string")
  .default("")
  .describe("YYYY-MM format or empty");

export const optionalUrl = z
  .string()
  .refine((v) => v === "" || URL_RE.test(v), "Must be a valid URL or empty")
  .default("")
  .describe("Full URL (https://...) or empty");

export const optionalEmail = z
  .string()
  .refine((v) => v === "" || EMAIL_RE.test(v), "Must be a valid email or empty")
  .default("")
  .describe("Valid email address or empty");

// ─── Entry inputs (MCP `cv_add_*`), without the generated id ─

export const experienceSchema = z
  .object({
    company: z.string(),
    url: optionalUrl,
    title: z.string(),
    workType: z
      .enum(WORK_TYPES)
      .default("")
      .describe("full-time, part-time, or internship"),
    locationPolicy: z
      .enum(LOCATION_POLICIES)
      .default("")
      .describe("work-from-office, work-from-anywhere, or hybrid"),
    startDate: dateField,
    endDate: optionalDateField.describe(
      "YYYY-MM format. Leave empty if current=true"
    ),
    current: z
      .boolean()
      .default(false)
      .describe("Set true if still working here (Present)"),
    description: z
      .string()
      .describe(
        "Plain text lines separated by newlines. Do NOT add bullet markers (-, •, *) — bullets are rendered automatically"
      ),
  })
  .refine((d) => !d.current || d.endDate === "", {
    message: "endDate must be empty when current is true",
    path: ["endDate"],
  });

export const educationSchema = z
  .object({
    category: z
      .enum(EDUCATION_CATEGORIES)
      .default("")
      .describe("Institution type"),
    institution: z.string(),
    degree: z.string(),
    gpa: z.string().default(""),
    startDate: dateField,
    endDate: optionalDateField.describe(
      "YYYY-MM format. Leave empty if current=true"
    ),
    current: z
      .boolean()
      .default(false)
      .describe("Set true if still studying (Present)"),
  })
  .refine((d) => !d.current || d.endDate === "", {
    message: "endDate must be empty when current is true",
    path: ["endDate"],
  });

export const skillCategorySchema = z.object({
  name: z.string().describe("Category name, e.g. 'Hard Skills'"),
  items: z.array(z.string()).describe("List of skills in this category"),
});

export const awardSchema = z.object({
  title: z.string(),
  issuer: z.string(),
  date: dateField,
  description: z.string().default("").describe("Plain text, no bullet markers"),
  url: optionalUrl,
});

export const certificateSchema = z.object({
  name: z.string(),
  issuer: z.string(),
  date: dateField,
  expiryDate: optionalDateField.describe(
    "YYYY-MM format. Leave empty if no expiry"
  ),
  credentialId: z.string().default(""),
  url: optionalUrl,
});

export const languageSchema = z.object({
  language: z.string(),
  proficiency: z
    .enum(["Native", "Fluent", "Professional", "Conversational", "Basic"])
    .describe("Native, Fluent, Professional, Conversational, or Basic"),
});

export const projectSchema = z.object({
  name: z.string(),
  url: optionalUrl,
  description: z.string().describe("Plain text, no bullet markers"),
});

export const volunteerSchema = z
  .object({
    organization: z.string(),
    role: z.string(),
    startDate: dateField,
    endDate: optionalDateField.describe(
      "YYYY-MM format. Leave empty if current=true"
    ),
    current: z
      .boolean()
      .default(false)
      .describe("Set true if still volunteering (Present)"),
    description: z
      .string()
      .default("")
      .describe("Plain text, no bullet markers"),
  })
  .refine((d) => !d.current || d.endDate === "", {
    message: "endDate must be empty when current is true",
    path: ["endDate"],
  });

// ─── The stored document ─────────────────────────────────────
//
// A stored entry is its MCP input plus the entry id. Where the tools are
// stricter than the builder, the document takes what the builder saves: a
// month not picked yet (""), a link typed without its scheme (the templates
// add it, ensureUrl), a proficiency in the user's own words, an end date
// kept while "current" is ticked. Fields that later builder versions added
// default as the tools default them; unknown keys are dropped, so a parsed
// document is exactly a CVData.

const entryId = z.string().min(1, "Every entry needs an id");
const freeDate = z.string().describe("YYYY-MM, or empty while not picked");
const freeUrl = z.string().describe("A link, with or without https://");

function entryList<T extends z.ZodType<{ id: string }>>(entry: T) {
  return z
    .array(entry)
    .refine(
      (entries) =>
        new Set(entries.map((item) => item.id)).size === entries.length,
      "Entry ids must be unique within a section"
    );
}

export const personalInfoSchema = z.object({
  fullName: z.string().default(""),
  jobTitle: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  location: z.string().default(""),
  linkedIn: z.string().default("").describe("LinkedIn handle, not a URL"),
  photoUrl: z.string().default("").describe("A data: URL, or empty"),
  usePhoto: z.boolean().default(false),
});

export const experienceEntrySchema = z.object({
  ...experienceSchema.shape,
  id: entryId,
  url: freeUrl,
  startDate: freeDate,
  endDate: freeDate,
});

export const educationEntrySchema = z.object({
  ...educationSchema.shape,
  id: entryId,
  startDate: freeDate,
  endDate: freeDate,
});

export const skillCategoryEntrySchema = z.object({
  ...skillCategorySchema.shape,
  id: entryId,
});

export const awardEntrySchema = z.object({
  ...awardSchema.shape,
  id: entryId,
  date: freeDate,
  url: freeUrl,
});

export const certificateEntrySchema = z.object({
  ...certificateSchema.shape,
  id: entryId,
  date: freeDate,
  expiryDate: freeDate,
  url: freeUrl,
});

export const languageEntrySchema = z.object({
  ...languageSchema.shape,
  id: entryId,
  proficiency: z.string(),
});

export const projectEntrySchema = z.object({
  ...projectSchema.shape,
  id: entryId,
  url: freeUrl,
});

export const volunteerEntrySchema = z.object({
  ...volunteerSchema.shape,
  id: entryId,
  startDate: freeDate,
  endDate: freeDate,
});

export const CVSectionIdSchema = z.enum(CV_SECTION_IDS);

function sectionTitle(key: CVSectionTitleKey) {
  return z.string().default(DEFAULT_SECTION_TITLES[key]);
}

export const CVDataSchema = z.object({
  style: z.enum(CV_STYLES).optional(),
  visibility: z.enum(CV_VISIBILITIES).optional(),
  personalInfo: personalInfoSchema,
  sectionOrder: z
    .array(CVSectionIdSchema)
    .refine(
      (order) => new Set(order).size === order.length,
      "A section can appear only once in sectionOrder"
    ),
  summaryTitle: sectionTitle("summaryTitle"),
  summary: z.string().default(""),
  experienceTitle: sectionTitle("experienceTitle"),
  experience: entryList(experienceEntrySchema),
  educationTitle: sectionTitle("educationTitle"),
  education: entryList(educationEntrySchema),
  skillsTitle: sectionTitle("skillsTitle"),
  skills: entryList(skillCategoryEntrySchema),
  awardsTitle: sectionTitle("awardsTitle"),
  awards: entryList(awardEntrySchema),
  certificatesTitle: sectionTitle("certificatesTitle"),
  certificates: entryList(certificateEntrySchema),
  languagesTitle: sectionTitle("languagesTitle"),
  languages: entryList(languageEntrySchema),
  projectsTitle: sectionTitle("projectsTitle"),
  projects: entryList(projectEntrySchema),
  volunteerTitle: sectionTitle("volunteerTitle"),
  volunteer: entryList(volunteerEntrySchema),
});
