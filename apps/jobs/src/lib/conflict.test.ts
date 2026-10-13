import type { LegacyJobSection } from "@pilihpendidikan/jobs-contracts/records";
import { describe, expect, it, vi } from "vitest";
import { makeApplication } from "@/test/fixtures";
import { ApiError } from "./api-client";
import {
  APPLICATION_FIELDS,
  applicationFieldMerger,
  mergeSections,
  resolveRevisionConflict,
} from "./conflict";
import { writeWithConflicts } from "./revisioned-write";
import { mergeText } from "./text-merge";

function conflict(current: unknown): ApiError {
  return new ApiError({
    ok: false,
    status: 409,
    error: {
      error: "revision_conflict",
      message: "changed",
      details: { current: current as never },
    },
  });
}

const base = makeApplication({
  revision: 7,
  stage: "ready",
  priority: 0,
  follow_up_at: null,
});

describe("TW-CONFLICT revision conflicts (12 §11)", () => {
  it("TW-CONFLICT non-overlapping fields auto-merge and re-send with the new revision", () => {
    // I changed priority; the CLI changed the stage meanwhile.
    const current = {
      ...base,
      revision: 8,
      stage: "applied" as const,
      last_change_source: "cli" as const,
    };
    const resolution = resolveRevisionConflict({
      base,
      changes: { priority: 1 },
      current,
      fields: APPLICATION_FIELDS,
    });
    expect(resolution).toEqual({
      kind: "retry",
      changes: { priority: 1 },
      baseRevision: 8,
      theirFields: ["stage"],
      mergedFields: [],
    });
  });

  it("TW-CONFLICT overlapping fields never auto-retry", () => {
    const current = { ...base, revision: 8, stage: "applied" as const };
    const resolution = resolveRevisionConflict({
      base,
      changes: { stage: "rejected" },
      current,
      fields: APPLICATION_FIELDS,
    });
    expect(resolution).toEqual({
      kind: "overlap",
      fields: ["stage"],
      theirFields: ["stage"],
    });
  });

  it("TW-CONFLICT the same change on both sides is a no-op", () => {
    const current = { ...base, revision: 8, priority: 1 };
    expect(
      resolveRevisionConflict({
        base,
        changes: { priority: 1 },
        current,
        fields: APPLICATION_FIELDS,
      }).kind
    ).toBe("noop");
  });

  it("TW-CONFLICT bookkeeping columns (revision, updated_at, source) never count as their change", () => {
    const current = {
      ...base,
      revision: 9,
      updated_at: base.updated_at + 1000,
      last_change_source: "mcp" as const,
    };
    const resolution = resolveRevisionConflict({
      base,
      changes: { archived: true },
      current,
    });
    expect(resolution).toMatchObject({
      kind: "retry",
      theirFields: [],
      baseRevision: 9,
    });
  });

  it("TW-CONFLICT writeWithConflicts re-sends once after a non-overlapping conflict", async () => {
    const current = { ...base, revision: 8, stage: "applied" as const };
    const send = vi
      .fn()
      .mockRejectedValueOnce(conflict(current))
      .mockResolvedValueOnce({ ...current, revision: 9, priority: 1 });
    const outcome = await writeWithConflicts({
      base,
      changes: { priority: 1 },
      fields: APPLICATION_FIELDS,
      send,
    });
    expect(send).toHaveBeenNthCalledWith(1, 7, { priority: 1 });
    expect(send).toHaveBeenNthCalledWith(2, 8, { priority: 1 });
    expect(outcome).toMatchObject({ kind: "saved", mergedFrom: ["stage"] });
  });

  it("TW-CONFLICT an overlap is handed to the UI without a second request; Apply mine uses the new revision", async () => {
    const current = { ...base, revision: 8, stage: "applied" as const };
    const send = vi
      .fn()
      .mockRejectedValueOnce(conflict(current))
      .mockResolvedValue(current);
    const outcome = await writeWithConflicts({
      base,
      changes: { stage: "rejected" },
      fields: APPLICATION_FIELDS,
      send,
    });
    expect(outcome.kind).toBe("overlap");
    expect(send).toHaveBeenCalledTimes(1);
    if (outcome.kind === "overlap") {
      await outcome.applyMine();
      expect(send).toHaveBeenLastCalledWith(8, { stage: "rejected" });
    }
  });

  it("TW-CONFLICT a second conflict while re-sending stops and asks", async () => {
    const current = { ...base, revision: 8, stage: "applied" as const };
    const later = { ...current, revision: 9, priority: -1 };
    const send = vi
      .fn()
      .mockRejectedValueOnce(conflict(current))
      .mockRejectedValueOnce(conflict(later));
    const outcome = await writeWithConflicts({
      base,
      changes: { priority: 1 },
      fields: APPLICATION_FIELDS,
      send,
    });
    expect(outcome).toMatchObject({
      kind: "overlap",
      current: { revision: 9 },
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("TW-CONFLICT other errors are not swallowed", async () => {
    const send = vi.fn().mockRejectedValue(
      new ApiError({
        ok: false,
        status: 422,
        error: { error: "invalid_transition", message: "no" },
      })
    );
    await expect(
      writeWithConflicts({ base, changes: { stage: "saved" }, send })
    ).rejects.toThrow("no");
  });
});

const item = (
  id: string,
  patch: Partial<LegacyJobSection["items"][number]> = {}
) => ({
  id,
  title: `Item ${id}`,
  notes: "",
  url: "",
  done: false,
  ...patch,
});

describe("TW-CONFLICT checklists and notes merge three-way", () => {
  const original: LegacyJobSection[] = [
    { id: "s1", name: "Documents", items: [item("a"), item("b")] },
  ];

  it("TW-CONFLICT keeps additions from both sides and one-sided edits", () => {
    const mine: LegacyJobSection[] = [
      {
        id: "s1",
        name: "Documents",
        items: [item("a", { done: true }), item("b"), item("c")],
      },
    ];
    const theirs: LegacyJobSection[] = [
      {
        id: "s1",
        name: "Docs",
        items: [item("a"), item("b", { notes: "Ask HR" })],
      },
      { id: "s2", name: "People", items: [] },
    ];
    expect(mergeSections(original, mine, theirs)).toEqual([
      {
        id: "s1",
        name: "Docs",
        items: [
          item("a", { done: true }),
          item("b", { notes: "Ask HR" }),
          item("c"),
        ],
      },
      { id: "s2", name: "People", items: [] },
    ]);
  });

  it("TW-CONFLICT merges notes edited on different lines", () => {
    const withNotes: LegacyJobSection[] = [
      {
        id: "s1",
        name: "Documents",
        items: [item("a", { notes: "line one\nline two\nline three" })],
      },
    ];
    const mine = [
      {
        ...withNotes[0],
        items: [item("a", { notes: "line ONE\nline two\nline three" })],
      },
    ] as LegacyJobSection[];
    const theirs = [
      {
        ...withNotes[0],
        items: [item("a", { notes: "line one\nline two\nline 3" })],
      },
    ] as LegacyJobSection[];
    expect(mergeSections(withNotes, mine, theirs)?.[0]?.items[0]?.notes).toBe(
      "line ONE\nline two\nline 3"
    );
  });

  it("TW-CONFLICT gives up (both versions shown) when the same thing changed differently", () => {
    const mine = [{ id: "s1", name: "Mine", items: original[0]?.items ?? [] }];
    const theirs = [
      { id: "s1", name: "Theirs", items: original[0]?.items ?? [] },
    ];
    expect(mergeSections(original, mine, theirs)).toBeNull();
    const edited = [
      {
        id: "s1",
        name: "Documents",
        items: [item("a", { title: "Edited" }), item("b")],
      },
    ];
    const deleted = [{ id: "s1", name: "Documents", items: [item("b")] }];
    expect(mergeSections(original, edited, deleted)).toBeNull();
  });

  it("TW-CONFLICT the application merger resolves an overlapping sections field", () => {
    const mine: LegacyJobSection[] = [
      {
        id: "s1",
        name: "Documents",
        items: [...(original[0]?.items ?? []), item("c")],
      },
    ];
    const theirs: LegacyJobSection[] = [
      {
        id: "s1",
        name: "Documents",
        items: [item("a", { done: true }), item("b")],
      },
    ];
    const resolution = resolveRevisionConflict({
      base: { ...base, sections: original },
      changes: { sections: mine },
      current: { ...base, revision: 8, sections: theirs },
      fields: APPLICATION_FIELDS,
      merge: applicationFieldMerger,
    });
    expect(resolution).toMatchObject({
      kind: "retry",
      mergedFields: ["sections"],
      baseRevision: 8,
    });
  });

  it("TW-CONFLICT plain text merges disjoint edits and refuses overlapping ones", () => {
    expect(
      mergeText(
        "call recruiter on monday",
        "call the recruiter on monday",
        "call recruiter on tuesday"
      )
    ).toEqual({
      ok: true,
      text: "call the recruiter on tuesday",
    });
    expect(mergeText("salary 20m", "salary 25m", "salary 22m")).toEqual({
      ok: false,
    });
    expect(mergeText("same", "same", "changed")).toEqual({
      ok: true,
      text: "changed",
    });
    expect(mergeText("a\nb", "a\nb\nc", "z\na\nb")).toEqual({
      ok: true,
      text: "z\na\nb\nc",
    });
    expect(mergeText("x", "y", "y")).toEqual({ ok: true, text: "y" });
  });
});
