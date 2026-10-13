import { describe, expect, it } from "bun:test";
import { ScoringProfileSchema } from "@pilihpendidikan/jobs-contracts/scoring";
import { profileYaml, scoreRequest } from "../../ai/compose";
import { decisionsBody } from "../../ai/openai";
import { postingView } from "./engine";
import { NOW, postingOf, sampleCv } from "./fixtures.test";
import {
  aiProfileView,
  buildScoringProfile,
  cleanRoleTitle,
  educationFieldOf,
  educationLevelOf,
  isThinProfile,
  unionYears,
} from "./profile";

const IDENTITY_FACTS = [
  { key: "contact.full_name", value: "Sari Wulandari" },
  { key: "contact.email", value: "sari.wulandari@example.com" },
  { key: "contact.phone", value: "+62 812-5555-0101" },
  { key: "contact.location", value: "Jl. Kenanga 12, Bandung" },
  { key: "links.github", value: "https://github.com/sari-example" },
  { key: "profile.primary_cv_id", value: "sari-cv-1" },
  {
    key: "prefs.target_titles",
    value: ["Backend Engineer", "Platform Engineer"],
  },
  { key: "prefs.locations", value: [{ country_code: "ID", city: "Bandung" }] },
  { key: "prefs.workplace_types", value: ["remote", "hybrid"] },
  {
    key: "prefs.min_salary",
    value: { amount: 15_000_000, currency: "IDR", period: "month" },
  },
  { key: "work_auth.ID", value: { status: "citizen" } },
  { key: "work_auth.SG", value: { status: "needs_sponsorship" } },
  { key: "skills.extra", value: ["Kafka", "Terraform"] },
];

const IDENTITY_STRINGS = [
  "Sari",
  "Wulandari",
  "sari.wulandari",
  "example.com",
  "5555",
  "Kenanga",
  "linkedin.com/in",
  "github.com",
  "photo-sari",
  "Kopi Kenangan",
  "Startup Rahasia",
  "Universitas Contoh",
  "Tokopedia",
  "sari-cv-1",
  "usr_",
];

function build(sensitive = true) {
  const profile = buildScoringProfile({
    cv: sampleCv(),
    facts: IDENTITY_FACTS,
    yearsAnswers: [{ question_key: "years_experience.go", answer: "2" }],
    now: NOW,
    profileVersion: 42,
  });
  return { profile, ai: aiProfileView(profile, sensitive) };
}

describe("T7-04 the Decisions request carries no identity or PII (07 §2.1, §8)", () => {
  it("T7-04 the profile built from a CV full of identity data holds none of it", () => {
    const { profile } = build();
    const text = JSON.stringify(profile);
    for (const needle of IDENTITY_STRINGS) {
      expect(text).not.toContain(needle);
    }
    expect(ScoringProfileSchema.parse(profile)).toEqual(profile);
    expect(profile).toMatchObject({
      profile_version: 42,
      target_titles: ["Backend Engineer", "Platform Engineer"],
      education: [{ level: "bachelor", field: "computer science" }],
      locations: [{ country_code: "ID", city: "Bandung" }],
      workplace_prefs: ["remote", "hybrid"],
      work_authorization: [
        { country_code: "ID", status: "citizen" },
        { country_code: "SG", status: "needs_sponsorship" },
      ],
      salary_floor: { amount: 15_000_000, currency: "IDR", period: "month" },
    });
    expect(profile.experience_digest.map((role) => role.title)).toEqual([
      "Backend Engineer",
      "Software Engineer",
    ]);
    expect(profile.skills).toEqual(
      expect.arrayContaining([
        "python",
        "postgresql",
        "kafka",
        "terraform",
        "go",
      ])
    );
  });

  it("T7-04 the exact request body sent to /v1/decisions contains no name, email, phone, links, employer, school or ids", () => {
    const { ai } = build();
    const request = scoreRequest({
      askSensitive: true,
      profile: ai,
      posting: postingView(postingOf()),
    });
    const body = JSON.stringify(decisionsBody(request));
    for (const needle of IDENTITY_STRINGS) {
      expect(body).not.toContain(needle);
    }
    expect(body).toContain("CANDIDATE PROFILE (structured, no identity)");
    expect(body).toContain("requires_unavailable_work_authorization");
    expect(Object.keys(decisionsBody(request)).sort()).toEqual([
      "input",
      "model",
      "questions",
    ]);
  });

  it("T7-04 with sensitive matching off, work authorization and salary are omitted and the predicate is not asked", () => {
    const { ai } = build(false);
    expect(ai.work_authorization).toEqual([]);
    expect(ai.salary_floor).toBeUndefined();
    const request = scoreRequest({
      askSensitive: false,
      profile: ai,
      posting: postingView(postingOf()),
    });
    const body = JSON.stringify(decisionsBody(request));
    expect(body).not.toContain("requires_unavailable_work_authorization");
    expect(body).not.toContain("needs_sponsorship");
    expect(body).not.toContain("15000000");
    expect(request.questions.map((q) => q.name)).toEqual([
      "overall_fit",
      "requires_degree_user_lacks",
      "requires_onsite_outside_user_locations",
    ]);
  });

  it("T7-04 the posting view sends no URLs, ids or HTML and the profile is compact YAML", () => {
    const view = postingView(postingOf());
    expect(Object.keys(view).sort()).toEqual(
      [
        "department",
        "description_text",
        "employment_type",
        "locations",
        "requirements",
        "seniority",
        "title",
        "workplace_type",
      ].sort()
    );
    const yaml = profileYaml(build().ai);
    expect(yaml).toContain(
      "target_titles: [Backend Engineer, Platform Engineer]"
    );
    expect(yaml).not.toContain("profile_version");
  });
});

describe("ScoringProfile builder (07 §2.1)", () => {
  it("derives years from merged intervals and seniority from years or the latest title", () => {
    const year = Date.UTC(2021, 0, 1);
    expect(
      unionYears([
        { start: year, end: year + 365.25 * 864e5 },
        { start: year + 100 * 864e5, end: year + 200 * 864e5 },
      ])
    ).toBe(1);
    const fresh = buildScoringProfile({
      cv: sampleCv({
        experience: [
          {
            ...sampleCv().experience[0],
            title: "Data Intern",
            workType: "internship",
            startDate: "2026-06",
            current: true,
          },
        ],
      }),
      facts: [],
      yearsAnswers: [],
      now: NOW,
      profileVersion: 1,
    });
    expect(fresh.seniority).toBe("intern");
    expect(fresh.target_titles).toEqual(["Backend Engineer"]);
    const told = buildScoringProfile({
      cv: null,
      facts: [],
      yearsAnswers: [{ question_key: "years_experience.total", answer: "12" }],
      now: NOW,
      profileVersion: 1,
    });
    expect(told).toMatchObject({
      years_experience_total: 12,
      seniority: "lead",
    });
    expect(isThinProfile(told)).toBe(true);
    expect(isThinProfile(build().profile)).toBe(false);
  });

  it("keeps education level and field, never the school", () => {
    expect(educationLevelOf("S1 Teknik Informatika", "university")).toBe(
      "bachelor"
    );
    expect(educationLevelOf("MSc Data Science", "")).toBe("master");
    expect(educationLevelOf("PhD Physics", "")).toBe("doctorate");
    expect(educationLevelOf("D3 Akuntansi", "polytechnic")).toBe("diploma");
    expect(educationLevelOf("SMA IPA", "school")).toBe("secondary");
    expect(
      educationFieldOf("BSc Computer Science - Institut Teknologi Contoh")
    ).toBe("computer science");
    expect(cleanRoleTitle("Engineer @ Gojek Contoh | Payments")).toBe(
      "Engineer"
    );
  });

  it("falls back to CV languages and to authorized countries when no preference is set", () => {
    const profile = buildScoringProfile({
      cv: sampleCv(),
      facts: [{ key: "work_auth.MY", value: { status: "permanent_resident" } }],
      yearsAnswers: [],
      now: NOW,
      profileVersion: 1,
    });
    expect(profile.languages).toEqual([
      { code: "id", level: "native" },
      { code: "en", level: "fluent" },
    ]);
    expect(profile.locations).toEqual([{ country_code: "MY" }]);
  });
});
