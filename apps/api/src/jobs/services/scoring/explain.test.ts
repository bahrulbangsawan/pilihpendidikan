import { describe, expect, it } from "bun:test";
import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import type { ScoreComponents } from "@pilihpendidikan/jobs-contracts/scoring";
import { AI_COMPONENT_STATUSES } from "@pilihpendidikan/jobs-contracts/scoring";
import { EXPLANATION_STRINGS, explainScore } from "./explain";

const BASE: ScoreComponents = {
  rubric_version: "r1",
  features: {
    skills_overlap: {
      value: 0.67,
      matched: ["python", "postgresql", "aws"],
      missing: ["kubernetes"],
      weight: 0.25,
    },
    title_similarity: {
      value: 0.8,
      best_target: "Backend Engineer",
      weight: 0.15,
    },
    location_fit: { value: 1, reason: "remote_in_country", weight: 0.15 },
    seniority_fit: { value: 0.65, posting: "senior", user: "mid", weight: 0.1 },
    salary_fit: null,
    language_fit: null,
    freshness: { value: 1, age_days: 3, weight: 0.05 },
  },
  ai: {
    status: "ok",
    overall_fit: { score: 2.9, confidence: 0.71 },
    weight: 0.2,
    predicates: {
      requires_unavailable_work_authorization: 0.04,
      requires_degree_user_lacks: 0.12,
      requires_onsite_outside_user_locations: 0.02,
    },
    refused: [],
  },
  gates: [],
  base: 0.78,
  score: 78,
};

function variant(patch: (c: ScoreComponents) => void): ScoreComponents {
  const copy = structuredClone(BASE);
  patch(copy);
  return copy;
}

const LOCALES: Locale[] = ["en", "id"];

describe("T7-12 deterministic explanations in en and id (07 §5)", () => {
  it("T7-12 renders the 07 §5 example exactly in English", () => {
    expect(explainScore(BASE, "en")).toBe(
      [
        "78 · Good match",
        "✓ Skills: python, postgresql, aws (3 of 4 required)   ✗ Missing: kubernetes",
        '✓ Title close to your target "Backend Engineer"',
        "✓ Remote within your country",
        "~ Seniority: posting senior, you mid",
        "AI fit: good (confidence 71%)",
      ].join("\n")
    );
  });

  it("T7-12 renders the same structure in Indonesian", () => {
    expect(explainScore(BASE, "id")).toBe(
      [
        "78 · Cocok",
        "✓ Keahlian: python, postgresql, aws (3 dari 4 yang diminta)   ✗ Belum ada: kubernetes",
        '✓ Jabatan mirip target Anda "Backend Engineer"',
        "✓ Remote di negara Anda",
        "~ Senioritas: lowongan senior, Anda menengah",
        "Kecocokan AI: baik (keyakinan 71%)",
      ].join("\n")
    );
  });

  it("T7-12 is deterministic and has a template for every AI status in both locales", () => {
    for (const locale of LOCALES) {
      expect(explainScore(BASE, locale)).toBe(
        explainScore(structuredClone(BASE), locale)
      );
      const lines = new Set<string>();
      for (const status of AI_COMPONENT_STATUSES) {
        const text = explainScore(
          variant((c) => {
            c.ai.status = status;
          }),
          locale
        );
        const last = text.split("\n").at(-1) ?? "";
        expect(last.length).toBeGreaterThan(5);
        lines.add(last);
      }
      expect(lines.size).toBe(AI_COMPONENT_STATUSES.length);
    }
    expect(
      explainScore(
        variant((c) => {
          c.ai.status = "budget";
        }),
        "en"
      )
    ).toEndWith("AI matching paused for this month");
    expect(
      explainScore(
        variant((c) => {
          c.ai.status = "dlq";
        }),
        "en"
      )
    ).toEndWith("AI off: deterministic score only");
    expect(
      explainScore(
        variant((c) => {
          c.ai.overall_fit = null;
          c.ai.refused = ["overall_fit"];
        }),
        "en"
      )
    ).toEndWith("AI declined to assess");
    expect(
      explainScore(
        variant((c) => {
          if (c.ai.overall_fit) {
            c.ai.overall_fit.confidence = null;
          }
        }),
        "id"
      )
    ).toEndWith("Kecocokan AI: baik");
  });

  it("T7-12 puts blocking and possible gates first, blocking before possible", () => {
    const gated = variant((c) => {
      c.gates = [
        {
          predicate: "requires_degree_user_lacks",
          level: "possible",
          probability: 0.6,
          multiplier: 0.85,
        },
        {
          predicate: "requires_unavailable_work_authorization",
          level: "blocking",
          probability: 0.9,
          multiplier: 0.2,
        },
        {
          predicate: "requires_onsite_outside_user_locations",
          level: "possible",
          probability: 0.7,
          multiplier: 0.85,
        },
      ];
    });
    const en = explainScore(gated, "en").split("\n");
    expect(en.slice(1, 4)).toEqual([
      "⚠ Blocker: posting requires a work authorization you have not listed",
      "⚠ Possible blocker: posting requires a degree you have not listed",
      "⚠ Possible blocker: posting is on-site outside your locations",
    ]);
    const id = explainScore(gated, "id").split("\n");
    expect(id[1]).toBe(
      "⚠ Penghalang: lowongan mensyaratkan izin kerja yang belum Anda cantumkan"
    );
  });

  it("T7-12 covers every feature state in both locales", () => {
    const cases: [string, (c: ScoreComponents) => void, string, string][] = [
      [
        "skills weak",
        (c) => {
          c.features.skills_overlap = {
            value: 0.2,
            matched: ["aws"],
            missing: ["go", "rust", "c", "c++", "java"],
            weight: 0.25,
          };
        },
        "~ Skills: aws (1 of 6 required)   ✗ Missing: go, rust, c, c++, +1 more",
        "~ Keahlian: aws (1 dari 6 yang diminta)   ✗ Belum ada: go, rust, c, c++, +1 lainnya",
      ],
      [
        "skills none",
        (c) => {
          c.features.skills_overlap = {
            value: 0,
            matched: [],
            missing: ["go"],
            weight: 0.25,
          };
        },
        "✗ Skills: none of the 1 required   ✗ Missing: go",
        "✗ Keahlian: tidak ada dari 1 yang diminta   ✗ Belum ada: go",
      ],
      [
        "skills unknown",
        (c) => {
          c.features.skills_overlap = null;
        },
        "· Skills not compared (none listed in the posting or your profile)",
        "· Keahlian tidak dibandingkan (tidak ada di lowongan atau profil Anda)",
      ],
      [
        "title exact",
        (c) => {
          c.features.title_similarity = {
            value: 1,
            best_target: "Backend Engineer",
            weight: 0.15,
          };
        },
        '✓ Title matches your target "Backend Engineer"',
        '✓ Jabatan sesuai target Anda "Backend Engineer"',
      ],
      [
        "title partial",
        (c) => {
          c.features.title_similarity = {
            value: 0.25,
            best_target: "Data Engineer",
            weight: 0.15,
          };
        },
        '~ Title partly matches your target "Data Engineer"',
        '~ Jabatan sebagian mirip target Anda "Data Engineer"',
      ],
      [
        "title differs",
        (c) => {
          c.features.title_similarity = {
            value: 0,
            best_target: "Designer",
            weight: 0.15,
          };
        },
        "✗ Title differs from your target titles",
        "✗ Jabatan berbeda dari target Anda",
      ],
      [
        "title none",
        (c) => {
          c.features.title_similarity = null;
        },
        "· No target titles set",
        "· Belum ada target jabatan",
      ],
      [
        "remote anywhere",
        (c) => {
          c.features.location_fit = {
            value: 1,
            reason: "remote_anywhere",
            weight: 0.15,
          };
        },
        "✓ Remote with no location limit",
        "✓ Remote tanpa batas lokasi",
      ],
      [
        "location match",
        (c) => {
          c.features.location_fit = {
            value: 1,
            reason: "location_match",
            weight: 0.15,
          };
        },
        "✓ Location matches your preferences",
        "✓ Lokasi sesuai preferensi Anda",
      ],
      [
        "hybrid",
        (c) => {
          c.features.location_fit = {
            value: 0.5,
            reason: "hybrid_same_country",
            weight: 0.15,
          };
        },
        "~ Hybrid in your country, another city",
        "~ Hybrid di negara Anda, kota lain",
      ],
      [
        "remote elsewhere",
        (c) => {
          c.features.location_fit = {
            value: 0,
            reason: "remote_outside_region",
            weight: 0.15,
          };
        },
        "✗ Remote only outside your countries",
        "✗ Remote hanya di luar negara Anda",
      ],
      [
        "outside",
        (c) => {
          c.features.location_fit = {
            value: 0,
            reason: "outside_locations",
            weight: 0.15,
          };
        },
        "✗ Location outside your preferences",
        "✗ Lokasi di luar preferensi Anda",
      ],
      [
        "seniority equal",
        (c) => {
          c.features.seniority_fit = {
            value: 1,
            posting: "mid",
            user: "mid",
            weight: 0.1,
          };
        },
        "✓ Seniority: posting mid, you mid",
        "✓ Senioritas: lowongan menengah, Anda menengah",
      ],
      [
        "seniority far",
        (c) => {
          c.features.seniority_fit = {
            value: 0.3,
            posting: "lead",
            user: "intern",
            weight: 0.1,
          };
        },
        "✗ Seniority: posting lead, you intern",
        "✗ Senioritas: lowongan lead, Anda magang",
      ],
      [
        "salary meets",
        (c) => {
          c.features.salary_fit = {
            value: 1,
            posting_max_yearly: 2,
            floor_yearly: 1,
            currency: "IDR",
            weight: 0.05,
          };
        },
        "✓ Salary meets your minimum",
        "✓ Gaji memenuhi batas minimum Anda",
      ],
      [
        "salary slightly",
        (c) => {
          c.features.salary_fit = {
            value: 0.4,
            posting_max_yearly: 1,
            floor_yearly: 1,
            currency: "IDR",
            weight: 0.05,
          };
        },
        "~ Salary slightly below your minimum",
        "~ Gaji sedikit di bawah batas minimum Anda",
      ],
      [
        "salary below",
        (c) => {
          c.features.salary_fit = {
            value: 0,
            posting_max_yearly: 1,
            floor_yearly: 2,
            currency: "IDR",
            weight: 0.05,
          };
        },
        "✗ Salary below your minimum",
        "✗ Gaji di bawah batas minimum Anda",
      ],
      [
        "languages met",
        (c) => {
          c.features.language_fit = {
            value: 1,
            required: ["en", "ja"],
            missing: [],
            weight: 0.05,
          };
        },
        "✓ Languages: EN, JA",
        "✓ Bahasa: EN, JA",
      ],
      [
        "language missing",
        (c) => {
          c.features.language_fit = {
            value: 0,
            required: ["en", "ja"],
            missing: ["ja"],
            weight: 0.05,
          };
        },
        "✗ Missing language: JA",
        "✗ Bahasa yang belum ada: JA",
      ],
      [
        "stale",
        (c) => {
          c.features.freshness = { value: 0.5, age_days: 30, weight: 0.05 };
        },
        "~ Posted 30 days ago",
        "~ Diposting 30 hari lalu",
      ],
    ];
    for (const [name, patch, en, id] of cases) {
      const components = variant(patch);
      expect({
        name,
        has: explainScore(components, "en").split("\n").includes(en),
      }).toEqual({ name, has: true });
      expect({
        name,
        has: explainScore(components, "id").split("\n").includes(id),
      }).toEqual({ name, has: true });
    }
    // Unknown salary / language / a fresh posting add no line.
    expect(explainScore(BASE, "en").split("\n")).toHaveLength(6);
  });

  it("T7-12 bands the headline: ≥ 80 strong, ≥ 60 good, ≥ 40 partial, else weak", () => {
    const head = (score: number, locale: Locale) =>
      explainScore(
        variant((c) => {
          c.score = score;
        }),
        locale
      ).split("\n")[0];
    expect([85, 60, 40, 12].map((s) => head(s, "en"))).toEqual([
      "85 · Strong match",
      "60 · Good match",
      "40 · Partial match",
      "12 · Weak match",
    ]);
    expect([85, 60, 40, 12].map((s) => head(s, "id"))).toEqual([
      "85 · Sangat cocok",
      "60 · Cocok",
      "40 · Cukup cocok",
      "12 · Kurang cocok",
    ]);
    expect(Object.keys(EXPLANATION_STRINGS).sort()).toEqual(["en", "id"]);
  });
});
