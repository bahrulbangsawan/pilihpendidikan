// TCV-SCHEMA: CVDataSchema accepts every document the builder and the MCP
// tools write and rejects malformed ones; its output is exactly a CVData.
import { describe, expect, it } from "bun:test";
import type { z } from "zod";
import { createEmptyCV, DEFAULT_SECTION_TITLES } from "../src/document";
import {
  CVDataSchema,
  dateField,
  experienceSchema,
  languageSchema,
  optionalUrl,
} from "../src/schema";
import type { CVData } from "../src/types";
import { EMPTY, EXTENDED, SAMPLE } from "./cases";

// True only when the two types are identical.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

function issuePaths(value: unknown): string[] {
  const result = CVDataSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join("."));
}

function withChange(change: (cv: CVData) => void): CVData {
  const cv = structuredClone(SAMPLE);
  change(cv);
  return cv;
}

describe("TCV-SCHEMA CVDataSchema accepts real documents", () => {
  it("TCV-SCHEMA parses apps/cv's sample-cv.json unchanged", () => {
    expect(CVDataSchema.parse(SAMPLE)).toEqual(SAMPLE);
  });

  it("TCV-SCHEMA parses a blank CV, the builder's and the MCP tool's", () => {
    expect(CVDataSchema.parse(EMPTY)).toEqual(EMPTY);
    expect(CVDataSchema.parse(createEmptyCV())).toEqual(createEmptyCV());
  });

  it("TCV-SCHEMA keeps style and visibility (D-25)", () => {
    const cv = { ...EXTENDED, visibility: "private" as const };
    expect(CVDataSchema.parse(cv)).toEqual(cv);
    expect(CVDataSchema.parse(SAMPLE).visibility).toBeUndefined();
  });

  it("TCV-SCHEMA takes what a builder draft holds", () => {
    const draft = withChange((cv) => {
      const [experience] = cv.experience;
      if (experience) {
        experience.startDate = "";
        experience.url = "acme.example";
        experience.current = true;
        experience.endDate = "2024-01";
      }
      const [language] = cv.languages;
      if (language) {
        language.proficiency = "";
      }
      cv.sectionOrder = ["experience", "summary"];
    });
    expect(CVDataSchema.parse(draft)).toEqual(draft);
  });

  it("TCV-SCHEMA fills fields older documents lack and drops unknown keys", () => {
    const { workType: _workType, ...experience } = SAMPLE.experience[0] ?? {
      workType: "",
    };
    const { volunteerTitle: _title, ...rest } = SAMPLE;
    const parsed = CVDataSchema.parse({
      ...rest,
      experience: [experience],
      legacyField: true,
    });
    expect(parsed.experience[0]?.workType).toBe("");
    expect(parsed.volunteerTitle).toBe(DEFAULT_SECTION_TITLES.volunteerTitle);
    expect("legacyField" in parsed).toBe(false);
  });

  it("TCV-SCHEMA output type is exactly CVData", () => {
    const outputIsCvData: Equals<z.output<typeof CVDataSchema>, CVData> = true;
    expect(outputIsCvData).toBe(true);
  });
});

describe("TCV-SCHEMA CVDataSchema rejects malformed documents", () => {
  it("TCV-SCHEMA rejects what is not a CV object", () => {
    for (const value of [null, "cv", 42, [], {}]) {
      expect(CVDataSchema.safeParse(value).success).toBe(false);
    }
  });

  it("TCV-SCHEMA rejects a missing or wrongly typed structure", () => {
    const { personalInfo: _personalInfo, ...noPersonalInfo } = SAMPLE;
    expect(issuePaths(noPersonalInfo)).toContain("personalInfo");
    expect(issuePaths({ ...SAMPLE, experience: "none" })).toContain(
      "experience"
    );
    expect(issuePaths({ ...SAMPLE, summary: ["a"] })).toContain("summary");
    expect(
      issuePaths(
        withChange((cv) => {
          (cv.skills[0] as { items: unknown }).items = "TypeScript";
        })
      )
    ).toContain("skills.0.items");
    expect(
      issuePaths(
        withChange((cv) => {
          (cv.experience[1] as { current: unknown }).current = "yes";
        })
      )
    ).toContain("experience.1.current");
  });

  it("TCV-SCHEMA rejects unknown sections, templates and visibilities", () => {
    expect(
      issuePaths({ ...SAMPLE, sectionOrder: ["summary", "hobbies"] })
    ).toContain("sectionOrder.1");
    expect(issuePaths({ ...SAMPLE, style: "fancy" })).toContain("style");
    expect(issuePaths({ ...SAMPLE, visibility: "secret" })).toContain(
      "visibility"
    );
    expect(
      issuePaths(
        withChange((cv) => {
          (cv.experience[0] as { workType: unknown }).workType = "freelance";
        })
      )
    ).toContain("experience.0.workType");
  });

  it("TCV-SCHEMA rejects a section listed twice", () => {
    expect(
      issuePaths({ ...SAMPLE, sectionOrder: ["summary", "summary"] })
    ).toContain("sectionOrder");
  });

  it("TCV-SCHEMA rejects entries without an id or with a repeated id", () => {
    expect(
      issuePaths(
        withChange((cv) => {
          (cv.projects[0] as { id: unknown }).id = "";
        })
      )
    ).toContain("projects.0.id");
    expect(
      issuePaths(
        withChange((cv) => {
          const [first, second] = cv.certificates;
          if (first && second) {
            second.id = first.id;
          }
        })
      )
    ).toContain("certificates");
  });
});

describe("TCV-SCHEMA entry inputs keep the MCP tools' rules", () => {
  const experience = {
    company: "Acme",
    title: "Engineer",
    startDate: "2024-03",
    description: "Built things",
  };

  it("TCV-SCHEMA fills an experience input's defaults", () => {
    expect(experienceSchema.parse(experience)).toEqual({
      ...experience,
      url: "",
      workType: "",
      locationPolicy: "",
      endDate: "",
      current: false,
    });
  });

  it("TCV-SCHEMA refuses an end date on a current role", () => {
    const result = experienceSchema.safeParse({
      ...experience,
      current: true,
      endDate: "2024-05",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["endDate"]);
  });

  it("TCV-SCHEMA checks dates, links and proficiencies", () => {
    expect(dateField.safeParse("2024-13").success).toBe(false);
    expect(dateField.safeParse("2024-03").success).toBe(true);
    expect(optionalUrl.safeParse("acme.example").success).toBe(false);
    expect(optionalUrl.parse(undefined)).toBe("");
    expect(
      languageSchema.safeParse({ language: "Indonesian", proficiency: "Good" })
        .success
    ).toBe(false);
  });
});
