import { describe, expect, test } from "bun:test";
import {
  CANDIDATE_ACTION_TYPES,
  CandidateActionSchema,
  computeVerificationVerdict,
  FieldPlanSchema,
  LeaseRefSchema,
  OBSERVATION_LIMITS,
  PageObservationSchema,
} from "../src/agent";
import { PAUSE_REASONS } from "../src/enums";
import { BrowserSubmitApprovalPayloadSchema } from "../src/records";
import { AGENT_EXAMPLES } from "./examples";

const { OBSERVATION, FIELD_PLAN, SUBMIT_PAYLOAD } = AGENT_EXAMPLES;
const field = OBSERVATION.fields[0];

describe("agent schemas (19 §3)", () => {
  test("TC-AGENT a realistic PageObservation and FieldPlan parse", () => {
    expect(PageObservationSchema.parse(OBSERVATION)).toEqual(
      OBSERVATION as never
    );
    expect(FieldPlanSchema.parse(FIELD_PLAN)).toEqual(FIELD_PLAN as never);
    expect(
      BrowserSubmitApprovalPayloadSchema.safeParse(SUBMIT_PAYLOAD).success
    ).toBe(true);
  });

  test("TC-AGENT ObservedField ref and signature formats", () => {
    const withField = (patch: Record<string, unknown>) =>
      PageObservationSchema.safeParse({
        ...OBSERVATION,
        fields: [{ ...field, ...patch }],
      }).success;
    expect(withField({ ref: "fr2:f17" })).toBe(true);
    expect(withField({ ref: "x1" })).toBe(false);
    expect(withField({ signature: "short" })).toBe(false);
    expect(withField({ kind: "password" })).toBe(false);
    expect(withField({ label: "x".repeat(301) })).toBe(false);
  });

  test("TC-AGENT observation limits are exact (19 §3.1)", () => {
    const limit = (patch: Record<string, unknown>) =>
      PageObservationSchema.safeParse({ ...OBSERVATION, ...patch }).success;
    expect(
      limit({ aria_snapshot: "a".repeat(OBSERVATION_LIMITS.ariaSnapshot) })
    ).toBe(true);
    expect(
      limit({ aria_snapshot: "a".repeat(OBSERVATION_LIMITS.ariaSnapshot + 1) })
    ).toBe(false);
    expect(limit({ visible_text_excerpt: "a".repeat(8193) })).toBe(false);
    expect(limit({ form_hash: "abc" })).toBe(false);
    expect(limit({ fields: Array.from({ length: 301 }, () => field) })).toBe(
      false
    );
    expect(
      limit({
        controls: Array.from({ length: 81 }, () => OBSERVATION.controls[0]),
      })
    ).toBe(false);
    expect(limit({ url: "not a url" })).toBe(false);
  });

  test("TC-AGENT candidate actions are a closed set", () => {
    const valid = [
      { id: "c1", type: "fill_field", ref: "f1", plan_item: "p1" },
      { id: "c2", type: "select_option", ref: "f2", plan_item: "p2" },
      { id: "c3", type: "set_checkbox", ref: "f3", plan_item: "p3" },
      {
        id: "c4",
        type: "upload_file",
        ref: "f4",
        file_id: "fil_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
      },
      { id: "c5", type: "click_ref", ref: "c-submit", role_hint: "submit" },
      { id: "c6", type: "scroll", ref: null, direction: "down" },
      {
        id: "c7",
        type: "wait_for",
        condition: "network_idle",
        timeout_ms: 15_000,
      },
      {
        id: "c8",
        type: "pause_for_human",
        reason: "unclear_page",
        message: "Look at this page",
      },
      {
        id: "c9",
        type: "stop",
        outcome: "failed",
        error_class: "posting_closed",
      },
    ];
    expect(valid.map((action) => action.type)).toEqual([
      ...CANDIDATE_ACTION_TYPES,
    ]);
    for (const action of valid) {
      expect(CandidateActionSchema.safeParse(action).success).toBe(true);
    }
    expect(
      CandidateActionSchema.safeParse({
        id: "x",
        type: "navigate",
        url: "https://evil.example",
      }).success
    ).toBe(false);
    expect(
      CandidateActionSchema.safeParse({
        id: "x",
        type: "click_ref",
        ref: "a",
        role_hint: "login",
      }).success
    ).toBe(false);
    expect(
      CandidateActionSchema.safeParse({
        id: "x",
        type: "wait_for",
        condition: "url_change",
        timeout_ms: 15_001,
      }).success
    ).toBe(false);
    expect(
      CandidateActionSchema.safeParse({
        id: "x",
        type: "pause_for_human",
        reason: "external_redirect",
        message: "",
      }).success
    ).toBe(false);
  });

  test("TC-AGENT pause_for_human uses the canonical PauseReason list", () => {
    for (const reason of PAUSE_REASONS) {
      expect(
        CandidateActionSchema.safeParse({
          id: "c1",
          type: "pause_for_human",
          reason,
          message: "m",
        }).success
      ).toBe(true);
    }
  });

  test("TC-AGENT field plan items keep 19 §3.3 limits", () => {
    const item = FIELD_PLAN.items[0];
    const plan = (patch: Record<string, unknown>) =>
      FieldPlanSchema.safeParse({
        ...FIELD_PLAN,
        items: [{ ...item, ...patch }],
      }).success;
    expect(plan({ value: "x".repeat(4000) })).toBe(true);
    expect(plan({ value: "x".repeat(4001) })).toBe(false);
    expect(plan({ confidence: 1.2 })).toBe(false);
    expect(plan({ value_source: "guess" })).toBe(false);
    expect(plan({ reason: "x".repeat(301) })).toBe(false);
  });

  test("TC-AGENT lease_ref is {task_id, lease_id}", () => {
    expect(
      LeaseRefSchema.safeParse({
        task_id: "tsk_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
        lease_id: "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C0D",
      }).success
    ).toBe(true);
    expect(
      LeaseRefSchema.safeParse({ task_id: "tsk_1", lease_id: "lse_1" }).success
    ).toBe(false);
  });
});

describe("submission verification (19 §9.1)", () => {
  const ai = (received: number | null, stillForm: number | null) => ({
    application_received: received,
    still_form_or_error: stillForm,
  });

  test("TC-AGENT negative marker wins", () => {
    expect(
      computeVerificationVerdict(
        { negative_marker: true, url_match: true },
        ai(0.99, 0)
      )
    ).toBe("negative");
  });

  test("TC-AGENT deterministic and AI positive → verified; either alone → unverified", () => {
    expect(computeVerificationVerdict({ url_match: true }, ai(0.9, 0.1))).toBe(
      "verified"
    );
    expect(
      computeVerificationVerdict(
        { dom_marker: true, form_gone: true },
        ai(0.9, 0.29)
      )
    ).toBe("verified");
    expect(computeVerificationVerdict({ url_match: true }, ai(0.5, 0.1))).toBe(
      "unverified"
    );
    expect(computeVerificationVerdict({ dom_marker: true }, ai(0.9, 0.1))).toBe(
      "unverified"
    );
    expect(computeVerificationVerdict({ url_match: true }, null)).toBe(
      "unverified"
    );
  });

  test("TC-AGENT form still present → negative; otherwise xhr decides unverified / outcome_unknown", () => {
    expect(computeVerificationVerdict({}, ai(0.2, 0.7))).toBe("negative");
    expect(computeVerificationVerdict({ xhr_2xx: true }, ai(0.2, 0.4))).toBe(
      "unverified"
    );
    expect(computeVerificationVerdict({}, ai(0.2, 0.4))).toBe(
      "outcome_unknown"
    );
    expect(computeVerificationVerdict({}, null)).toBe("outcome_unknown");
  });
});
