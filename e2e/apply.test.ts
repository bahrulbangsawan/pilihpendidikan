// Browser applications through the claim / lease protocol (13 §5 S-13, S-14,
// S-17; 21 §16 item 13): real `pilih-jobs worker` processes on several
// devices of one user, the fixture ATS forms, approvals decided by the user.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Device } from "./harness/lab";
import { Lab } from "./harness/lab";
import { poll, sleep } from "./harness/procs";
import { route } from "./harness/proxy";
import { getApplication, getTask, waitForTask } from "./harness/scenario";
import { newKey } from "./harness/users";
import { finishFile } from "./harness/cleanup";

let lab: Lab;

beforeAll(async () => {
  lab = await Lab.start({ name: "api-apply" });
}, 300_000);

afterAll(async () => {
  await lab?.close();
  finishFile();
});

const TERMINAL = [
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
];
const CLAIM_PATH = /\/tasks:claim$/;
const HEARTBEAT_PATH = /\/lease\/[^/]+\/heartbeat$/;
const claims = (d: Device) => d.proxy.find("POST", CLAIM_PATH);

describe("apply through the lease protocol (21)", () => {
  test("S-14 two devices poll one apply task: exactly one claims, the other gets 204; a second live task for the application is refused", async () => {
    const a = await lab.device("s14-a");
    const b = await lab.device("s14-b");
    const app = await lab.application("e2e/14");
    const taskId = await lab.apply(app);
    // ux_tasks_live_apply: one live apply task per application.
    const key = newKey("dup");
    const second = await lab.user.api.post(
      "/api/v1/tasks",
      {
        kind: "apply",
        application_id: app.id,
        payload: { mode: "approval" },
        idempotency_key: key,
        queue_without_device: true,
      },
      { idempotencyKey: key }
    );
    expect(second.status).toBe(409);
    const stop = lab.autoApprove(
      (x) => x.kind === "submit" && x.task_id === taskId
    );
    const wa = a.startWorker();
    const wb = b.startWorker();
    const winner = await poll(
      "a claim of the task",
      () => {
        for (const d of [a, b]) {
          if (claims(d).some((e) => e.status === 200)) {
            return Promise.resolve(d);
          }
        }
        return Promise.resolve(null);
      },
      { timeoutMs: 60_000, intervalMs: 200 }
    );
    const loser = winner === a ? b : a;
    const winnerWorker = winner === a ? wa : wb;
    const result = await winnerWorker.taskResult(taskId);
    expect(result.outcome).toBe("submitted");
    stop();
    // The other device polled while the task was held and got nothing.
    await poll(
      "a 204 for the other device",
      async () => claims(loser).some((e) => e.status === 204),
      {
        timeoutMs: 40_000,
      }
    );
    expect(claims(loser).filter((e) => e.status === 200)).toHaveLength(0);
    expect(claims(winner).filter((e) => e.status === 200)).toHaveLength(1);
    // The result reaches the api through the outbox.
    const task = await waitForTask(lab.user.api, taskId);
    expect(task.task.state).toBe("submitted");
    expect(task.task.attempt_count).toBe(1);
    expect(await lab.fixture.submissions("e2e/14")).toHaveLength(1);
    await wa.stop();
    await wb.stop();
  }, 300_000);

  test("S-17 a device revoked from the web mid-run: the next heartbeat gets 401 revoked_token, the CLI stops before any browser action, the task goes back to the queue", async () => {
    const d = await lab.device("s17");
    const app = await lab.application("e2e/17");
    const taskId = await lab.apply(app, { device: d });
    // Hold the application page: the run is live (lease, heartbeats) while
    // the browser waits.
    await lab.fixture.setFlags({ "hold:/e2e/17/apply": true });
    const worker = d.startWorker();
    await poll(
      "the page request",
      async () =>
        (await lab.fixture.hits()).some((h) => h.path === "/e2e/17/apply"),
      { timeoutMs: 60_000, intervalMs: 250 }
    );
    const revoked = await lab.user.api.ok<{
      device: { revoked_at: number | null };
    }>(
      "POST",
      `/api/v1/devices/${d.id}/revoke`,
      {},
      { idempotencyKey: newKey("revoke") }
    );
    expect(revoked.device.revoked_at).not.toBeNull();
    const revokedAt = Date.now();
    const heartbeat = route("POST", HEARTBEAT_PATH);
    const first = await poll(
      "the next lease heartbeat",
      async () =>
        d.proxy.log.find(
          (e) =>
            e.at >= revokedAt &&
            heartbeat(e.method, e.path) &&
            e.status !== null
        ) ?? null,
      { timeoutMs: 45_000, intervalMs: 250 }
    );
    expect(first.status).toBe(401);
    expect(JSON.stringify(first.responseJson)).toContain("revoked_token");
    // Nothing the device sends after the revocation is accepted.
    await lab.fixture.setFlags({ "hold:/e2e/17/apply": null });
    const result = await worker.taskResult(taskId, 90_000);
    expect(["lost", "interrupted", "cancelled", "failed"]).toContain(
      String(result.outcome)
    );
    await sleep(3000);
    const accepted = d.proxy.log.filter(
      (e) =>
        e.at >= revokedAt &&
        e.path.startsWith("/api/v1/") &&
        e.path !== "/api/v1/meta" &&
        (e.status ?? 0) < 300
    );
    expect(accepted).toHaveLength(0);
    // The browser never acted on the form.
    const posts = (await lab.fixture.hits()).filter(
      (h) => h.method === "POST" && h.path.startsWith("/e2e/17/")
    );
    expect(posts).toHaveLength(0);
    // Before submit_intent → back to the queue, unpinned from the revoked device.
    const task = await getTask(lab.user.api, taskId);
    expect(task.task.state).toBe("queued");
    expect(task.task.target_device_id ?? null).toBeNull();
    expect(task.task.submit_intent_at ?? null).toBeNull();
    await worker.stop();
    // Leave nothing queued for the next scenario's devices.
    const cancelled = await lab.user.api.call(
      "POST",
      `/api/v1/tasks/${taskId}/cancel`,
      undefined,
      { idempotencyKey: newKey("cancel") }
    );
    expect(cancelled.status).toBeLessThan(300);
  }, 300_000);

  test("S-13 assisted mode: the agent fills, the user clicks Submit in the headed browser, evidence is captured after the click", async () => {
    const d = await lab.device("s13", {
      headlessFor: ["discover", "render_cv"],
    });
    const app = await createAssisted();
    const taskId = await lab.apply(app, { mode: "assisted", device: d });
    const worker = d.startWorker();
    // The agent fills the form and hands it to the user; it never clicks Submit.
    await worker.waitForEvent(
      "the hand-off to the user",
      (e) => e.type === "awaiting_user_submit" || e.stage === "reviewing",
      120_000
    );
    await sleep(1500);
    const filled = (await lab.fixture.hits()).filter((h) =>
      h.path.startsWith("/human/")
    );
    expect(filled.every((h) => h.method === "GET")).toBe(true);
    expect(await lab.fixture.submissions("human")).toHaveLength(0);
    // The human presses Submit in the visible browser window.
    const clickedAt = Date.now();
    await lab.fixture.setFlags({ human_click: true });
    const result = await worker.taskResult(taskId, 120_000);
    expect(result.outcome).toBe("submitted");
    expect((await waitForTask(lab.user.api, taskId)).task.state).toBe(
      "submitted"
    );
    const posts = await lab.fixture.submissions("human");
    expect(posts).toHaveLength(1);
    const detail = await getApplication(lab.user.api, app.id);
    expect(["submitted_verified", "submitted_unverified"]).toContain(
      detail.application.submission_status
    );
    const evidence = detail.evidence.find((e) => e.task_id === taskId);
    expect(evidence).toBeDefined();
    expect(Number(evidence?.captured_at)).toBeGreaterThanOrEqual(clickedAt);
    expect(detail.application.submission_status).toBe(
      evidence?.verdict === "verified"
        ? "submitted_verified"
        : "submitted_unverified"
    );
    await worker.stop();

    async function createAssisted() {
      const { createApplication } = await import("./harness/scenario");
      return await createApplication(lab.user.api, {
        title: "Assisted Engineer",
        company: "Acme",
        applyUrl: lab.fixture.applyUrl("human"),
        stage: "ready",
        mode: "assisted",
      });
    }
  }, 300_000);

  test("T21-13 three workers polling, 20 apply tasks: each task executes exactly once", async () => {
    const devices = [
      await lab.device("t2113-a"),
      await lab.device("t2113-b"),
      await lab.device("t2113-c"),
    ];
    const flows = Array.from({ length: 20 }, (_, i) => `e2e/${30 + i}`);
    const tasks: string[] = [];
    for (const flow of flows) {
      const app = await lab.application(flow);
      tasks.push(await lab.apply(app));
    }
    const ours = new Set(tasks);
    const stop = lab.autoApprove(
      (x) => x.kind === "submit" && ours.has(String(x.task_id))
    );
    const workers = devices.map((d) => d.startWorker());
    await poll(
      "every task to finish",
      async () => {
        for (const w of workers) {
          w.assertHealthy();
        }
        const states = await Promise.all(
          tasks.map((t) => getTask(lab.user.api, t))
        );
        return states.every((s) => TERMINAL.includes(s.task.state));
      },
      { timeoutMs: 600_000, intervalMs: 2000 }
    );
    stop();
    for (const w of workers) {
      await w.stop();
    }
    const hits = await lab.fixture.hits();
    for (const flow of flows) {
      const submits = hits.filter(
        (h) => h.method === "POST" && h.path === `/${flow}/submit`
      );
      expect({ flow, submits: submits.length }).toEqual({ flow, submits: 1 });
    }
    const states = await Promise.all(
      tasks.map((t) => getTask(lab.user.api, t))
    );
    expect(states.map((s) => s.task.state)).toEqual(
      tasks.map(() => "submitted")
    );
    // Every claim that returned a task went to a distinct task (no double claims).
    const claimed = devices.flatMap((d) =>
      claims(d)
        .filter((e) => e.status === 200)
        .map((e) => (e.responseJson as { task: { id: string } }).task.id)
    );
    expect(new Set(claimed).size).toBe(claimed.length);
    for (const task of ours) {
      expect(claimed).toContain(task);
    }
    // The work was shared.
    const perDevice = devices.map(
      (d) => claims(d).filter((e) => e.status === 200).length
    );
    expect(perDevice.filter((n) => n > 0).length).toBeGreaterThanOrEqual(2);
  }, 900_000);
});
