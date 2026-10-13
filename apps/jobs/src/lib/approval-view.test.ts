import { describe, expect, it } from "vitest";
import { answerPayload } from "@/test/fixtures-rest";
import { ApiError } from "./api-client";
import type { AnswerQuestion } from "./approval-view";
import {
  answersComplete,
  buildAnswerResponse,
  clampAutoUse,
  countdown,
  decideFailure,
  initialAnswer,
  isMaskedByDefault,
  maskValue,
  stepSelection,
} from "./approval-view";

const payload = answerPayload();
const questions =
  payload.type === "answer" ? (payload.questions as AnswerQuestion[]) : [];

function apiError(status: number, error: string, details?: object) {
  return new ApiError({
    ok: false,
    status,
    error: {
      error,
      message: error,
      ...(details ? { details: details as never } : {}),
    },
  });
}

describe("TW-APPROVAL approval helpers (03 §8, §9)", () => {
  it("TW-APPROVAL a protected answer is never saved as always, whatever was picked", () => {
    const [visa, notice] = questions;
    if (!(visa && notice)) {
      throw new Error("fixture questions missing");
    }
    expect(clampAutoUse("always", "protected")).toBe("approval");
    expect(clampAutoUse("always", "personal")).toBe("always");
    expect(clampAutoUse("never", "protected")).toBe("never");
    const response = buildAnswerResponse(questions, {
      q1: {
        value: "no",
        saveToBank: true,
        sensitivity: "none",
        autoUse: "always",
      },
      q2: {
        value: " 1 month ",
        saveToBank: false,
        sensitivity: "none",
        autoUse: "always",
      },
    });
    expect(response.answers).toEqual([
      {
        ref: "q1",
        value: "no",
        save_to_bank: true,
        sensitivity: "protected",
        auto_use: "approval",
      },
      { ref: "q2", value: "1 month", save_to_bank: false },
    ]);
  });

  it("TW-APPROVAL required questions must be answered; suggestions prefill them", () => {
    const inputs = Object.fromEntries(
      questions.map((question) => [question.ref, initialAnswer(question)])
    );
    expect(inputs.q1?.value).toBe("no");
    expect(inputs.q1?.autoUse).toBe("approval");
    expect(answersComplete(questions, inputs)).toBe(true);
    expect(
      answersComplete(questions, {
        ...inputs,
        q1: {
          ...(inputs.q1 ?? initialAnswer(questions[0] as AnswerQuestion)),
          value: " ",
        },
      })
    ).toBe(false);
  });

  it("TW-APPROVAL contact values are masked by default; protected values arrive pre-masked", () => {
    expect(isMaskedByDefault({ sensitivity: "personal" })).toBe(true);
    expect(isMaskedByDefault({ sensitivity: "protected" })).toBe(false);
    expect(isMaskedByDefault({ sensitivity: "none" })).toBe(false);
    expect(maskValue("rina.wulandari@gmail.com")).toBe("r…@gmail.com");
    expect(maskValue("+62 812 3456 7890")).toBe("+…90");
    expect(maskValue("Rina")).toBe("R…");
  });

  it("TW-APPROVAL decision failures read as hash mismatch, already decided, expired or gone", () => {
    expect(
      decideFailure(
        apiError(409, "revision_conflict", { reason: "payload_hash_mismatch" })
      )
    ).toBe("hash_mismatch");
    expect(decideFailure(apiError(409, "revision_conflict"))).toBe(
      "already_decided"
    );
    expect(
      decideFailure(
        apiError(409, "revision_conflict", { reason: "rule_changed" })
      )
    ).toBe("rule_changed");
    expect(decideFailure(apiError(410, "approval_expired"))).toBe("expired");
    expect(decideFailure(apiError(404, "not_found"))).toBe("gone");
    expect(decideFailure(apiError(422, "mode_not_allowed"))).toBe(
      "not_allowed"
    );
    expect(decideFailure(new Error("boom"))).toBe("failed");
  });

  it("TW-APPROVAL J / K wrap around the list; the countdown never goes negative", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(stepSelection(list, "a", 1)).toBe("b");
    expect(stepSelection(list, "c", 1)).toBe("a");
    expect(stepSelection(list, "a", -1)).toBe("c");
    expect(stepSelection(list, null, -1)).toBe("c");
    expect(stepSelection([], null, 1)).toBeNull();
    expect(countdown(1000 + 23 * 3_600_000 + 56 * 60_000, 1000)).toEqual({
      expired: false,
      hours: 23,
      minutes: 56,
    });
    expect(countdown(0, 5000)).toEqual({ expired: true, hours: 0, minutes: 0 });
  });
});
