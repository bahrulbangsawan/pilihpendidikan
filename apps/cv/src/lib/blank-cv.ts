// The builder's blank CV: cv-engine's empty document with the builder's own
// English section headings. A fresh document swaps them for the active
// locale's (cv-generator.tsx); "Clear all" and a draft missing a field fall
// back to these.
import { createEmptyCV } from "@pilihpendidikan/cv-engine/document";
import type { CVData } from "@pilihpendidikan/cv-engine/types";

export function createBlankCv(): CVData {
  return createEmptyCV({
    summaryTitle: "Professional Summary",
    experienceTitle: "Work Experience",
    volunteerTitle: "Volunteer & Community",
  });
}
