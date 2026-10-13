import { describe, expect, it } from "vitest";
import { makeApplication, NOW, USER_ID } from "@/test/fixtures";
import { matchDownloadPath } from "./download";
import {
  factText,
  factValue,
  isProtectedQuestion,
  planFactsSave,
} from "./facts-form";

const fact = (key: string, value: unknown, revision = 3) => ({
  id: `fct_01J9${String(revision).padStart(22, "0")}`,
  user_id: USER_ID,
  key,
  value: value as never,
  source: "cv_import" as const,
  cv_id: null,
  cv_entry_id: null,
  revision,
  created_at: NOW,
  updated_at: NOW,
});

describe("profile facts (03 §9, 05 §10)", () => {
  it("sends only changed facts, each with its base_revision; cleared ones are deleted", () => {
    const current = [
      fact("contact.phone", "+62 811 000", 4),
      fact("links.github", "https://github.com/rina", 2),
    ];
    const plan = planFactsSave(current, [
      { key: "contact.phone", value: "+62 811 999" },
      { key: "links.github", value: null },
      { key: "contact.full_name", value: "Rina Wulandari" },
      { key: "contact.email", value: null },
    ]);
    expect(plan).toEqual({
      ok: true,
      changed: 3,
      request: {
        facts: [
          {
            key: "contact.phone",
            value: "+62 811 999",
            source: "user_entered",
            base_revision: 4,
          },
          {
            key: "contact.full_name",
            value: "Rina Wulandari",
            source: "user_entered",
          },
        ],
        delete_keys: ["links.github"],
      },
    });
  });

  it("stops on values the contracts reject", () => {
    const plan = planFactsSave(
      [],
      [
        { key: "contact.email", value: "not-an-email" },
        { key: "links.linkedin", value: "nope" },
      ]
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(Object.keys(plan.errors).sort()).toEqual([
        "contact.email",
        "links.linkedin",
      ]);
    }
  });

  it("edits lists and booleans as text", () => {
    expect(factText(["Frontend", "Web"], "list")).toBe("Frontend, Web");
    expect(factValue(" Frontend ,  , Web", "list")).toEqual([
      "Frontend",
      "Web",
    ]);
    expect(factValue("", "list")).toBeNull();
    expect(factValue("true", "boolean")).toBe(true);
  });

  it("marks protected screening questions", () => {
    expect(isProtectedQuestion("gender")).toBe(true);
    expect(isProtectedQuestion("requires_sponsorship")).toBe(true);
    expect(isProtectedQuestion("veteran_status")).toBe(true);
    expect(isProtectedQuestion("notice_period")).toBe(false);
    expect(isProtectedQuestion("years_experience.python")).toBe(false);
  });
});

describe("downloads (/download/*)", () => {
  it("accepts only the .ics and file-content shapes with plain ids", () => {
    const app = makeApplication();
    expect(
      matchDownloadPath(`applications/${app.id}/interviews/ivw_01J9ABC.ics`)
    ).toEqual({
      kind: "ics",
      apiPath: `/api/v1/applications/${app.id}/interviews/ivw_01J9ABC.ics`,
    });
    expect(matchDownloadPath("files/fil_01J9ABC/content")).toEqual({
      kind: "file",
      apiPath: "/api/v1/files/fil_01J9ABC/content",
    });
    expect(matchDownloadPath("files/../content")).toBeNull();
    expect(matchDownloadPath("board")).toBeNull();
    expect(matchDownloadPath("applications/a/b/interviews/c.ics")).toBeNull();
  });
});
