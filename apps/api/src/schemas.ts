import { z } from "zod";

// The CV field formats and entry schemas live in @pilihpendidikan/cv-engine,
// next to the whole-document CVDataSchema they compose; the cv_* tools and
// the invoice/portfolio tools keep importing them from here.
// biome-ignore lint/performance/noBarrelFile: compatibility re-export for the tools' existing imports
export {
  awardSchema,
  certificateSchema,
  dateField,
  educationSchema,
  experienceSchema,
  languageSchema,
  optionalDateField,
  optionalEmail,
  optionalUrl,
  projectSchema,
  skillCategorySchema,
  volunteerSchema,
} from "@pilihpendidikan/cv-engine";

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
