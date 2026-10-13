// Shared synthetic fixtures for the scoring tests (no real person's data).
import type { CVData } from "@pilihpendidikan/cv-engine/types";
import type { ScoringProfile } from "@pilihpendidikan/jobs-contracts/scoring";
import type { PostingForScoring } from "./features";

export const NOW = Date.UTC(2026, 9, 12);
export const DAY = 86_400_000;

/** A CV full of identity data that must never reach the AI. */
export function sampleCv(overrides: Partial<CVData> = {}): CVData {
  return {
    style: "basic",
    personalInfo: {
      fullName: "Sari Wulandari",
      jobTitle: "Backend Engineer",
      email: "sari.wulandari@example.com",
      phone: "+62 812-5555-0101",
      location: "Jl. Kenanga 12, Bandung",
      linkedIn: "https://linkedin.com/in/sari-wulandari-example",
      photoUrl: "https://example.com/photo-sari.jpg",
      usePhoto: true,
    },
    sectionOrder: ["summary", "experience", "education", "skills", "languages"],
    summaryTitle: "Summary",
    summary: "Backend engineer at Tokopedia Contoh building payment APIs.",
    experienceTitle: "Experience",
    experience: [
      {
        id: "exp-1",
        company: "Kopi Kenangan Contoh",
        url: "https://kopi.example.com",
        title: "Backend Engineer at Kopi Kenangan Contoh",
        workType: "full-time",
        locationPolicy: "hybrid",
        startDate: "2023-01",
        endDate: "",
        current: true,
        description: "Built Python and PostgreSQL services on AWS with Docker.",
      },
      {
        id: "exp-2",
        company: "Startup Rahasia",
        url: "",
        title: "Software Engineer",
        workType: "full-time",
        locationPolicy: "work-from-office",
        startDate: "2021-01",
        endDate: "2022-12",
        current: false,
        description: "Node.js and React features; Redis caching.",
      },
    ],
    educationTitle: "Education",
    education: [
      {
        id: "edu-1",
        category: "university",
        institution: "Universitas Contoh Bandung",
        degree: "Bachelor of Computer Science, Universitas Contoh Bandung",
        gpa: "3.8",
        startDate: "2016-08",
        endDate: "2020-07",
        current: false,
      },
    ],
    skillsTitle: "Skills",
    skills: [
      {
        id: "s1",
        name: "Backend",
        items: ["Python", "PostgreSQL", "AWS", "Docker"],
      },
      { id: "s2", name: "Web", items: ["JS", "Node.js", "React"] },
    ],
    awardsTitle: "Awards",
    awards: [],
    certificatesTitle: "Certificates",
    certificates: [],
    languagesTitle: "Languages",
    languages: [
      { id: "l1", language: "Indonesian", proficiency: "Native" },
      { id: "l2", language: "English", proficiency: "Fluent" },
    ],
    projectsTitle: "Projects",
    projects: [],
    volunteerTitle: "Volunteer",
    volunteer: [],
    ...overrides,
  };
}

/** A complete synthetic profile (features tests). */
export function profileOf(
  overrides: Partial<ScoringProfile> = {}
): ScoringProfile {
  return {
    profile_version: 7,
    target_titles: ["Backend Engineer"],
    seniority: "mid",
    years_experience_total: 3.8,
    skills: [
      "python",
      "postgresql",
      "aws",
      "docker",
      "javascript",
      "node.js",
      "react",
    ],
    experience_digest: [
      {
        title: "Backend Engineer",
        years: 3.8,
        keywords: ["python", "postgresql"],
      },
    ],
    education: [{ level: "bachelor", field: "computer science" }],
    languages: [
      { code: "id", level: "native" },
      { code: "en", level: "fluent" },
    ],
    locations: [{ country_code: "ID", city: "Bandung" }],
    workplace_prefs: ["remote", "hybrid"],
    work_authorization: [{ country_code: "ID", status: "citizen" }],
    salary_floor: { amount: 15_000_000, currency: "IDR", period: "month" },
    ...overrides,
  };
}

let counter = 0;

/** A synthetic posting (features tests). */
export function postingOf(
  overrides: Partial<PostingForScoring> = {}
): PostingForScoring {
  counter += 1;
  return {
    id: `pst_01JA6V8M3W8Z1T6Q4Y2B7K9${String(counter).padStart(3, "0")}`,
    revision: 1,
    title: "Senior Backend Engineer",
    department: "Engineering",
    seniority: null,
    locations: [{ raw: "Remote - Indonesia", country_code: "ID" }],
    workplace_type: "remote",
    employment_type: "full_time",
    salary: null,
    requirements: [
      "Must have strong Python and PostgreSQL experience",
      "Experience with AWS",
      "Kubernetes is required",
    ],
    description_text: "We build payment APIs.",
    posted_at: NOW - 3 * DAY,
    first_seen_at: NOW - 3 * DAY,
    ...overrides,
  };
}
