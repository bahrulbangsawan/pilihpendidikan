// Manual adds and tracked-job detail (05 §4, 11 T-08, 15 §14.4).
import { beforeEach, describe, expect, it } from "bun:test";
import {
  UserJobDetailSchema,
  UserJobResponseSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { DiscoveryFixture } from "./fixtures.test";
import { BOB, discoveryFixture, postingItem } from "./fixtures.test";

const SHA256_RE = /^[0-9a-f]{64}$/;

let f: DiscoveryFixture;

beforeEach(async () => {
  f = await discoveryFixture();
});

interface Added {
  posting: {
    id: string;
    source_kind: string;
    visibility: string;
    owner_user_id: string | null;
    title: string;
    apply_url: string | null;
    canonical_url: string | null;
    application_support: string;
  };
  user_job: {
    id: string;
    origin: string;
    inbox_state: string;
    user_notes: string;
  };
}

describe("TD-MANUAL-URL POST /api/v1/user-jobs (05 §4)", () => {
  it("TD-MANUAL-URL {url} stores a private custom_url stub without fetching anything", async () => {
    let fetched = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetched = true;
      return realFetch(...args);
    }) as typeof fetch;
    try {
      const res = await f.web.post<Added>("/api/v1/user-jobs", {
        url: "https://careers.acme.com/jobs/42?utm_source=x",
        user_notes: "From Dina",
      });
      expect(res.status).toBe(201);
      const body = UserJobResponseSchema.parse(res.body);
      expect(body.posting).toMatchObject({
        source_kind: "custom_url",
        visibility: "private",
        owner_user_id: f.web.userId,
        apply_url: "https://careers.acme.com/jobs/42?utm_source=x",
        canonical_url: "https://careers.acme.com/jobs/42",
        company_name: "acme.com",
        status: "open",
      });
      expect(body.user_job).toMatchObject({
        origin: "manual",
        inbox_state: "seen",
        user_notes: "From Dina",
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(fetched).toBe(false);
  });

  it("TD-MANUAL-URL the same URL twice links once (200 the second time)", async () => {
    const first = await f.web.post<Added>("/api/v1/user-jobs", {
      url: "https://careers.acme.com/jobs/42",
    });
    const again = await f.web.post<Added>("/api/v1/user-jobs", {
      url: "https://careers.acme.com/jobs/42",
    });
    expect(again.status).toBe(200);
    expect(again.body.user_job.id).toBe(first.body.user_job.id);
    const bob = await f.client.browserSession(BOB);
    const theirs = await bob.post<Added>("/api/v1/user-jobs", {
      url: "https://careers.acme.com/jobs/42",
    });
    expect(theirs.status).toBe(201);
    expect(theirs.body.posting.id).not.toBe(first.body.posting.id);
  });

  it("TD-MANUAL-URL URL validation: http/https only, no userinfo, ≤ 2048 (11 T-08)", async () => {
    const bad = [
      "javascript:alert(1)",
      "ftp://acme.com/jobs/1",
      "https://user:secret@acme.com/jobs/1",
      `https://acme.com/${"a".repeat(2050)}`,
      "file:///etc/passwd",
    ];
    for (const url of bad) {
      const res = await f.web.post("/api/v1/user-jobs", { url });
      expect(res.status).toBe(400);
    }
    expect(
      (
        await f.web.post("/api/v1/user-jobs", {
          url: "http://intranet.example/jobs/1",
        })
      ).status
    ).toBe(201);
  });

  it("TD-MANUAL-URL LinkedIn / Indeed URLs are 422; tracking them by hand is allowed but never automated", async () => {
    const stub = await f.web.post("/api/v1/user-jobs", {
      url: "https://www.linkedin.com/jobs/view/123",
    });
    expect(stub.status).toBe(422);
    expect(stub.body).toMatchObject({ error: "unsupported_source" });
    const manual = await f.web.post<Added>("/api/v1/user-jobs", {
      title: "Product Designer",
      company_name: "Acme",
      apply_url: "https://id.indeed.com/viewjob?jk=1",
    });
    expect(manual.status).toBe(201);
    expect(manual.body.posting).toMatchObject({
      source_kind: "manual",
      visibility: "private",
      application_support: "prohibited",
    });
  });

  it("TD-MANUAL-URL full posting fields create a private manual posting with server-side fp1 and hash", async () => {
    const res = await f.web.post<Added>("/api/v1/user-jobs", {
      title: "Office Manager",
      company_name: "Acme",
      company_domain: "acme.co.id",
      locations: [{ raw: "Bandung" }],
      description_text: "Run the office. ".repeat(10),
      salary: {
        min: 8_000_000,
        max: 12_000_000,
        currency: "IDR",
        period: "month",
      },
      user_notes: "Referral",
    });
    expect(res.status).toBe(201);
    const body = UserJobResponseSchema.parse(res.body);
    expect(body.posting).toMatchObject({
      source_kind: "manual",
      workplace_type: "unknown",
      employment_type: "unknown",
    });
    expect(body.posting.fingerprint.startsWith("fp1:")).toBe(true);
    expect(body.posting.dedupe_group).toMatch(SHA256_RE);
    expect(body.user_job.user_notes).toBe("Referral");
  });

  it("TD-MANUAL-URL control characters and unknown fields are refused", async () => {
    expect(
      (
        await f.web.post("/api/v1/user-jobs", {
          title: "Bad\u0000",
          company_name: "Acme",
        })
      ).status
    ).toBe(400);
    expect(
      (
        await f.web.post("/api/v1/user-jobs", {
          url: "https://acme.com/jobs/1",
          title: "mixed",
        })
      ).status
    ).toBe(400);
    const reader = await f.client.personalToken("alice@example.com", "read");
    expect(
      (
        await reader.post("/api/v1/user-jobs", {
          url: "https://acme.com/jobs/1",
        })
      ).status
    ).toBe(403);
  });
});

describe("TD-MANUAL-URL GET /api/v1/user-jobs/{ujb_id}", () => {
  it("TD-MANUAL-URL the detail returns posting, latest score and the application", async () => {
    const run = await f.startRun(f.cli);
    const res = await f.batch(f.cli, run, [await postingItem()]);
    const ujb = res.body.items[0].user_job_id ?? "";
    const detail = await f.web.get(`/api/v1/user-jobs/${ujb}`);
    expect(detail.status).toBe(200);
    const body = UserJobDetailSchema.parse(detail.body);
    expect(body.user_job.id).toBe(ujb);
    expect(body.score?.status).toBe("queued");
    expect(body.application).toBeNull();
    await f.web.post("/api/v1/inbox:bulk", {
      user_job_ids: [ujb],
      action: "track",
    });
    const tracked = UserJobDetailSchema.parse(
      (await f.web.get(`/api/v1/user-jobs/${ujb}`)).body
    );
    expect(tracked.application?.user_job_id).toBe(ujb);
    expect(tracked.user_job.inbox_state).toBe("tracked");
  });

  it("TD-MANUAL-URL another user's tracked job is 404", async () => {
    const added = await f.web.post<Added>("/api/v1/user-jobs", {
      url: "https://careers.acme.com/jobs/1",
    });
    const bob = await f.client.browserSession(BOB);
    expect(
      (await bob.get(`/api/v1/user-jobs/${added.body.user_job.id}`)).status
    ).toBe(404);
    expect((await f.web.get(`/api/v1/user-jobs/${newId("ujb")}`)).status).toBe(
      404
    );
  });
});
