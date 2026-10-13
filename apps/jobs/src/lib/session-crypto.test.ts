import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_LOCAL,
  SESSION_COOKIE_SECURE,
  sessionCookieAttributes,
  sessionCookieName,
  serializeCookie,
} from "./cookies";
import type { BffSession } from "./session-crypto";
import {
  openSession,
  publicSession,
  sealSession,
  sessionFromCookieHeader,
} from "./session-crypto";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const NOW = 1_800_000_000_000;
const SESSION: BffSession = {
  bearer: "bearer-0123456789abcdef0123456789abcdef",
  email: "rina@example.com",
  exp: NOW + 3_600_000,
};

function flip(value: string, at: number): string {
  const char = value[at] === "A" ? "B" : "A";
  return `${value.slice(0, at)}${char}${value.slice(at + 1)}`;
}

describe("TW-SESSION sealed BFF cookie", () => {
  it("TW-SESSION round-trips: seal then open gives the same session", async () => {
    const sealed = await sealSession(SESSION, SECRET, SESSION_COOKIE_SECURE);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(SESSION.bearer);
    expect(sealed).not.toContain("rina");
    expect(
      await openSession(sealed, SECRET, SESSION_COOKIE_SECURE, NOW)
    ).toEqual(SESSION);
  });

  it("TW-SESSION seals differently every time (random IV)", async () => {
    const a = await sealSession(SESSION, SECRET, SESSION_COOKIE_SECURE);
    const b = await sealSession(SESSION, SECRET, SESSION_COOKIE_SECURE);
    expect(a).not.toBe(b);
  });

  it("TW-SESSION a tampered ciphertext, IV or version reads as signed out", async () => {
    const sealed = await sealSession(SESSION, SECRET, SESSION_COOKIE_SECURE);
    const [version, iv, data] = sealed.split(".") as [string, string, string];
    const tampered = [
      `${version}.${iv}.${flip(data, 5)}`,
      `${version}.${flip(iv, 2)}.${data}`,
      `v2.${iv}.${data}`,
      `${version}.${iv}`,
      `${sealed}.extra`,
      "not-a-cookie",
      "",
    ];
    for (const value of tampered) {
      expect(
        await openSession(value, SECRET, SESSION_COOKIE_SECURE, NOW)
      ).toBeNull();
    }
  });

  it("TW-SESSION another key or another cookie name cannot open it", async () => {
    const sealed = await sealSession(SESSION, SECRET, SESSION_COOKIE_SECURE);
    expect(
      await openSession(sealed, `${SECRET}-rotated`, SESSION_COOKIE_SECURE, NOW)
    ).toBeNull();
    expect(
      await openSession(sealed, SECRET, SESSION_COOKIE_LOCAL, NOW)
    ).toBeNull();
  });

  it("TW-SESSION an expired session reads as signed out", async () => {
    const sealed = await sealSession(SESSION, SECRET, SESSION_COOKIE_SECURE);
    expect(
      await openSession(sealed, SECRET, SESSION_COOKIE_SECURE, SESSION.exp)
    ).toBeNull();
    expect(
      await openSession(sealed, SECRET, SESSION_COOKIE_SECURE, SESSION.exp - 1)
    ).not.toBeNull();
  });

  it("TW-SESSION a tampered cookie header is stale; no cookie is simply signed out", async () => {
    const sealed = await sealSession(SESSION, SECRET, SESSION_COOKIE_SECURE);
    const good = await sessionFromCookieHeader(
      `theme=dark; ${SESSION_COOKIE_SECURE}=${sealed}`,
      SECRET,
      SESSION_COOKIE_SECURE,
      NOW
    );
    expect(good).toEqual({ session: SESSION, stale: false });
    const bad = await sessionFromCookieHeader(
      `${SESSION_COOKIE_SECURE}=${flip(sealed, sealed.length - 3)}`,
      SECRET,
      SESSION_COOKIE_SECURE,
      NOW
    );
    expect(bad).toEqual({ session: null, stale: true });
    expect(
      await sessionFromCookieHeader(null, SECRET, SESSION_COOKIE_SECURE, NOW)
    ).toEqual({
      session: null,
      stale: false,
    });
  });

  it("TW-SESSION refuses a short key", async () => {
    await expect(
      sealSession(SESSION, "short", SESSION_COOKIE_SECURE)
    ).rejects.toThrow();
  });

  it("TW-SESSION cookie is __Host- with HttpOnly, Secure, SameSite=Lax, Path=/ on https", () => {
    const url = new URL("https://jobs.pilihpendidikan.com/board");
    expect(sessionCookieName(url)).toBe("__Host-jobs-session");
    const header = serializeCookie(
      sessionCookieName(url),
      "v1.x.y",
      sessionCookieAttributes(url, 604_800)
    );
    expect(header).toBe(
      "__Host-jobs-session=v1.x.y; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax"
    );
    const local = new URL("http://localhost:4007/");
    expect(sessionCookieName(local)).toBe("jobs-session");
    expect(
      serializeCookie(
        sessionCookieName(local),
        "v",
        sessionCookieAttributes(local, 10)
      )
    ).not.toContain("Secure");
  });

  it("TW-SESSION the public view of a session never carries the bearer", () => {
    const view = publicSession(SESSION);
    expect(view).toEqual({
      signedIn: true,
      email: SESSION.email,
      expiresAt: SESSION.exp,
    });
    expect(JSON.stringify(view)).not.toContain(SESSION.bearer);
    expect(publicSession(null)).toEqual({
      signedIn: false,
      email: null,
      expiresAt: null,
    });
  });
});
