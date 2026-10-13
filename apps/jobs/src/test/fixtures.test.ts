import { describe, expect, it } from "vitest";
import {
  makeDetail,
  makeDevice,
  makeEvent,
  makeInterview,
  makeOffer,
  makeSettings,
  sampleBoard,
} from "./fixtures";

describe("contract fixtures", () => {
  it("build a contract-valid board, detail, device, settings and records", () => {
    const board = sampleBoard();
    expect(board.columns).toHaveLength(9);
    const detail = makeDetail();
    expect(makeInterview(detail.application.id).round).toBe(1);
    expect(makeOffer(detail.application.id).status).toBe("open");
    expect(
      makeEvent(detail.application.id, {
        type: "note_added",
        payload: { text: "hi" },
      }).type
    ).toBe("note_added");
    expect(makeDevice().online).toBe(true);
    expect(makeSettings().locale).toBe("en");
  });
});
