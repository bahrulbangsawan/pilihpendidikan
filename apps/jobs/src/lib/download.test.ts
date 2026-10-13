import { describe, expect, it } from "vitest";
import { downloadHeaders, matchDownloadPath } from "./download";

describe("TW-BFF /download/* allowlist", () => {
  it("TW-BFF serves the account export link the api emails (browser session only)", () => {
    expect(
      matchDownloadPath("account/exports/exp_01JA0000000000000000000000")
    ).toEqual({
      kind: "export",
      apiPath: "/api/v1/account/exports/exp_01JA0000000000000000000000",
    });
    expect(matchDownloadPath("account/exports/../../me")).toBeNull();
    expect(matchDownloadPath("account/exports/a/b")).toBeNull();
    expect(matchDownloadPath("account/other/x")).toBeNull();
  });

  it("TW-BFF keeps .ics and file content and only frames inline PDFs", () => {
    expect(matchDownloadPath("files/fil_1/content")?.kind).toBe("file");
    expect(
      matchDownloadPath("applications/app_1/interviews/ivw_1.ics")?.kind
    ).toBe("ics");
    const zip = downloadHeaders(
      new Headers({ "Content-Type": "application/zip" }),
      true
    );
    expect(zip.get("Content-Disposition")).toBe("attachment");
    expect(zip.has("x-jobs-frameable")).toBe(false);
  });
});
