import { describe, expect, it } from "bun:test";
import { createBrowserSession } from "../session";
import {
  createTestEnv,
  createToolSession,
  createV1Client,
  jsonOf,
  textOf,
} from "../../test/fakes";
import type { TestEnv } from "../../test/fakes";
import {
  crockfordBase32,
  slugStem,
  tailoredCvSlug,
} from "../jobs/services/cv/slug";
import { sampleCv } from "../jobs/services/cv/tailoring/fixtures";
import {
  createCvDocument,
  cvCanonicalSha256,
  isPrivateCv,
  isTailoredCvId,
} from "./cv-create";
import { handlePdfRoute, handlePublicRead } from "./handlers";
import { DOCUMENT_SPECS } from "./kinds";

const OWNER = "rahma@example.com";
const OTHER = "budi@example.com";
const ADMIN = "admin@example.com";
const TAILORED = "rahma-cv-t-7k2m9q4x1d";
const API = "https://api.pilihpendidikan.com";
const TAILORED_SLUG_FORMAT = /^rahma-cv-t-[0-9a-hjkmnp-tv-z]{10}$/;
const HEX_KEY = /^[0-9a-f]{64}$/;

async function setup(): Promise<TestEnv> {
  const t = createTestEnv();
  await createCvDocument(t.env, { email: OWNER }, "rahma-cv", sampleCv());
  await createCvDocument(t.env, { email: OWNER }, TAILORED, {
    ...sampleCv(),
    visibility: "private",
  });
  return t;
}

async function call(
  t: TestEnv,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return await createV1Client(t).fetch(new Request(`${API}${path}`, init));
}

async function bearer(
  t: TestEnv,
  email: string
): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await createBrowserSession(t.env, email)}`,
  };
}

describe("TCV-PRIVATE private CVs (D-25)", () => {
  it("TCV-PRIVATE a private CV is 404 on the public JSON route, its aliases and the PDF redirect", async () => {
    const t = await setup();
    for (const path of [
      `/api/cv/${TAILORED}`,
      `/api/cv/${TAILORED}.json`,
      `/api/cv/${TAILORED}.pdf`,
      `/api/cv/${TAILORED}?download`,
      `/cv/${TAILORED}.pdf`,
    ]) {
      const res = await call(t, path);
      expect(res.status).toBe(404);
    }
    // Another signed-in user and an admin (no bypass) see the same 404.
    for (const email of [OTHER, ADMIN]) {
      const res = await call(t, `/api/cv/${TAILORED}`, {
        headers: await bearer(t, email),
      });
      expect(res.status).toBe(404);
    }
  });

  it("TCV-PRIVATE the owner's own request reads it (noindex) and gets the print redirect", async () => {
    const t = await setup();
    const url = new URL(`${API}/api/cv/${TAILORED}`);
    const request = new Request(url, { headers: await bearer(t, OWNER) });
    const res = await handlePublicRead(
      t.env,
      DOCUMENT_SPECS.cv,
      TAILORED,
      "json",
      url,
      request
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(((await res.json()) as { visibility: string }).visibility).toBe(
      "private"
    );
    const cookie = new Request(url, {
      headers: {
        Cookie: `__Host-session=${await createBrowserSession(t.env, OWNER)}`,
      },
    });
    expect(
      (
        await handlePublicRead(
          t.env,
          DOCUMENT_SPECS.cv,
          TAILORED,
          "json",
          url,
          cookie
        )
      ).status
    ).toBe(200);
    const pdfUrl = new URL(`${API}/cv/${TAILORED}.pdf`);
    const redirect = await handlePdfRoute(
      t.env,
      "cv",
      TAILORED,
      pdfUrl,
      request
    );
    expect(redirect.status).toBe(302);
    const stranger = new Request(url, { headers: await bearer(t, OTHER) });
    expect(
      (await handlePdfRoute(t.env, "cv", TAILORED, pdfUrl, stranger)).status
    ).toBe(404);
  });

  it("TCV-PRIVATE public CVs keep today's behaviour; a public -t- slug is still noindex", async () => {
    const t = await setup();
    const res = await call(t, "/api/cv/rahma-cv");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
    expect((await call(t, "/cv/rahma-cv.pdf")).status).toBe(302);
    await createCvDocument(
      t.env,
      { email: OWNER },
      "rahma-cv-t-abcdefghjk",
      sampleCv()
    );
    const shared = await call(t, "/api/cv/rahma-cv-t-abcdefghjk");
    expect(shared.status).toBe(200);
    expect(shared.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("TCV-PRIVATE a builder save without `visibility` keeps the CV private; bad values are refused", async () => {
    const t = await setup();
    const headers = {
      ...(await bearer(t, OWNER)),
      "Content-Type": "application/json",
    };
    const { visibility: _drop, ...withoutVisibility } = {
      ...sampleCv(),
      visibility: "private",
    };
    const save = await call(t, `/api/cv/${TAILORED}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...withoutVisibility, summary: "Edited." }),
    });
    expect(save.status).toBe(200);
    const stored = JSON.parse(
      t.kv.CV_KV.store.get(`cv:${TAILORED}`)?.value ?? "{}"
    );
    expect(stored.visibility).toBe("private");
    expect(stored.summary).toBe("Edited.");
    expect((await call(t, `/api/cv/${TAILORED}`)).status).toBe(404);
    const bad = await call(t, `/api/cv/${TAILORED}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...withoutVisibility, visibility: "friends" }),
    });
    expect(bad.status).toBe(422);
    const publish = await call(t, `/api/cv/${TAILORED}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...withoutVisibility, visibility: "public" }),
    });
    expect(publish.status).toBe(200);
    expect((await call(t, `/api/cv/${TAILORED}`)).status).toBe(200);
  });

  it("TCV-PRIVATE MCP cv_get refuses another user's private CV even for admins; cv_list hides it", async () => {
    const t = await setup();
    const admin = createToolSession(t.env, {
      email: ADMIN,
      isAdmin: true,
      scope: "write",
    });
    expect(textOf(await admin.call("cv_get", { cv_id: TAILORED }))).toContain(
      "not found"
    );
    expect(
      jsonOf<Record<string, unknown>>(
        await admin.call("cv_get", { cv_id: "rahma-cv" })
      ).summary
    ).toBeDefined();
    const listed = jsonOf<Array<{ id: string }>>(await admin.call("cv_list"));
    expect(listed.map((c) => c.id)).toEqual(["rahma-cv"]);
    const owner = createToolSession(t.env, {
      email: OWNER,
      isAdmin: false,
      scope: "write",
    });
    expect(
      jsonOf<{ visibility: string }>(
        await owner.call("cv_get", { cv_id: TAILORED })
      ).visibility
    ).toBe("private");
    expect(
      jsonOf<Array<{ id: string }>>(await owner.call("cv_list")).map(
        (c) => c.id
      )
    ).toEqual(["rahma-cv", TAILORED]);
  });
});

describe("T8-07 tailored documents share the cv_create code path", () => {
  it("T8-07 createCvDocument stamps the owner and refuses an existing id", async () => {
    const t = createTestEnv();
    const first = await createCvDocument(
      t.env,
      { email: OWNER },
      "x",
      sampleCv()
    );
    expect(first).toEqual({ ok: true, created: true });
    expect(t.kv.CV_KV.store.get("owner:cv:x")?.value).toBe(OWNER);
    expect(t.kv.CV_KV.store.get("cv:x")?.metadata).toEqual({
      fullName: "Rahma Putri",
      jobTitle: "Backend Engineer",
    });
    expect(
      await createCvDocument(t.env, { email: OWNER }, "x", sampleCv())
    ).toEqual({
      ok: false,
      reason: "duplicate",
    });
    // A deterministic retry may overwrite its own document, never someone else's.
    expect(
      await createCvDocument(t.env, { email: OWNER }, "x", sampleCv(), {
        replaceOwned: true,
      })
    ).toEqual({ ok: true, created: false });
    expect(
      await createCvDocument(t.env, { email: OTHER }, "x", sampleCv(), {
        replaceOwned: true,
      })
    ).toEqual({ ok: false, reason: "duplicate" });
    expect(t.kv.CV_KV.store.get("owner:cv:x")?.value).toBe(OWNER);
  });

  it("T8-07 MCP cv_create goes through createCvDocument (owner stamp, duplicate refusal)", async () => {
    const t = createTestEnv();
    const owner = createToolSession(t.env, {
      email: OWNER,
      isAdmin: false,
      scope: "write",
    });
    const created = await owner.call("cv_create", {
      cv_id: "mine",
      full_name: "Rahma",
    });
    expect(textOf(created)).toContain('CV "mine" created successfully.');
    expect(t.kv.CV_KV.store.get("owner:cv:mine")?.value).toBe(OWNER);
    const before = t.kv.CV_KV.store.get("cv:mine")?.value;
    const other = createToolSession(t.env, {
      email: OTHER,
      isAdmin: false,
      scope: "write",
    });
    const dup = await other.call("cv_create", {
      cv_id: "mine",
      full_name: "Budi",
    });
    expect(textOf(dup)).toContain("already exists");
    expect(t.kv.CV_KV.store.get("cv:mine")?.value).toBe(before);
    expect(t.kv.CV_KV.store.get("owner:cv:mine")?.value).toBe(OWNER);
  });

  it("T8-07 the slug is <base>-t-<10 Crockford base32>, deterministic per variant, 50 bits", async () => {
    const t = createTestEnv();
    const a = await tailoredCvSlug(
      t.env,
      "rahma-cv",
      "cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D"
    );
    expect(a).toMatch(TAILORED_SLUG_FORMAT);
    expect(isTailoredCvId(a)).toBe(true);
    expect(
      await tailoredCvSlug(t.env, "rahma-cv", "cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D")
    ).toBe(a);
    // Re-tailoring a tailored CV does not stack suffixes.
    expect(slugStem(a)).toBe("rahma-cv");
    // The key is a server secret in AUTH_KV: another deployment derives other slugs.
    const elsewhere = createTestEnv();
    expect(
      await tailoredCvSlug(
        elsewhere.env,
        "rahma-cv",
        "cvv_01JA6V8M3W8Z1T6Q4Y2B7K9C0D"
      )
    ).not.toBe(a);
    const key = t.kv.AUTH_KV.store.get("jobs:cv-slug-key")?.value ?? "";
    expect(key).toMatch(HEX_KEY);
    // 10 base32 characters = 50 bits; 300 variants give 300 distinct suffixes.
    const suffixes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      suffixes.add((await tailoredCvSlug(t.env, "cv", `cvv_${i}`)).slice(-10));
    }
    expect(suffixes.size).toBe(300);
    expect(
      crockfordBase32(
        new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        10
      )
    ).toBe("zzzzzzzzzz");
    expect(crockfordBase32(new Uint8Array(8), 10)).toBe("0000000000");
  });

  it("T8-07 privacy helpers and the canonical document fingerprint", async () => {
    expect(isPrivateCv({ visibility: "private" })).toBe(true);
    expect(isPrivateCv({})).toBe(false);
    expect(isTailoredCvId("my-cv")).toBe(false);
    const cv = sampleCv();
    const reordered = Object.fromEntries(Object.entries(cv).reverse());
    expect(await cvCanonicalSha256(reordered)).toBe(
      await cvCanonicalSha256(cv)
    );
    expect(await cvCanonicalSha256({ ...cv, summary: "x" })).not.toBe(
      await cvCanonicalSha256(cv)
    );
  });
});
