import { createEmptyCV } from "@pilihpendidikan/cv-engine/document";
import { CVDataSchema } from "@pilihpendidikan/cv-engine/schema";
import { describe, expect, it } from "vitest";
import sample from "@/data/sample-cv.json";
import { createBlankCv } from "./blank-cv";

describe("createBlankCv", () => {
  it("is cv-engine's empty CV with the builder's English headings", () => {
    expect(createBlankCv()).toEqual({
      ...createEmptyCV(),
      summaryTitle: "Professional Summary",
      experienceTitle: "Work Experience",
      volunteerTitle: "Volunteer & Community",
    });
  });

  it("is a valid CV document", () => {
    expect(CVDataSchema.parse(createBlankCv())).toEqual(createBlankCv());
  });

  it("returns a fresh document every time", () => {
    const first = createBlankCv();
    const second = createBlankCv();
    expect(first).not.toBe(second);
    expect(first.sectionOrder).not.toBe(second.sectionOrder);
    expect(first.personalInfo).not.toBe(second.personalInfo);
  });
});

describe("the sample CV", () => {
  it("is a valid CV document, kept as it is", () => {
    expect(CVDataSchema.parse(sample)).toEqual(sample);
  });
});
