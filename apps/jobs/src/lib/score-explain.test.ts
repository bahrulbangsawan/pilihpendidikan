import { describe, expect, it } from "vitest";
import { explainScore } from "../../../api/src/jobs/services/scoring/explain";
import { getT } from "@/i18n";
import { makeScoreRecord } from "@/test/fixtures-rest";
import { explainScoreLines, scoreComponentsOf } from "./score-explain";

describe("TW-INBOX score explanations mirror the api templates (07 §5)", () => {
  it("TW-INBOX renders the same lines as the api in en and id", () => {
    const record = makeScoreRecord("pst_01JA0000000000000000000000");
    const components = scoreComponentsOf(record.components);
    expect(components).not.toBeNull();
    if (!components) {
      return;
    }
    const variants = [
      components,
      {
        ...components,
        score: 52,
        gates: [
          {
            predicate: "requires_degree_user_lacks" as const,
            level: "possible" as const,
            probability: 0.6,
            multiplier: 0.85,
          },
        ],
        features: {
          ...components.features,
          skills_overlap: {
            value: 0.2,
            matched: ["react"],
            missing: ["go", "rust", "k8s", "terraform", "aws"],
            weight: 0.25,
          },
          salary_fit: {
            value: 0.5,
            posting_max_yearly: 1,
            floor_yearly: 2,
            currency: "IDR",
            weight: 0.05,
          },
        },
        ai: { ...components.ai, status: "budget" as const, overall_fit: null },
      },
    ];
    for (const locale of ["en", "id"] as const) {
      for (const entry of variants) {
        expect(explainScoreLines(getT(locale), entry).join("\n")).toBe(
          explainScore(entry, locale)
        );
      }
    }
  });

  it("TW-INBOX a queued score has no components to explain", () => {
    expect(scoreComponentsOf({})).toBeNull();
  });
});
