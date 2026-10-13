import { describe, expect, it } from "vitest";
import {
  localeRedirectResponse,
  negotiateLocale,
  resolveLocale,
} from "./locale";

const COOKIE_RE = /^jobs-lang=id; /;

describe("TW-LOCALE locale (D-27)", () => {
  it("TW-LOCALE /id sets the jobs-lang cookie and redirects to the board", () => {
    const response = localeRedirectResponse(
      new Request("https://jobs.pilihpendidikan.com/id"),
      "id"
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/board");
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(COOKIE_RE);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("TW-LOCALE on http localhost the cookie is not Secure", () => {
    const response = localeRedirectResponse(
      new Request("http://localhost:4007/id"),
      "id"
    );
    expect(response.headers.get("Set-Cookie")).not.toContain("Secure");
  });

  it("TW-LOCALE Accept-Language picks the default when there is no cookie", () => {
    expect(negotiateLocale("id-ID,id;q=0.9,en;q=0.8")).toBe("id");
    expect(negotiateLocale("en-GB,en;q=0.9,id;q=0.8")).toBe("en");
    expect(negotiateLocale("fr-FR,fr;q=0.9,id;q=0.5")).toBe("id");
    expect(negotiateLocale("in")).toBe("id");
    expect(negotiateLocale("de, fr")).toBe("en");
    expect(negotiateLocale("en;q=0.2, id;q=0.8")).toBe("id");
    expect(negotiateLocale("id;q=0")).toBe("en");
    expect(negotiateLocale(null)).toBe("en");
  });

  it("TW-LOCALE the jobs-lang cookie wins over Accept-Language; junk is ignored", () => {
    expect(resolveLocale("jobs-lang=en", "id-ID")).toBe("en");
    expect(resolveLocale("a=b; jobs-lang=id", "en-US")).toBe("id");
    expect(resolveLocale("jobs-lang=fr", "id")).toBe("id");
    expect(resolveLocale(undefined, undefined)).toBe("en");
  });
});
