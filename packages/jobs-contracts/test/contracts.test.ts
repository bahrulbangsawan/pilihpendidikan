import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_COMMANDS,
  canonicalSkill,
  SKILLS_DICTIONARY,
  TITLE_FAMILIES,
  titleFamilyOf,
} from "../src/data";
import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  OAUTH_SCOPES,
  PAUSE_REASONS,
  STAGES,
  TASK_ERROR_CLASSES,
  TASK_ERROR_RETRY,
} from "../src/enums";
import {
  factKeySpec,
  isCanonicalFactKey,
  validateFactValue,
  workAuthKey,
} from "../src/facts";
import { normalizeText } from "../src/fingerprint";
import {
  combineScore,
  gateFor,
  R1_WEIGHTS,
  ScoreComponentsSchema,
  scoreBand,
} from "../src/scoring";
import { RECORD_EXAMPLES } from "./examples";

const SPEC = join(import.meta.dir, "..", "..", "..", "job-tracker-spec");
const spec = (name: string) => readFileSync(join(SPEC, name), "utf8");
const BACKTICKED = /`([a-z_:]+)`/g;
const SCOPE_CELL = /^\| ([^|]+)\|/gm;

describe("enums match the spec text", () => {
  test("TC-STAGE stages are the nine of 03 §5.1 in board order", () => {
    expect([...STAGES]).toEqual([
      "saved",
      "preparing",
      "ready",
      "applied",
      "interviewing",
      "offer",
      "accepted",
      "rejected",
      "withdrawn",
    ]);
  });

  test("TC-AGENT PAUSE_REASONS is exactly the canonical list of 03 §7.2", () => {
    const domain = spec("03-DOMAIN-MODEL.md");
    const block = domain.slice(
      domain.indexOf("values (the single list"),
      domain.indexOf("(`external_redirect`")
    );
    const listed = [...block.matchAll(BACKTICKED)].map((m) => m[1]);
    expect<string[]>([...PAUSE_REASONS].sort()).toEqual(
      [...new Set(listed)].sort() as string[]
    );
    expect(PAUSE_REASONS).toHaveLength(21);
  });

  test("TC-ROUNDTRIP OAuth scopes and error codes match 05 §1.2 / §1.3", () => {
    const api = spec("05-API-SPECIFICATION.md");
    const scopes = api.slice(
      api.indexOf("### 1.2 Scopes"),
      api.indexOf("Legacy credential mapping")
    );
    // A row may name two scopes ("`cv:read` / `cv:write`").
    const listed = [...scopes.matchAll(SCOPE_CELL)].flatMap((row) =>
      [...(row[1] ?? "").matchAll(BACKTICKED)].map((m) => m[1])
    );
    expect<string[]>([...OAUTH_SCOPES].sort()).toEqual(
      listed.sort() as string[]
    );
    const errors = api.slice(
      api.indexOf("### 1.3 Errors"),
      api.indexOf("### 1.4")
    );
    for (const line of errors.split("\n")) {
      const cells = line.split("|");
      const status = Number(cells[1]?.trim());
      if (cells.length > 3 && status >= 400) {
        for (const match of (cells[2] ?? "").matchAll(BACKTICKED)) {
          const code = match[1] as keyof typeof API_ERROR_STATUS;
          if (code in API_ERROR_STATUS) {
            expect<number>(API_ERROR_STATUS[code]).toBe(status);
          }
        }
      }
    }
    expect(API_ERROR_CODES).toHaveLength(25);
  });

  test("TC-STAGE every task error class has a retry policy", () => {
    for (const errorClass of TASK_ERROR_CLASSES) {
      expect(["yes", "once", "no", "n/a"]).toContain(
        TASK_ERROR_RETRY[errorClass]
      );
    }
  });
});

describe("facts (03 §9)", () => {
  test("TC-ROUNDTRIP canonical fact keys and their value schemas", () => {
    expect(isCanonicalFactKey("contact.email")).toBe(true);
    expect(isCanonicalFactKey("work_auth.ID")).toBe(true);
    expect(isCanonicalFactKey("experience[exp-1]")).toBe(true);
    expect(isCanonicalFactKey("contact.ssn")).toBe(false);
    expect(isCanonicalFactKey("work_auth.id")).toBe(false);
    expect(factKeySpec("work_auth.SG")?.sensitivity).toBe("protected");
    expect(validateFactValue("work_auth.ID", { status: "citizen" })).toEqual({
      ok: true,
    });
    expect(validateFactValue("work_auth.ID", { status: "alien" }).ok).toBe(
      false
    );
    expect(
      validateFactValue("links.github", "https://github.com/rahma")
    ).toEqual({ ok: true });
    expect(validateFactValue("links.github", "github").ok).toBe(false);
    expect(validateFactValue("nope", 1).ok).toBe(false);
    expect(workAuthKey("ID")).toBe("work_auth.ID");
    expect(() => workAuthKey("idn")).toThrow();
  });
});

describe("scoring (07)", () => {
  test("TC-ROUNDTRIP r1 weights sum to 1 and the stored components parse", () => {
    expect(Object.values(R1_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(
      1,
      10
    );
    expect(
      ScoreComponentsSchema.safeParse(RECORD_EXAMPLES.match_scores.components)
        .success
    ).toBe(true);
  });

  test("TC-ROUNDTRIP renormalization over non-null components and gate multipliers", () => {
    expect(combineScore({ skills_overlap: 1, title_similarity: 1 }).score).toBe(
      100
    );
    expect(combineScore({ skills_overlap: 0.5, salary_fit: null }).score).toBe(
      50
    );
    expect(combineScore({}).score).toBe(0);
    const gate = gateFor("requires_unavailable_work_authorization", 0.9);
    expect(gate).toEqual({
      predicate: "requires_unavailable_work_authorization",
      level: "blocking",
      probability: 0.9,
      multiplier: 0.2,
    });
    expect(gateFor("requires_degree_user_lacks", 0.6)?.multiplier).toBe(0.85);
    expect(gateFor("requires_degree_user_lacks", 0.49)).toBeNull();
    expect(combineScore({ skills_overlap: 1 }, gate ? [gate] : []).score).toBe(
      20
    );
    expect([
      scoreBand(80),
      scoreBand(79),
      scoreBand(59),
      scoreBand(null),
    ]).toEqual(["high", "medium", "low", "unscored"]);
  });
});

describe("data files", () => {
  test("TC-ROUNDTRIP skills dictionary has ≥ 150 normalized, unambiguous terms", () => {
    expect(SKILLS_DICTIONARY.skills.length).toBeGreaterThanOrEqual(150);
    const seen = new Map<string, string>();
    for (const skill of SKILLS_DICTIONARY.skills) {
      for (const term of [skill.id, ...skill.synonyms]) {
        expect(normalizeText(term)).toBe(term);
        expect(seen.has(term), `${term} listed twice`).toBe(false);
        seen.set(term, skill.id);
      }
    }
    expect(canonicalSkill("JS")).toBe("javascript");
    expect(canonicalSkill("Postgres")).toBe("postgresql");
    expect(canonicalSkill("k8s")).toBe("kubernetes");
    expect(canonicalSkill("C#")).toBe("c#");
    expect(canonicalSkill("cooking")).toBeNull();
  });

  test("TC-ROUNDTRIP title families are normalized and disjoint", () => {
    const seen = new Set<string>();
    for (const family of TITLE_FAMILIES.families) {
      for (const title of family.titles) {
        expect(normalizeText(title)).toBe(title);
        expect(seen.has(title), title).toBe(false);
        seen.add(title);
      }
    }
    expect(titleFamilyOf("Software Engineer")).toBe(
      titleFamilyOf("Backend Developer")
    );
    expect(titleFamilyOf("Pastry Chef")).toBeNull();
  });

  test("TC-ROUNDTRIP CLI commands for /cli (22 §12)", () => {
    const ids = CLI_COMMANDS.steps.map((step) => step.id);
    expect(ids).toContain("install");
    expect(ids).toContain("login");
    const install = CLI_COMMANDS.steps.find((step) => step.id === "install");
    expect(install?.commands.macos).toBe("uv tool install pilih-jobs");
    expect(
      CLI_COMMANDS.steps.find((step) => step.id === "browser")?.commands.windows
    ).toBe("pilih-jobs browser install");
    expect(CLI_COMMANDS.executable).toBe("pilih-jobs");
  });
});
