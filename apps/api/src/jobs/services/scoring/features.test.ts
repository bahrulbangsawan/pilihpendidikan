import { describe, expect, it } from "bun:test";
import {
  computeFeatures,
  freshness,
  languageFit,
  locationFit,
  salaryFit,
  seniorityFit,
  skillsOverlap,
  titleSimilarity,
  yearlyIn,
} from "./features";
import { DAY, NOW, postingOf, profileOf } from "./fixtures.test";
import {
  canonicalUserSkills,
  extractSkillTerms,
  languageRequirements,
  parsePlace,
  postingSkillWeights,
  seniorityFromText,
  titleFamilyIds,
  titleTokens,
} from "./text";

describe("T7-01 F1 skills_overlap (synonyms, required doubling, nulls)", () => {
  it("T7-01 normalizes synonyms through the skills dictionary", () => {
    expect(
      [
        ...extractSkillTerms(
          "JS/TS, React.js, Postgres, k8s, golang and CI/CD."
        ),
      ].sort()
    ).toEqual(
      [
        "ci/cd",
        "go",
        "javascript",
        "kubernetes",
        "postgresql",
        "react",
        "typescript",
      ].sort()
    );
    expect(
      canonicalUserSkills(["JS", "Postgres", "Node.js", "Leadership"]).sort()
    ).toEqual(["javascript", "leadership", "node.js", "postgresql"].sort());
  });

  it("T7-01 only counts everyday words written like a technology (Go, C, R, Excel)", () => {
    const terms = extractSkillTerms(
      "Go-getter who can go the extra mile and excel at sales."
    );
    expect(terms.has("go")).toBe(false);
    expect(terms.has("excel")).toBe(false);
    expect([...extractSkillTerms("Languages: Go, C and R.")].sort()).toEqual([
      "c",
      "go",
      "r",
    ]);
    expect(
      [...extractSkillTerms("Advanced Excel and Spring Boot")].sort()
    ).toEqual(["excel", "spring boot"]);
  });

  it("T7-01 counts must/required terms double and nice-to-haves once", () => {
    const weights = postingSkillWeights(
      ["Must know Python", "Nice to have: Docker (required)"],
      "Experience with Kafka is a plus. Required: Terraform."
    );
    expect(Object.fromEntries(weights)).toEqual({
      python: 2,
      docker: 1,
      kafka: 1,
      terraform: 2,
    });
  });

  it("T7-01 golden vector: python and postgresql (double), aws, kubernetes (double) give 5 of 7", () => {
    const value = skillsOverlap(profileOf(), postingOf());
    expect(value).toEqual({
      value: 0.7143,
      matched: ["postgresql", "python", "aws"],
      missing: ["kubernetes"],
      weight: 0.25,
    });
  });

  it("T7-01 uses max(3, |S_req|) as the denominator and null when either side is empty", () => {
    const one = skillsOverlap(
      profileOf(),
      postingOf({ requirements: ["Python"], description_text: "" })
    );
    expect(one?.value).toBeCloseTo(1 / 3, 4);
    expect(
      skillsOverlap(
        profileOf(),
        postingOf({ requirements: [], description_text: "A friendly team." })
      )
    ).toBeNull();
    expect(
      skillsOverlap(
        profileOf({ skills: [], experience_digest: [] }),
        postingOf()
      )
    ).toBeNull();
  });
});

describe("T7-01 F2 title_similarity", () => {
  it("T7-01 strips seniority words and boosts title-family matches to 1.0", () => {
    expect(titleTokens("Senior Backend Engineer, Payments (Remote)")).toEqual([
      "backend",
      "engineer",
      "payments",
    ]);
    expect([...titleFamilyIds("Sr. Backend Developer")]).toEqual([
      "software_engineering",
    ]);
    expect(
      titleSimilarity(
        profileOf({ target_titles: ["Software Engineer"] }),
        postingOf({ title: "Backend Developer" })
      )
    ).toEqual({
      value: 1,
      best_target: "Software Engineer",
      weight: 0.15,
    });
  });

  it("T7-01 falls back to token-set Jaccard and takes the best target", () => {
    const value = titleSimilarity(
      profileOf({ target_titles: ["Data Analyst", "Platform Specialist"] }),
      postingOf({ title: "Senior Platform Reliability Specialist" })
    );
    expect(value?.best_target).toBe("Platform Specialist");
    expect(value?.value).toBeCloseTo(2 / 3, 4);
    expect(
      titleSimilarity(profileOf({ target_titles: [] }), postingOf())
    ).toBeNull();
  });
});

describe("T7-01 F3 location_fit", () => {
  const here = profileOf({
    locations: [{ country_code: "ID", city: "Bandung" }],
  });

  it("T7-01 remote in a user country, remote anywhere and remote elsewhere", () => {
    expect(locationFit(here, postingOf())).toMatchObject({
      value: 1,
      reason: "remote_in_country",
    });
    expect(locationFit(here, postingOf({ locations: [] }))).toMatchObject({
      value: 1,
      reason: "remote_anywhere",
    });
    expect(
      locationFit(
        here,
        postingOf({
          locations: [{ raw: "Remote (US only)", country_code: "US" }],
        })
      )
    ).toMatchObject({ value: 0, reason: "remote_outside_region" });
  });

  it("T7-01 location match 1.0, hybrid in the same country another city 0.5, else 0, unknown null", () => {
    const onsite = (raw: string, workplace: string) =>
      postingOf({ workplace_type: workplace, locations: [{ raw }] });
    expect(
      locationFit(here, onsite("Bandung, Indonesia", "onsite"))
    ).toMatchObject({ value: 1, reason: "location_match" });
    expect(
      locationFit(here, onsite("Jakarta, Indonesia", "hybrid"))
    ).toMatchObject({ value: 0.5, reason: "hybrid_same_country" });
    expect(
      locationFit(here, onsite("Jakarta, Indonesia", "onsite"))
    ).toMatchObject({ value: 0, reason: "outside_locations" });
    expect(locationFit(here, onsite("Singapore", "onsite"))).toMatchObject({
      value: 0,
    });
    expect(
      locationFit(here, postingOf({ workplace_type: "onsite", locations: [] }))
    ).toBeNull();
    expect(locationFit(profileOf({ locations: [] }), postingOf())).toBeNull();
    expect(parsePlace("Jakarta, Indonesia")).toEqual({
      city: "jakarta",
      country_code: "ID",
    });
  });
});

describe("T7-01 F4–F7", () => {
  it("T7-01 F4 seniority: 1 − 0.35·|Δ| floored at 0, null when unknown", () => {
    expect(
      seniorityFit(
        profileOf({ seniority: "mid" }),
        postingOf({ title: "Senior Backend Engineer" })
      )
    ).toEqual({
      value: 0.65,
      posting: "senior",
      user: "mid",
      weight: 0.1,
    });
    expect(
      seniorityFit(
        profileOf({ seniority: "intern" }),
        postingOf({ title: "Principal Engineer" })
      )?.value
    ).toBe(0);
    expect(
      seniorityFit(
        profileOf({ seniority: "senior" }),
        postingOf({ seniority: "senior", title: "Engineer" })
      )?.value
    ).toBe(1);
    expect(
      seniorityFit(profileOf(), postingOf({ title: "Backend Engineer" }))
    ).toBeNull();
    expect(
      seniorityFit(profileOf({ seniority: "unknown" }), postingOf())
    ).toBeNull();
    expect([
      seniorityFromText("Software Engineer II"),
      seniorityFromText("Staff Engineer"),
      seniorityFromText("Magang Data"),
    ]).toEqual(["mid", "lead", "intern"]);
  });

  it("T7-01 F5 salary: yearly in the posting currency with the static FX table, linear 0.7–1.0 of the floor", () => {
    const floor = profileOf({
      salary_floor: { amount: 15_000_000, currency: "IDR", period: "month" },
    });
    const pay = (max: number) =>
      postingOf({ salary: { max, currency: "IDR", period: "month" } });
    expect(salaryFit(floor, pay(16_000_000))).toMatchObject({
      value: 1,
      floor_yearly: 180_000_000,
      posting_max_yearly: 192_000_000,
      currency: "IDR",
    });
    expect(salaryFit(floor, pay(12_750_000))?.value).toBeCloseTo(0.5, 4);
    expect(salaryFit(floor, pay(10_000_000))?.value).toBe(0);
    const usd = salaryFit(
      floor,
      postingOf({ salary: { min: 20_000, currency: "USD", period: "year" } })
    );
    expect(usd?.currency).toBe("USD");
    expect(usd?.value).toBeCloseTo(1, 4);
    expect(yearlyIn(10, "hour", "USD", "USD")).toBe(20_800);
    expect(
      salaryFit(floor, postingOf({ salary: { raw: "competitive" } }))
    ).toBeNull();
    expect(
      salaryFit(profileOf({ salary_floor: undefined }), pay(1))
    ).toBeNull();
    expect(
      salaryFit(floor, postingOf({ salary: { max: 5, currency: "XYZ" } }))
    ).toBeNull();
  });

  it("T7-01 F6 languages: all required met → 1, any missing → 0, none required → null", () => {
    expect(
      Object.fromEntries(
        languageRequirements(
          ["Fluent in Japanese", "Excellent written English"],
          "Mandarin is a plus."
        )
      )
    ).toEqual({
      ja: "fluent",
      en: "fluent",
    });
    expect(
      languageFit(
        profileOf(),
        postingOf({
          requirements: ["Fluent English", "Bahasa Indonesia (native)"],
        })
      )
    ).toEqual({
      value: 1,
      required: ["en", "id"],
      missing: [],
      weight: 0.05,
    });
    expect(
      languageFit(
        profileOf(),
        postingOf({ requirements: ["Business-level Japanese is required"] })
      )
    ).toMatchObject({ value: 0, missing: ["ja"] });
    expect(
      languageFit(
        profileOf(),
        postingOf({
          requirements: ["Python"],
          description_text: "English team.",
        })
      )
    ).toBeNull();
  });

  it("T7-01 F7 freshness: 1.0 to 7 days, linear to 0.3 at 45 days, posted_at before first_seen_at", () => {
    const at = (days: number) => {
      const result = freshness(
        { posted_at: NOW - days * DAY, first_seen_at: NOW },
        NOW
      );
      if (!result) {
        throw new Error("freshness is never null");
      }
      return result;
    };
    expect(at(0)).toEqual({ value: 1, age_days: 0, weight: 0.05 });
    expect(at(7).value).toBe(1);
    expect(at(26).value).toBeCloseTo(0.65, 4);
    expect(at(45).value).toBe(0.3);
    expect(at(400).value).toBe(0.3);
    expect(
      freshness({ posted_at: null, first_seen_at: NOW - 10 * DAY }, NOW)
        ?.age_days
    ).toBe(10);
  });

  it("T7-01 computes all seven features for one pair (golden)", () => {
    const features = computeFeatures(profileOf(), postingOf(), NOW);
    expect(features).toEqual({
      skills_overlap: {
        value: 0.7143,
        matched: ["postgresql", "python", "aws"],
        missing: ["kubernetes"],
        weight: 0.25,
      },
      title_similarity: {
        value: 1,
        best_target: "Backend Engineer",
        weight: 0.15,
      },
      location_fit: { value: 1, reason: "remote_in_country", weight: 0.15 },
      seniority_fit: {
        value: 0.65,
        posting: "senior",
        user: "mid",
        weight: 0.1,
      },
      salary_fit: null,
      language_fit: null,
      freshness: { value: 1, age_days: 3, weight: 0.05 },
    });
  });
});
