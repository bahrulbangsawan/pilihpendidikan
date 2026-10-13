// 05 §10a settings: TP-SETTINGS (lazy row, base_revision, mirrors of 03 §9,
// rebuild_analytics on a timezone change, ai_consent_at, automation_paused
// reaching running workers through the heartbeat, default_mode guard).

import { describe, expect, it } from "bun:test";
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type { UserSettingsRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import {
  seedApplication,
  seedAttempt,
  seedTask,
  seedUserJob,
} from "../../../../test/seed-jobs";

const SETTINGS = "/api/v1/settings";
interface SettingsBody {
  settings: UserSettingsRecord;
}

async function setup(flags: Record<string, boolean> = {}) {
  const t = createTestEnv({}, { flags });
  const clock = createFakeClock();
  const client = createV1Client(t, { clock });
  const alice = await client.browserSession("alice@example.com");
  return { t, clock, client, alice };
}

describe("TP-SETTINGS user settings (05 §10a, 04 §2.7)", () => {
  it("TP-SETTINGS GET creates the row lazily with the 04 §2.7 defaults", async () => {
    const { t, alice } = await setup();
    const res = await alice.get<SettingsBody>(SETTINGS);
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      user_id: alice.userId,
      locale: "en",
      timezone: "Asia/Jakarta",
      default_mode: "approval",
      automation_paused: false,
      generated_text_allowed: false,
      allow_mcp_approvals: false,
      ai_consent_at: null,
      ai_scoring_sensitive: true,
      evidence_screenshots: "on_submit",
      evidence_retention_days: 180,
      revision: 1,
    });
    const again = await alice.get(SETTINGS, {
      headers: { "If-None-Match": res.headers.get("ETag") ?? "" },
    });
    expect(again.status).toBe(304);
    expect(
      t.jobsSqlite
        .query("SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?")
        .get(alice.userId)
    ).toEqual({ n: 1 });
  });

  it("TP-SETTINGS PATCH changes fields, bumps the revision and logs a settings change", async () => {
    const { t, alice } = await setup();
    await alice.get(SETTINGS);
    const res = await alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 1,
      locale: "id",
      generated_text_allowed: true,
      allow_mcp_approvals: true,
      evidence_screenshots: "all_steps",
      evidence_retention_days: 90,
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      locale: "id",
      generated_text_allowed: true,
      allow_mcp_approvals: true,
      evidence_screenshots: "all_steps",
      evidence_retention_days: 90,
      revision: 2,
    });
    const stored = await alice.get<SettingsBody>(SETTINGS);
    expect(stored.body.settings).toEqual(res.body.settings);
    const changes = t.jobsSqlite
      .query(
        "SELECT entity_id, revision FROM change_log WHERE user_id = ? AND entity = 'settings' ORDER BY seq"
      )
      .all(alice.userId);
    expect(changes.at(-1)).toEqual({ entity_id: alice.userId, revision: 2 });
  });

  it("TP-SETTINGS a stale or missing base_revision is refused", async () => {
    const { alice } = await setup();
    const stale = await alice.patch(SETTINGS, {
      base_revision: 5,
      locale: "id",
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: "revision_conflict",
      details: { current: { revision: 1, locale: "en" } },
    });
    const missing = await alice.patch(SETTINGS, { locale: "id" });
    expect(missing.status).toBe(400);
    const noop = await alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 1,
      locale: "en",
    });
    expect(noop.status).toBe(200);
    expect(noop.body.settings.revision).toBe(1);
  });

  it("TP-SETTINGS ai_consent sets and clears ai_consent_at", async () => {
    const { clock, alice } = await setup();
    const given = await alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 1,
      ai_consent: true,
    });
    expect(given.body.settings.ai_consent_at).toBe(clock.now());
    clock.advance(60_000);
    const repeat = await alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 2,
      ai_consent: true,
    });
    expect(repeat.body.settings.ai_consent_at).toBe(clock.now() - 60_000);
    expect(repeat.body.settings.revision).toBe(2);
    const withdrawn = await alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 2,
      ai_consent: false,
    });
    expect(withdrawn.body.settings.ai_consent_at).toBeNull();
  });

  it("TP-SETTINGS a timezone change mirrors prefs.timezone and sends rebuild_analytics", async () => {
    const { t, alice } = await setup();
    const res = await alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 1,
      timezone: "Europe/Amsterdam",
    });
    expect(res.body.settings.timezone).toBe("Europe/Amsterdam");
    const fact = t.jobsSqlite
      .query(
        "SELECT value, source, revision FROM applicant_facts WHERE user_id = ? AND key = 'prefs.timezone'"
      )
      .get(alice.userId);
    expect(fact).toEqual({
      value: '"Europe/Amsterdam"',
      source: "user_entered",
      revision: 1,
    });
    const messages = t.queue.sent.filter(
      (m) => m.body.type === "rebuild_analytics"
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toMatchObject({
      v: 1,
      user_id: alice.userId,
      reason: "timezone_change",
    });
    const invalid = await alice.patch(SETTINGS, {
      base_revision: 2,
      timezone: "Not/AZone",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: "invalid_request" });
    const sameZone = await alice.patch(SETTINGS, {
      base_revision: 2,
      timezone: "Europe/Amsterdam",
    });
    expect(sameZone.status).toBe(200);
    expect(
      t.queue.sent.filter((m) => m.body.type === "rebuild_analytics")
    ).toHaveLength(1);
  });

  it("TP-SETTINGS ai_scoring_sensitive mirrors its fact, changes profile_version and re-queues scoring", async () => {
    const { t, alice } = await setup();
    seedUserJob(t.jobsSqlite, alice.userId as string, { inbox_state: "seen" });
    const before = (
      await alice.get<{ profile_version: number }>("/api/v1/profile/facts")
    ).body.profile_version;
    const res = await alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 1,
      ai_scoring_sensitive: false,
    });
    expect(res.body.settings.ai_scoring_sensitive).toBe(false);
    const facts = await alice.get<{
      facts: Array<{ key: string; value: unknown }>;
      profile_version: number;
    }>("/api/v1/profile/facts");
    expect(facts.body.facts).toEqual([
      expect.objectContaining({
        key: "prefs.ai_scoring_sensitive",
        value: false,
      }),
    ]);
    expect(facts.body.profile_version).not.toBe(before);
    expect(
      t.queue.sent.filter((m) => m.body.type === "score_postings")
    ).toHaveLength(1);
  });

  it("TP-SETTINGS an AI consent flip changes profile_version and re-queues scoring; a repeat does not", async () => {
    const { t, alice } = await setup();
    seedUserJob(t.jobsSqlite, alice.userId as string, { inbox_state: "new" });
    seedApplication(t.jobsSqlite, alice.userId as string, { stage: "saved" });
    const version = async () =>
      (await alice.get<{ profile_version: number }>("/api/v1/profile/facts"))
        .body.profile_version;
    const scored = () =>
      t.queue.sent.filter((m) => m.body.type === "score_postings");
    const before = await version();
    await alice.patch(SETTINGS, { base_revision: 1, ai_consent: true });
    const granted = await version();
    expect(granted).not.toBe(before);
    expect(scored()).toHaveLength(1);
    expect(scored()[0]?.body).toMatchObject({ profile_version: granted });
    expect(
      (scored()[0]?.body as { posting_ids: string[] }).posting_ids
    ).toHaveLength(2);
    // Same consent again: nothing changes, nothing is queued.
    await alice.patch(SETTINGS, { base_revision: 2, ai_consent: true });
    expect(await version()).toBe(granted);
    expect(scored()).toHaveLength(1);
    // Withdrawing consent is another profile version.
    await alice.patch(SETTINGS, { base_revision: 2, ai_consent: false });
    const withdrawn = await version();
    expect(withdrawn).not.toBe(granted);
    expect(withdrawn).toBe(before);
    expect(scored()).toHaveLength(2);
  });

  it("TP-SETTINGS automation_paused makes a running worker's heartbeat answer cancel_requested", async () => {
    const { t, clock, client, alice } = await setup({
      JOBS_AUTOMATION_ENABLED: true,
    });
    const cli = await client.cliSession("alice@example.com");
    const userId = alice.userId as string;
    const app = seedApplication(t.jobsSqlite, userId, { stage: "ready" });
    const leaseId = newId("lse", clock.now());
    const task = seedTask(t.jobsSqlite, userId, {
      application_id: app.id,
      state: "running",
      lease_id: leaseId,
      lease_device_id: cli.deviceId,
      lease_expires_at: clock.now() + 120_000,
      attempt_count: 1,
    });
    seedAttempt(t.jobsSqlite, userId, {
      task_id: task.id,
      lease_id: leaseId,
      device_id: cli.deviceId as string,
      started_at: clock.now(),
      last_heartbeat_at: clock.now(),
    });
    const beat = (n: number) =>
      cli.post<{ cancel_requested: boolean }>(
        `/api/v1/tasks/${task.id}/lease/${leaseId}/heartbeat`,
        {
          progress: { stage: "filling", step: n, message: "working" },
          local_state: "running",
        },
        { idempotencyKey: `hb-${n}` }
      );
    const before = await beat(1);
    expect(before.status).toBe(200);
    expect(before.body.cancel_requested).toBe(false);
    const paused = await alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 1,
      automation_paused: true,
    });
    expect(paused.body.settings.automation_paused).toBe(true);
    const after = await beat(2);
    expect(after.status).toBe(200);
    expect(after.body.cancel_requested).toBe(true);
  });

  it("TP-SETTINGS default_mode auto needs JOBS_AUTO_MODE_ENABLED; read tokens cannot patch", async () => {
    const { client, alice } = await setup();
    const auto = await alice.patch(SETTINGS, {
      base_revision: 1,
      default_mode: "auto",
    });
    expect(auto.status).toBe(422);
    expect(auto.body).toMatchObject({ error: "mode_not_allowed" });
    const assisted = await alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 1,
      default_mode: "assisted",
    });
    expect(assisted.body.settings.default_mode).toBe("assisted");
    const reader = await client.personalToken("alice@example.com", "read");
    expect((await reader.get(SETTINGS)).status).toBe(200);
    const denied = await reader.patch(SETTINGS, {
      base_revision: 2,
      locale: "id",
    });
    expect(denied.status).toBe(403);
    const enabled = await setup({ JOBS_AUTO_MODE_ENABLED: true });
    const ok = await enabled.alice.patch<SettingsBody>(SETTINGS, {
      base_revision: 1,
      default_mode: "auto",
    });
    expect(ok.status).toBe(200);
  });
});
