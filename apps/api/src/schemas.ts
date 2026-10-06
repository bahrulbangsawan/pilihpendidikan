import { z } from "zod";

const URL_RE = /^https?:\/\/.+/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const dateField = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be YYYY-MM format (e.g. 2024-03)");

export const isoDateField = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    "Must be YYYY-MM-DD format (e.g. 2024-03-15)"
  );

// ISO date that also tolerates an explicit JSON `null` from MCP clients that
// send null to mean "no change". `.nullish()` accepts string | null | undefined
// and keeps the YYYY-MM-DD pattern on the string branch (so a malformed string
// still fails with a clear message). Handlers MUST use a `!= null` guard so a
// null is a genuine no-op and never lands in storage as JSON null.
export const nullableIsoDateField = isoDateField.nullish();

export const optionalDateField = z
  .string()
  .regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/, "Must be YYYY-MM format or empty string")
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

export const experienceSchema = z
  .object({
    company: z.string(),
    url: optionalUrl,
    title: z.string(),
    workType: z
      .enum(["", "full-time", "part-time", "internship"])
      .default("")
      .describe("full-time, part-time, or internship"),
    locationPolicy: z
      .enum(["", "work-from-office", "work-from-anywhere", "hybrid"])
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
      .enum([
        "",
        "university",
        "college",
        "school",
        "polytechnic",
        "academy",
        "language-center",
        "online-platform",
        "professional-association",
      ])
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
