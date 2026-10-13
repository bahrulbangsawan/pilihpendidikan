import { describe, expect, it } from "vitest";
import { getT } from "@/i18n";
import { makeRule } from "@/test/fixtures-rest";
import {
  activationSentence,
  AUTO_MAX_VALIDITY_MS,
  createRuleBody,
  dayOf,
  emptyRuleForm,
  nameConfirmed,
  normalizeDomain,
  ruleToForm,
  updateRuleChanges,
  validateRuleForm,
  withMode,
} from "./rules-form";

const NOW = Date.UTC(2026, 9, 12, 7, 0, 0);
const DAY = 86_400_000;
const t = getT("en");

describe("TW-RULES rule editor model (12 §6.2, 19 §8.3, D-35)", () => {
  it("TW-RULES an auto rule needs score 70+, a narrowing criterion, domains and an expiry within 30 days", () => {
    const base = { ...emptyRuleForm(), name: "Auto", mode: "auto" as const };
    const problems = validateRuleForm({ ...base, minScore: 60 }, NOW);
    expect(problems).toMatchObject({
      minScore: "rules.errors.autoMinScore",
      criteria: "rules.errors.autoNarrow",
      allowedDomains: "rules.errors.autoDomains",
      expiresOn: "rules.errors.autoExpiry",
    });
    const ok = {
      ...base,
      minScore: 85,
      keywords: ["react"],
      allowedDomains: ["greenhouse.io"],
      expiresOn: dayOf(NOW + 10 * DAY),
    };
    expect(validateRuleForm(ok, NOW)).toEqual({});
    expect(
      validateRuleForm({ ...ok, expiresOn: dayOf(NOW + 40 * DAY) }, NOW)
    ).toEqual({ expiresOn: "rules.errors.autoExpiryTooFar" });
    expect(validateRuleForm({ ...ok, maxPerDay: 26 }, NOW)).toEqual({
      maxPerDay: "rules.errors.maxPerDay",
    });
    expect(validateRuleForm({ ...ok, maxPerCompany: 4 }, NOW)).toEqual({
      maxPerCompany: "rules.errors.maxPerCompany",
    });
    // Assisted / approval rules have none of the auto constraints.
    expect(
      validateRuleForm({ ...base, mode: "approval", minScore: 10 }, NOW)
    ).toEqual({});
  });

  it("TW-RULES switching to auto prefills a 30-day expiry and the body never exceeds it", () => {
    const form = withMode(
      {
        ...emptyRuleForm(),
        name: "Auto",
        keywords: ["react"],
        allowedDomains: ["https://boards.greenhouse.io/acme"],
      },
      "auto",
      NOW
    );
    expect(form.expiresOn).toBe(dayOf(NOW + AUTO_MAX_VALIDITY_MS));
    const body = createRuleBody(form, NOW);
    expect(body.limits.expires_at).toBeLessThanOrEqual(
      NOW + AUTO_MAX_VALIDITY_MS
    );
    expect(body.allowed_domains).toEqual(["greenhouse.io"]);
    expect(body.criteria.exclude_blocking_gates).toBe(true);
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("Jobs.Lever.co")).toBe("lever.co");
  });

  it("TW-RULES the activation summary is plain language with limits, sites and hours", () => {
    const rule = makeRule({
      mode: "auto",
      criteria: {
        min_score: 85,
        require_ai_component: false,
        max_score_age_days: 7,
        exclude_blocking_gates: true,
        exclude_possible_gates: false,
      },
      limits: {
        max_per_day: 5,
        max_per_company_per_30d: 2,
        active_hours: { start: "08:00", end: "20:00" },
        expires_at: null,
      },
      allowed_domains: ["greenhouse.io"],
    });
    expect(
      activationSentence(t, rule, { sources: ["Greenhouse", "Lever"] })
    ).toBe(
      "Up to 5 applications a day to Greenhouse, Lever jobs scoring 85+, at most 2 per company in 30 days. Only between 08:00 and 20:00."
    );
    expect(activationSentence(getT("id"), rule)).toContain("greenhouse.io");
  });

  it("TW-RULES an edit sends only the changed fields; the typed name must match exactly", () => {
    const rule = makeRule();
    const form = { ...ruleToForm(rule), maxPerDay: 3 };
    expect(updateRuleChanges(rule, form, NOW)).toEqual({
      limits: { ...rule.limits, max_per_day: 3 },
    });
    expect(updateRuleChanges(rule, ruleToForm(rule), NOW)).toEqual({});
    expect(nameConfirmed("Frontend roles", "Frontend roles")).toBe(true);
    expect(nameConfirmed("frontend roles", "Frontend roles")).toBe(false);
    expect(nameConfirmed("", "")).toBe(false);
  });
});
