// 05 §10 fact sheet: TP-FACTS (bulk upsert with per-fact base_revision,
// canonical keys, CV references, mirrors, profile_version → lazy re-score)
// and TP-IMPORT-CV (proposals from an owned base CV, nothing written).

import { describe, expect, it } from "bun:test";
import type {
  FactSheetResponse,
  ImportCvFactsResponse,
  PutFactsResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import type { TestEnv } from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import {
  rowsOf,
  seedApplication,
  seedUserJob,
} from "../../../../test/seed-jobs";
import {
  deriveCvFacts,
  githubProfile,
  linkedInUrl,
} from "../../services/profile/import-cv";

const FACTS = "/api/v1/profile/facts";

async function setup() {
  const t = createTestEnv();
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const alice = await client.browserSession("alice@example.com");
  const bob = await client.browserSession("bob@example.com");
  return { t, clock, client, alice, bob };
}

async function putCv(
  t: TestEnv,
  id: string,
  owner: string,
  doc: Record<string, unknown>
): Promise<void> {
  await t.env.CV_KV.put(`cv:${id}`, JSON.stringify(doc));
  await t.env.CV_KV.put(`owner:cv:${id}`, owner);
}

const CV_DOC = {
  personalInfo: {
    fullName: "Alice Pratama Putri",
    jobTitle: "Backend Engineer",
    email: "alice@example.com",
    phone: "+62 812 3456 7890",
    location: "Jakarta, Indonesia",
    linkedIn: "alice-pratama",
    photoUrl: "",
    usePhoto: false,
  },
  experience: [
    { id: "exp-1", company: "Acme", title: "Engineer", url: "" },
    { id: "exp-2", company: "Beta", title: "Intern", url: "" },
  ],
  education: [{ id: "edu-1", institution: "UI", degree: "S1" }],
  projects: [
    { id: "prj-1", name: "Tool", url: "https://github.com/alicep/tool" },
  ],
};

function changeRows(t: TestEnv, userId: string, entity: string) {
  return t.jobsSqlite
    .query(
      "SELECT entity, entity_id, revision, op FROM change_log WHERE user_id = ? AND entity = ? ORDER BY seq"
    )
    .all(userId, entity) as Array<{
    entity: string;
    entity_id: string;
    op: string;
    revision: number;
  }>;
}

describe("TP-FACTS fact sheet (05 §10)", () => {
  it("TP-FACTS GET returns an empty sheet and a profile_version for a new user", async () => {
    const { alice } = await setup();
    const res = await alice.get<FactSheetResponse>(FACTS);
    expect(res.status).toBe(200);
    expect(res.body.facts).toEqual([]);
    expect(Number.isSafeInteger(res.body.profile_version)).toBe(true);
    expect(res.headers.get("ETag")).toBeTruthy();
  });

  it("TP-FACTS PUT creates canonical facts (absent base_revision = create) and logs fact changes", async () => {
    const { t, alice } = await setup();
    const res = await alice.put<PutFactsResponse>(FACTS, {
      facts: [
        { key: "contact.phone", value: "+62 811 000 111" },
        { key: "work_auth.ID", value: { status: "citizen" } },
        { key: "prefs.target_titles", value: ["Backend Engineer"] },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => r.status)).toEqual([
      "created",
      "created",
      "created",
    ]);
    expect(res.body.facts.map((f) => f.key)).toEqual([
      "contact.phone",
      "prefs.target_titles",
      "work_auth.ID",
    ]);
    const phone = res.body.facts.find((f) => f.key === "contact.phone");
    expect(phone).toMatchObject({
      value: "+62 811 000 111",
      source: "user_entered",
      revision: 1,
      user_id: alice.userId,
    });
    expect(phone?.id.startsWith("fct_")).toBe(true);
    const changes = changeRows(t, alice.userId as string, "fact");
    expect(changes).toHaveLength(3);
    expect(changes.every((c) => c.op === "upsert" && c.revision === 1)).toBe(
      true
    );
    const sheet = await alice.get<FactSheetResponse>(FACTS);
    expect(sheet.body.facts).toHaveLength(3);
    expect(sheet.body.profile_version).toBe(res.body.profile_version);
  });

  it("TP-FACTS invalid facts are reported per key while the valid ones apply", async () => {
    const { alice } = await setup();
    const res = await alice.put<PutFactsResponse>(FACTS, {
      facts: [
        { key: "favourite.colour", value: "blue" },
        { key: "contact.email", value: "not-an-email" },
        { key: "links.github", value: "https://github.com/alice" },
        { key: "contact.phone", value: "+62 1", source: "verified_document" },
        { key: "contact.location", value: "Bandung", source: "cv_import" },
      ],
    });
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      res.body.results.map((r) => [r.key, r] as const)
    );
    expect(byKey["favourite.colour"]?.status).toBe("invalid");
    expect(byKey["favourite.colour"]?.error).toContain("unknown fact key");
    expect(byKey["contact.email"]?.status).toBe("invalid");
    expect(byKey["links.github"]?.status).toBe("created");
    expect(byKey["contact.phone"]?.status).toBe("invalid");
    expect(byKey["contact.location"]?.status).toBe("invalid");
    expect(res.body.facts.map((f) => f.key)).toEqual(["links.github"]);
  });

  it("TP-FACTS a stale base_revision is a conflict with the current fact; the matching one updates", async () => {
    const { t, alice } = await setup();
    await alice.put(FACTS, {
      facts: [{ key: "contact.phone", value: "+62 811 000 111" }],
    });
    const stale = await alice.put<PutFactsResponse>(FACTS, {
      facts: [{ key: "contact.phone", value: "+62 822", base_revision: 7 }],
    });
    expect(stale.body.results[0]).toMatchObject({
      key: "contact.phone",
      status: "conflict",
      current: { value: "+62 811 000 111", revision: 1 },
    });
    const ok = await alice.put<PutFactsResponse>(FACTS, {
      facts: [{ key: "contact.phone", value: "+62 822", base_revision: 1 }],
    });
    expect(ok.body.results[0]).toMatchObject({
      status: "updated",
      fact: { value: "+62 822", revision: 2 },
    });
    expect(
      rowsOf(t.jobsSqlite, "applicant_facts", alice.userId as string)
    ).toHaveLength(1);
    const changes = changeRows(t, alice.userId as string, "fact");
    expect(changes.map((c) => c.revision)).toEqual([1, 2]);
  });

  it("TP-FACTS an existing key without base_revision conflicts; the same value is unchanged", async () => {
    const { alice } = await setup();
    await alice.put(FACTS, {
      facts: [{ key: "contact.location", value: "Jakarta" }],
    });
    const same = await alice.put<PutFactsResponse>(FACTS, {
      facts: [{ key: "contact.location", value: "Jakarta" }],
    });
    expect(same.body.results[0]?.status).toBe("unchanged");
    const different = await alice.put<PutFactsResponse>(FACTS, {
      facts: [{ key: "contact.location", value: "Surabaya" }],
    });
    expect(different.body.results[0]).toMatchObject({
      status: "conflict",
      current: { value: "Jakarta" },
    });
    const gone = await alice.put<PutFactsResponse>(FACTS, {
      facts: [{ key: "contact.phone", value: "+62 811", base_revision: 3 }],
    });
    expect(gone.body.results[0]?.status).toBe("conflict");
    expect(gone.body.results[0]?.current).toBeUndefined();
  });

  it("TP-FACTS delete_keys remove facts with a delete tombstone; a key named twice is invalid", async () => {
    const { t, alice } = await setup();
    const created = await alice.put<PutFactsResponse>(FACTS, {
      facts: [
        { key: "contact.phone", value: "+62 811 000 111" },
        { key: "links.website", value: "https://alice.dev" },
      ],
    });
    const phoneId = created.body.facts.find(
      (f) => f.key === "contact.phone"
    )?.id;
    const res = await alice.put<PutFactsResponse>(FACTS, {
      facts: [{ key: "links.website", value: "https://alice.id" }],
      delete_keys: ["contact.phone", "links.website", "links.github"],
    });
    const byKey = Object.fromEntries(
      res.body.results.map((r) => [`${r.key}:${r.status}`, r] as const)
    );
    expect(byKey["contact.phone:deleted"]).toBeDefined();
    expect(byKey["links.github:unchanged"]).toBeDefined();
    expect(byKey["links.website:invalid"]).toBeDefined();
    expect(res.body.facts.map((f) => f.key)).toEqual(["links.website"]);
    const tombstone = changeRows(t, alice.userId as string, "fact").find(
      (c) => c.op === "delete"
    );
    expect(tombstone).toMatchObject({ entity_id: phoneId, revision: 2 });
  });

  it("TP-FACTS CV references must name an owned CV and match their key", async () => {
    const { t, alice } = await setup();
    await putCv(t, "alice-cv", "alice@example.com", CV_DOC);
    await putCv(t, "bob-cv", "bob@example.com", CV_DOC);
    const res = await alice.put<PutFactsResponse>(FACTS, {
      facts: [
        { key: "profile.primary_cv_id", value: "bob-cv" },
        {
          key: "experience[exp-1]",
          value: { cv_id: "alice-cv", cv_entry_id: "exp-1" },
          source: "cv_import",
        },
        {
          key: "education[edu-1]",
          value: { cv_id: "alice-cv", cv_entry_id: "edu-9" },
        },
        {
          key: "experience[exp-2]",
          value: { cv_id: "bob-cv", cv_entry_id: "exp-2" },
        },
      ],
    });
    const statuses = res.body.results.map((r) => [r.key, r.status]);
    expect(statuses).toEqual([
      ["profile.primary_cv_id", "invalid"],
      ["experience[exp-1]", "created"],
      ["education[edu-1]", "invalid"],
      ["experience[exp-2]", "invalid"],
    ]);
    const ref = res.body.facts.find((f) => f.key === "experience[exp-1]");
    expect(ref).toMatchObject({ cv_id: "alice-cv", cv_entry_id: "exp-1" });
    const primary = await alice.put<PutFactsResponse>(FACTS, {
      facts: [{ key: "profile.primary_cv_id", value: "alice-cv" }],
    });
    expect(primary.body.results[0]?.status).toBe("created");
  });

  it("TP-FACTS a profile change re-queues scoring for inbox new/seen and active applications", async () => {
    const { t, alice } = await setup();
    const userId = alice.userId as string;
    const inboxNew = seedUserJob(t.jobsSqlite, userId, { inbox_state: "new" });
    const inboxSeen = seedUserJob(t.jobsSqlite, userId, {
      inbox_state: "seen",
    });
    const dismissed = seedUserJob(t.jobsSqlite, userId, {
      inbox_state: "dismissed",
    });
    const active = seedApplication(t.jobsSqlite, userId, { stage: "applied" });
    const closed = seedApplication(t.jobsSqlite, userId, {
      stage: "rejected",
    });
    const before = (await alice.get<FactSheetResponse>(FACTS)).body
      .profile_version;
    const res = await alice.put<PutFactsResponse>(FACTS, {
      facts: [{ key: "skills.extra", value: ["Rust", "Go"] }],
    });
    expect(res.body.profile_version).not.toBe(before);
    const queued = t.jobsSqlite
      .query(
        "SELECT posting_id, profile_version, status FROM match_scores WHERE user_id = ?"
      )
      .all(userId) as Array<{
      posting_id: string;
      profile_version: number;
      status: string;
    }>;
    expect(queued.map((q) => q.posting_id).sort()).toEqual(
      [inboxNew.posting_id, inboxSeen.posting_id, active.posting_id].sort()
    );
    expect(
      queued.every(
        (q) =>
          q.status === "queued" &&
          q.profile_version === res.body.profile_version
      )
    ).toBe(true);
    const messages = t.queue.sent.filter(
      (m) => m.body.type === "score_postings"
    );
    expect(messages).toHaveLength(1);
    const ids = messages.flatMap((m) =>
      m.body.type === "score_postings" ? m.body.posting_ids : []
    );
    expect(ids).not.toContain(dismissed.posting_id);
    expect(ids).not.toContain(closed.posting_id);
    // The same request again changes nothing and queues nothing new.
    await alice.put(FACTS, {
      facts: [{ key: "skills.extra", value: ["Rust", "Go"] }],
    });
    expect(
      t.queue.sent.filter((m) => m.body.type === "score_postings")
    ).toHaveLength(1);
  });

  it("TP-FACTS prefs.timezone mirrors into user_settings and sends rebuild_analytics", async () => {
    const { t, alice } = await setup();
    const res = await alice.put<PutFactsResponse>(FACTS, {
      facts: [
        { key: "prefs.timezone", value: "Asia/Makassar" },
        { key: "prefs.ai_scoring_sensitive", value: false },
      ],
    });
    expect(res.body.results.map((r) => r.status)).toEqual([
      "created",
      "created",
    ]);
    const settings = await alice.get<{
      settings: { ai_scoring_sensitive: boolean; timezone: string };
    }>("/api/v1/settings");
    expect(settings.body.settings).toMatchObject({
      timezone: "Asia/Makassar",
      ai_scoring_sensitive: false,
    });
    const rebuild = t.queue.sent.filter(
      (m) => m.body.type === "rebuild_analytics"
    );
    expect(rebuild).toHaveLength(1);
    expect(rebuild[0]?.body).toMatchObject({
      user_id: alice.userId,
      reason: "timezone_change",
    });
    const badZone = await alice.put<PutFactsResponse>(FACTS, {
      facts: [
        { key: "prefs.timezone", value: "Mars/Olympus", base_revision: 1 },
      ],
    });
    expect(badZone.body.results[0]?.status).toBe("invalid");
  });

  it("TP-FACTS scopes and isolation: read tokens read only; another user sees nothing", async () => {
    const { client, alice, bob } = await setup();
    await alice.put(FACTS, {
      facts: [{ key: "contact.phone", value: "+62 811 000 111" }],
    });
    const reader = await client.personalToken("alice@example.com", "read");
    const read = await reader.get<FactSheetResponse>(FACTS);
    expect(read.status).toBe(200);
    expect(read.body.facts).toHaveLength(1);
    const write = await reader.put(FACTS, { facts: [] });
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({ error: "insufficient_scope" });
    const other = await bob.get<FactSheetResponse>(FACTS);
    expect(other.body.facts).toEqual([]);
    const cross = await bob.put<PutFactsResponse>(FACTS, {
      facts: [{ key: "contact.phone", value: "+62 899", base_revision: 1 }],
    });
    expect(cross.body.results[0]?.status).toBe("conflict");
    expect(cross.body.results[0]?.current).toBeUndefined();
  });

  it("TP-FACTS a keyed PUT is replayed with its stored response", async () => {
    const { t, alice } = await setup();
    const body = { facts: [{ key: "contact.phone", value: "+62 811 222" }] };
    const first = await alice.put<PutFactsResponse>(FACTS, body, {
      idempotencyKey: "facts-1",
    });
    const replay = await alice.put<PutFactsResponse>(FACTS, body, {
      idempotencyKey: "facts-1",
    });
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.body).toEqual(first.body);
    expect(
      rowsOf(t.jobsSqlite, "applicant_facts", alice.userId as string)
    ).toHaveLength(1);
    const mismatch = await alice.put(
      FACTS,
      { facts: [{ key: "contact.phone", value: "+62 999" }] },
      { idempotencyKey: "facts-1" }
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body).toMatchObject({ error: "idempotency_mismatch" });
  });
});

describe("TP-IMPORT-CV proposals from a base CV (05 §10)", () => {
  it("TP-IMPORT-CV proposes contact, links, entry references and primary_cv_id without writing", async () => {
    const { t, alice } = await setup();
    await putCv(t, "alice-cv", "alice@example.com", CV_DOC);
    const res = await alice.post<ImportCvFactsResponse>(
      "/api/v1/profile/facts:import-cv",
      { cv_id: "alice-cv" }
    );
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      res.body.proposals.map((p) => [p.key, p] as const)
    );
    expect(byKey["contact.full_name"]?.value).toBe("Alice Pratama Putri");
    expect(byKey["contact.first_name"]?.value).toBe("Alice");
    expect(byKey["contact.last_name"]?.value).toBe("Pratama Putri");
    expect(byKey["contact.email"]?.value).toBe("alice@example.com");
    expect(byKey["contact.phone"]?.value).toBe("+62 812 3456 7890");
    expect(byKey["contact.location"]?.value).toBe("Jakarta, Indonesia");
    expect(byKey["links.linkedin"]?.value).toBe(
      "https://www.linkedin.com/in/alice-pratama"
    );
    expect(byKey["links.github"]?.value).toBe("https://github.com/alicep");
    expect(byKey["experience[exp-1]"]).toMatchObject({
      value: { cv_id: "alice-cv", cv_entry_id: "exp-1" },
      cv_entry_id: "exp-1",
    });
    expect(byKey["experience[exp-2]"]).toBeDefined();
    expect(byKey["education[edu-1]"]).toBeDefined();
    expect(byKey["profile.primary_cv_id"]?.value).toBe("alice-cv");
    for (const proposal of res.body.proposals) {
      expect(proposal.source).toBe("cv_import");
      expect(proposal.cv_id).toBe("alice-cv");
      expect(proposal.current).toBeNull();
    }
    expect(
      rowsOf(t.jobsSqlite, "applicant_facts", alice.userId as string)
    ).toHaveLength(0);
  });

  it("TP-IMPORT-CV accepted proposals round-trip through PUT, and later imports show the current fact", async () => {
    const { t, alice } = await setup();
    await putCv(t, "alice-cv", "alice@example.com", CV_DOC);
    const first = await alice.post<ImportCvFactsResponse>(
      "/api/v1/profile/facts:import-cv",
      { cv_id: "alice-cv" }
    );
    const put = await alice.put<PutFactsResponse>(FACTS, {
      facts: first.body.proposals.map((p) => ({
        key: p.key,
        value: p.value,
        source: p.source,
        cv_id: p.cv_id,
        cv_entry_id: p.cv_entry_id,
      })),
    });
    expect(put.body.results.every((r) => r.status === "created")).toBe(true);
    expect(put.body.facts.every((f) => f.source === "cv_import")).toBe(true);
    const again = await alice.post<ImportCvFactsResponse>(
      "/api/v1/profile/facts:import-cv",
      { cv_id: "alice-cv" }
    );
    const phone = again.body.proposals.find((p) => p.key === "contact.phone");
    expect(phone?.current).toMatchObject({
      key: "contact.phone",
      source: "cv_import",
      revision: 1,
    });
  });

  it("TP-IMPORT-CV another user's CV and a missing CV are not found", async () => {
    const { t, alice } = await setup();
    await putCv(t, "bob-cv", "bob@example.com", CV_DOC);
    const foreign = await alice.post("/api/v1/profile/facts:import-cv", {
      cv_id: "bob-cv",
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ error: "not_found" });
    const missing = await alice.post("/api/v1/profile/facts:import-cv", {
      cv_id: "nope",
    });
    expect(missing.status).toBe(404);
    const reader = await createV1Client(t).personalToken(
      "alice@example.com",
      "read"
    );
    const denied = await reader.post("/api/v1/profile/facts:import-cv", {
      cv_id: "bob-cv",
    });
    expect(denied.status).toBe(403);
  });

  it("TP-IMPORT-CV derivation skips blank and malformed values", () => {
    expect(linkedInUrl("https://www.linkedin.com/in/someone/")).toBe(
      "https://www.linkedin.com/in/someone"
    );
    expect(linkedInUrl("https://evil.example/in/someone")).toBeNull();
    expect(linkedInUrl("")).toBeNull();
    expect(
      githubProfile([
        { url: "github.com/settings" },
        { url: "https://gitlab.com/x" },
        { url: "https://github.com/octo/repo" },
      ])
    ).toBe("https://github.com/octo");
    const facts = deriveCvFacts("cv-1", {
      personalInfo: { fullName: "Madonna", email: "bad", phone: "" },
      experience: [{ id: "has space" }],
    });
    const keys = facts.map((f) => f.key);
    expect(keys).toEqual([
      "contact.full_name",
      "contact.first_name",
      "profile.primary_cv_id",
    ]);
  });
});
