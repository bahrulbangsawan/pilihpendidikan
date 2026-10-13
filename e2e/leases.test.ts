// Lease loss and crash safety (13 §5 S-15, S-16, S-24; 21 §16 item 14):
// `kill -9` of the CLI at every protocol step, an offline submission that
// meets a user decision, and the dashboard prompts that follow. One 120 s
// lease expiry (plus the 2 min retry backoff) is shared by all cases.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hook } from "./harness/proxy";
import { route } from "./harness/proxy";
import { WEB_ORIGIN } from "./harness/env";
import type { Device, Worker } from "./harness/lab";
import { Lab } from "./harness/lab";
import { poll, sleep } from "./harness/procs";
import type { SeededApplication } from "./harness/scenario";
import {
  getApplication,
  getTask,
  listEvents,
  waitForTask,
  webSignIn,
} from "./harness/scenario";
import { newKey } from "./harness/users";
import { WebServer } from "./harness/web";
import { finishFile } from "./harness/cleanup";

const CLAIM_PATH = /\/tasks:claim$/;
const FIELD_PLAN_PATH = /^\/api\/v1\/ai\/field-plan$/;
const LEASE_APPROVALS_PATH = /\/lease\/[^/]+\/approvals$/;
const SUBMIT_INTENT_PATH = /\/submit-intent$/;
const RESULT_PATH = /\/lease\/[^/]+\/result$/;
const LATE_EVIDENCE_PATH = /\/attempts\/[^/]+\/late-evidence$/;

interface KillCase {
  step: string;
  flow: string;
  /** Killed before `submit_intent` was acknowledged. */
  preIntent: boolean;
  /** The user approves the submit approval before the kill (the run gets that far). */
  approveFirst: boolean;
  /** Form submissions the employer may have received by the kill. */
  submitsAtKill: number[];
  /** Task states allowed once the lease expired and the reaper ran (21 §7.1). */
  afterExpiry: string[];
  device?: Device;
  worker?: Worker;
  app?: SeededApplication;
  task?: string;
  killedAt?: number;
}

const PRE_INTENT = {
  preIntent: true,
  submitsAtKill: [0],
  afterExpiry: ["queued"],
};
const CASES: KillCase[] = [
  {
    step: "before the claim ack",
    flow: "e2e/61",
    approveFirst: false,
    ...PRE_INTENT,
  },
  {
    step: "after the claim",
    flow: "e2e/62",
    approveFirst: false,
    ...PRE_INTENT,
  },
  { step: "mid-fill", flow: "e2e/63", approveFirst: false, ...PRE_INTENT },
  {
    step: "awaiting approval",
    flow: "e2e/64",
    approveFirst: false,
    ...PRE_INTENT,
    // An expired lease while awaiting approval leaves the task waiting, unleased.
    afterExpiry: ["awaiting_approval", "queued"],
  },
  {
    step: "just before submit-intent",
    flow: "e2e/65",
    approveFirst: true,
    ...PRE_INTENT,
  },
  {
    step: "just after the submit-intent ack",
    flow: "e2e/66",
    preIntent: false,
    approveFirst: true,
    submitsAtKill: [0, 1],
    afterExpiry: ["outcome_unknown"],
  },
  {
    step: "after the click, before the result",
    flow: "e2e/67",
    preIntent: false,
    approveFirst: true,
    submitsAtKill: [1],
    afterExpiry: ["outcome_unknown"],
  },
];
const MID_FILL = CASES[2]; // S-15
const AFTER_CLICK = CASES[6]; // S-16

let lab: Lab;
let web: WebServer;
const approveNow = new Set<string>();
let stopApprover: () => void = () => undefined;

// S-24
let offline: {
  device: Device;
  worker: Worker;
  app: SeededApplication;
  task: string;
} | null = null;

function hookFor(c: KillCase, kill: () => void): Hook {
  const claim = route("POST", CLAIM_PATH);
  const claimed = (ex: { status: number | null; responseJson: unknown }) =>
    ex.status === 200 &&
    Boolean((ex.responseJson as { task?: unknown } | null)?.task);
  switch (c.step) {
    case "before the claim ack":
      return {
        match: claim,
        after: (ex) => {
          if (!claimed(ex)) {
            return;
          }
          kill();
          return "drop";
        },
      };
    case "after the claim":
      return { match: claim, afterDelivered: (ex) => claimed(ex) && kill() };
    case "mid-fill":
      return {
        match: route("POST", FIELD_PLAN_PATH),
        // The agent has its field plan and starts typing: kill it right there.
        afterDelivered: () => kill(),
      };
    case "awaiting approval":
      return {
        match: route("POST", LEASE_APPROVALS_PATH),
        afterDelivered: () => setTimeout(kill, 1500),
      };
    case "just before submit-intent":
      return {
        match: route("POST", SUBMIT_INTENT_PATH),
        before: () => {
          kill();
          return "drop";
        },
      };
    case "just after the submit-intent ack":
      return {
        match: route("POST", SUBMIT_INTENT_PATH),
        afterDelivered: () => kill(),
      };
    default:
      return { match: () => false };
  }
}

/** Runs one case until its worker was killed at the chosen step. */
async function runCase(c: KillCase, index: number): Promise<void> {
  c.device = await lab.device(`kill-${index + 1}`);
  c.app = await lab.application(c.flow);
  const kill = () => {
    if (!c.killedAt) {
      c.killedAt = Date.now();
      c.worker?.kill9();
    }
  };
  if (c.step === "after the click, before the result") {
    await lab.fixture.setFlags({ [`hold:/${c.flow}/submit`]: true });
  } else {
    c.device.proxy.addHook(hookFor(c, kill));
  }
  c.task = await lab.apply(c.app);
  if (c.approveFirst) {
    approveNow.add(c.task);
  }
  c.worker = c.device.startWorker();
  if (c.step === "after the click, before the result") {
    await poll(
      "the click on Submit",
      async () => {
        c.worker?.assertHealthy();
        return (await lab.fixture.submissions(c.flow)).length > 0;
      },
      { timeoutMs: 120_000, intervalMs: 100 }
    );
    kill();
    await lab.fixture.setFlags({ [`hold:/${c.flow}/submit`]: null });
  }
  await poll(
    `the kill "${c.step}"`,
    () => {
      if (c.killedAt) {
        return Promise.resolve(true);
      }
      c.worker?.assertHealthy();
      return Promise.resolve(false);
    },
    { timeoutMs: 120_000, intervalMs: 250 }
  );
  await c.worker?.proc.exited;
}

beforeAll(async () => {
  lab = await Lab.start({ name: "api-leases" });
  web = await WebServer.start(lab.api.origin);
  await webSignIn(lab.browser, lab.api, lab.user.email, { confirm: "fetch" });
  stopApprover = lab.autoApprove(
    (a) => a.kind === "submit" && approveNow.has(String(a.task_id))
  );
}, 300_000);

afterAll(async () => {
  stopApprover();
  await web?.stop();
  await lab?.close();
  finishFile();
});

describe("lease loss and crashes (21 §7, §16)", () => {
  test("T21-14 kill -9 of the CLI at each protocol step never submits twice", async () => {
    for (const [index, c] of CASES.entries()) {
      await runCase(c, index);
    }
    // S-24's run: the network drops right after the server acknowledged
    // submit_intent; the CLI submits, verifies and queues its result offline.
    const device = await lab.device("s24");
    const app = await lab.application("e2e/24");
    const task = await lab.apply(app);
    approveNow.add(task);
    device.proxy.addHook({
      match: route("POST", SUBMIT_INTENT_PATH),
      afterDelivered: (ex) => {
        if (ex.status === 200) {
          device.proxy.goOffline();
        }
      },
    });
    const worker = device.startWorker();
    offline = { device, worker, app, task };
    const result = await worker.taskResult(task, 180_000);
    expect(result.outcome).toBe("submitted");
    await worker.stop();
    expect(await lab.fixture.submissions("e2e/24")).toHaveLength(1);
    const pending = await device.cli.run(["sync", "--status"]);
    expect(Number(pending.data.outbox_depth)).toBeGreaterThan(0);

    // So far: nothing was submitted before an acknowledged intent, and at
    // most once after it.
    for (const c of CASES) {
      const submits = (await lab.fixture.submissions(c.flow)).length;
      expect({
        step: c.step,
        submits: c.submitsAtKill.includes(submits) ? "ok" : submits,
      }).toEqual({
        step: c.step,
        submits: "ok",
      });
    }
  }, 900_000);

  test("T21-14 after the leases expire: pre-intent kills are back in the queue (or still awaiting approval), post-intent kills are outcome_unknown", async () => {
    const tasks = [...CASES.map((c) => String(c.task)), String(offline?.task)];
    const leases = await Promise.all(
      tasks.map((t) => getTask(lab.user.api, t))
    );
    const latest = Math.max(
      ...leases.map((t) => Number(t.task.lease_expires_at ?? 0))
    );
    await sleep(Math.max(0, latest - Date.now()) + 3000);
    // The 5-minute cron reaper (21 §7.1), run now instead of waiting for it.
    await lab.api.runCron("*/5 * * * *");
    const observed: Record<string, unknown>[] = [];
    const wanted: Record<string, unknown>[] = [];
    for (const c of CASES) {
      const detail = await getTask(lab.user.api, String(c.task));
      const state = detail.task.state;
      observed.push({
        step: c.step,
        state: c.afterExpiry.includes(state) ? "as expected" : state,
        lease: detail.task.lease_id,
        intent: detail.task.submit_intent_at !== null,
      });
      wanted.push({
        step: c.step,
        state: "as expected",
        lease: null,
        intent: !c.preIntent,
      });
    }
    expect(observed).toEqual(wanted);
    expect(
      (await getTask(lab.user.api, String(offline?.task))).task.state
    ).toBe("outcome_unknown");
  }, 600_000);

  test("S-16 lease lost right after the Submit click: outcome_unknown, never retried automatically; the dashboard asks “Did this go through?”", async () => {
    const c = AFTER_CLICK;
    const detail = await getApplication(lab.user.api, String(c.app?.id));
    expect(detail.application.submission_status).toBe("outcome_unknown");
    await lab.browser.goto(`${WEB_ORIGIN}/applications/${c.app?.id}`);
    await lab.browser.waitForText("Review outcome", 60_000);
    await lab.browser.click('button:has-text("Review outcome")');
    await lab.browser.waitForText("Did this application go through?");
    await lab.browser.press("Escape");
  }, 300_000);

  test("S-24 offline submission meets a user decision: the result lands as events, the stage stays Withdrawn, a conflict is recorded and shown", async () => {
    if (!offline) {
      throw new Error("the offline run did not happen");
    }
    const { device, app, task } = offline;
    // The task is no longer live (outcome_unknown), so the user may move the card.
    const before = await getApplication(lab.user.api, app.id);
    const moved = await lab.user.api.ok<{ application: { stage: string } }>(
      "POST",
      `/api/v1/applications/${app.id}/move`,
      { stage: "withdrawn", base_revision: before.application.revision },
      { idempotencyKey: newKey("withdraw") }
    );
    expect(moved.application.stage).toBe("withdrawn");
    // The CLI reconnects and flushes its outbox.
    device.proxy.goOnline();
    let depth = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 20 && depth > 0; i++) {
      await device.cli.run(["sync"]);
      depth = Number(
        (await device.cli.ok(["sync", "--status"])).data.outbox_depth
      );
      if (depth > 0) {
        await sleep(2000);
      }
    }
    expect(depth).toBe(0);
    const result = device.proxy
      .find("POST", RESULT_PATH)
      .filter((e) => e.outcome === "ok");
    expect(result.at(-1)?.status).toBe(409);
    const late = device.proxy
      .find("POST", LATE_EVIDENCE_PATH)
      .filter((e) => e.outcome === "ok");
    expect(late.length).toBeGreaterThanOrEqual(1);
    expect(late.at(-1)?.status).toBeLessThan(300);

    const after = await getApplication(lab.user.api, app.id);
    expect(after.application.stage).toBe("withdrawn");
    expect(after.evidence.some((e) => e.task_id === task)).toBe(true);
    expect(
      (await waitForTask(lab.user.api, task, ["submitted"])).task.state
    ).toBe("submitted");
    const events = await listEvents(lab.user.api, app.id);
    const conflict = events.filter((e) => e.type === "conflict_recorded");
    expect(conflict.length).toBeGreaterThanOrEqual(1);
    // No automation stage change was applied after the user's withdrawal.
    const withdrawnAt = Number(
      events.find(
        (e) => e.type === "stage_changed" && e.to_value === "withdrawn"
      )?.recorded_at
    );
    for (const e of events.filter(
      (x) => x.type === "stage_changed" && Number(x.recorded_at) > withdrawnAt
    )) {
      expect(e.applied_to_state).toBe(false);
    }
    // The dashboard shows the conflict on the timeline.
    await lab.browser.goto(`${WEB_ORIGIN}/applications/${app.id}`);
    await lab.browser.waitForHydration('[role="tab"]');
    await lab.browser.click('[role="tab"]:has-text("Timeline")');
    await lab.browser.waitForText("Conflict:", 60_000);
    // The submission status follows the evidence (19 §9.2, 20 §6.3 A).
    const viaLate = events.filter(
      (e) =>
        e.type === "submission_status_changed" &&
        (e.payload as { via?: string }).via === "late_evidence"
    );
    expect(viaLate).toHaveLength(1);
    const settled = await getApplication(lab.user.api, app.id);
    expect(["submitted_verified", "submitted_unverified"]).toContain(
      settled.application.submission_status
    );
  }, 600_000);

  test("S-15 lease lost before submit_intent: the attempt ends lease_expired, the task is queued and another device completes it", async () => {
    // Every pre-intent case goes back to work: approve what is waiting, wait
    // out the retry backoff (2 min after the first loss), start a fresh device.
    for (const c of CASES) {
      approveNow.add(String(c.task));
    }
    const rescue = await lab.device("rescue");
    const waiting = await Promise.all(
      CASES.map((c) => getTask(lab.user.api, String(c.task)))
    );
    const notBefore = Math.max(
      ...waiting
        .filter((t) => t.task.state === "queued")
        .map((t) => Number(t.task.not_before))
    );
    await sleep(Math.max(0, notBefore - Date.now()) + 1000);
    const worker = rescue.startWorker();
    const pre = CASES.filter((c) => c.preIntent);
    for (const c of pre) {
      const final = await waitForTask(
        lab.user.api,
        String(c.task),
        ["submitted", "failed", "cancelled", "outcome_unknown", "expired"],
        300_000,
        () => worker.assertHealthy()
      );
      expect({ step: c.step, state: final.task.state }).toEqual({
        step: c.step,
        state: "submitted",
      });
    }
    await worker.stop();
    const s15 = await getTask(lab.user.api, String(MID_FILL.task));
    const attempts = [...(s15.attempts ?? [])].sort(
      (a, b) => Number(a.attempt_no) - Number(b.attempt_no)
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0].outcome).toBe("lease_expired");
    expect(attempts[0].device_id).toBe(MID_FILL.device?.id);
    expect(attempts[1].device_id).toBe(rescue.id);
    expect(attempts[1].outcome).toBe("submitted");
    expect(await lab.fixture.submissions(MID_FILL.flow)).toHaveLength(1);
  }, 900_000);

  test("T21-14 the final ledger: one submission at most per run, pre-intent runs completed by another device, post-intent runs left outcome_unknown and never claimed again", async () => {
    const rescue = lab.devices.find((d) => d.name === "rescue");
    const reclaimed = (rescue?.proxy.find("POST", CLAIM_PATH) ?? [])
      .filter((e) => e.status === 200)
      .map((e) => (e.responseJson as { task: { id: string } }).task.id);
    for (const c of CASES) {
      const detail = await getTask(lab.user.api, String(c.task));
      const submits = (await lab.fixture.submissions(c.flow)).length;
      expect(submits).toBeLessThanOrEqual(1);
      if (c.preIntent) {
        expect({ step: c.step, state: detail.task.state, submits }).toEqual({
          step: c.step,
          state: "submitted",
          submits: 1,
        });
        expect(reclaimed).toContain(String(c.task));
      } else {
        expect({ step: c.step, state: detail.task.state }).toEqual({
          step: c.step,
          state: "outcome_unknown",
        });
        expect(reclaimed).not.toContain(String(c.task));
      }
    }
    expect(await lab.fixture.submissions(AFTER_CLICK.flow)).toHaveLength(1);
  }, 300_000);
});
