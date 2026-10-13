// S-12 (13 §5), the golden path in approval mode, end to end across the
// three components: CLI login and device → discovery → scoring → tracking →
// AI tailoring (fake provider) → the CV rendered and approved on the
// dashboard → "Start apply" on the dashboard targeting the device → the
// worker claims and fills the fixture Greenhouse-like form (with the CV) →
// the approval appears on the dashboard → approved → submit_intent → submit
// → verification → the board shows Applied ✓.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createBaseCv } from "./harness/applicant";
import { WEB_ORIGIN } from "./harness/env";
import type { Device } from "./harness/lab";
import { Lab } from "./harness/lab";
import { poll } from "./harness/procs";
import {
  getApplication,
  listEvents,
  waitForTask,
  webSignIn,
} from "./harness/scenario";
import { newKey } from "./harness/users";
import { WebServer } from "./harness/web";
import { finishFile } from "./harness/cleanup";

const PDF_NAME = /\.pdf$/;

let lab: Lab;
let web: WebServer;
let device: Device;

beforeAll(async () => {
  lab = await Lab.start({ name: "api-golden" });
  web = await WebServer.start(lab.api.origin);
}, 300_000);

afterAll(async () => {
  await web?.stop();
  await lab?.close();
  finishFile();
});

/**
 * Checks that the timeline has every phase, each one recorded no earlier than
 * the previous phase. Events of one write batch share `recorded_at`, so the
 * members of a phase may come in any order. Keys: `type[:to_value]@actor`.
 */
function phases(
  events: Record<string, unknown>[],
  groups: string[][]
): string[] {
  const key = (e: Record<string, unknown>) =>
    `${e.type}${e.to_value ? `:${e.to_value}` : ""}@${e.actor_kind}`;
  const problems: string[] = [];
  let floor = 0;
  for (const group of groups) {
    let top = floor;
    for (const want of group) {
      const hit = events.find(
        (e) => key(e) === want && Number(e.recorded_at) >= floor
      );
      if (!hit) {
        problems.push(`missing ${want} at or after ${floor}`);
        continue;
      }
      top = Math.max(top, Number(hit.recorded_at));
    }
    floor = top;
  }
  return problems;
}

describe("the golden path (13 §5 S-12)", () => {
  test("S-12 login → device → discover → score → track → tailor → approve CV → start apply on the web → claim → fill → approval on the web → submit → verify → Applied ✓", async () => {
    const browser = lab.browser;
    // Login and device (17 §10.1).
    device = await lab.device("golden-laptop");
    await webSignIn(browser, lab.api, lab.user.email, { confirm: "fetch" });
    const baseCvId = await createBaseCv(
      lab.user,
      `golden-${Date.now().toString(36)}`
    );

    // Discover the posting from the employer's careers page (custom_url, JSON-LD).
    const jobUrl = `${lab.fixture.origin}/jobs/golden`;
    const discovered = await device.cli.ok(["discover", "--url", jobUrl], {
      timeoutMs: 240_000,
    });
    expect(discovered.data.status).toBe("completed");
    const inbox = await lab.user.api.ok<{
      items: Array<{
        user_job: { id: string };
        posting: { id: string; apply_url: string | null; title: string };
      }>;
    }>("GET", "/api/v1/inbox", undefined, { query: { limit: 50 } });
    const item = inbox.items.find(
      (i) => i.posting.title === "Senior Backend Engineer (Payments)"
    );
    expect(item?.posting.apply_url).toBe(lab.fixture.applyUrl("cv/1"));
    const postingId = String(item?.posting.id);
    const userJobId = String(item?.user_job.id);

    // Score it (07): queued, computed by the jobs-ai consumer.
    const scored = await lab.user.api.ok<{
      queued: string[];
      cached: string[];
    }>(
      "POST",
      "/api/v1/scores:request",
      { posting_ids: [postingId] },
      { idempotencyKey: newKey("score") }
    );
    expect([...scored.queued, ...scored.cached]).toContain(postingId);
    const score = await poll(
      "the match score",
      async () => {
        const s = await lab.user.api.ok<{
          score: { status: string; score: number } | null;
        }>("GET", `/api/v1/scores/${postingId}`);
        return s.score && s.score.status === "ready" ? s.score : null;
      },
      { timeoutMs: 90_000 }
    );
    expect(score.score).toBeGreaterThanOrEqual(0);

    // Track it from the inbox.
    const tracked = await lab.user.api.ok<{
      results: Array<{ status: string; application_id?: string }>;
    }>(
      "POST",
      "/api/v1/inbox:bulk",
      { user_job_ids: [userJobId], action: "track" },
      { idempotencyKey: newKey("track") }
    );
    expect(tracked.results[0].status).toBe("ok");
    const appId = String(tracked.results[0].application_id);

    // Tailor a CV (fake AI provider), rendered in this browser tab on the
    // dashboard (08 §6.2) and approved there.
    const variant = await lab.user.api.ok<{ cv_variant: { id: string } }>(
      "POST",
      `/api/v1/applications/${appId}/cv-variants`,
      { base_cv_id: baseCvId, template: "harvard", tailor: true },
      { idempotencyKey: newKey("tailor") }
    );
    await browser.goto(`${WEB_ORIGIN}/applications/${appId}`);
    await browser.waitForHydration('[role="tab"]');
    await browser.click('[role="tab"]:has-text("CV")');
    await browser.waitFor('button:has-text("Approve")', { timeout: 180_000 });
    await browser.click('button:has-text("Approve")');
    await browser.waitForText("Approve this CV?");
    await browser.click('[role="alertdialog"] button:has-text("Approve")');
    await browser.waitForText("CV approved.");
    const cv = await lab.user.api.ok<{
      cv_variant: { status: string; file_id: string; model: string | null };
      file: { sha256: string } | null;
    }>("GET", `/api/v1/cv-variants/${variant.cv_variant.id}`);
    expect(cv.cv_variant.status).toBe("approved");
    expect(cv.cv_variant.model).not.toBe("copy");

    // The approved CV made the application ready (06 §3); Start apply on the
    // Apply tab, targeting this device.
    expect((await getApplication(lab.user.api, appId)).application.stage).toBe(
      "ready"
    );
    const worker = device.startWorker();
    await browser.goto(`${WEB_ORIGIN}/applications/${appId}`);
    await browser.waitForHydration('[role="tab"]');
    await browser.click('[role="tab"]:has-text("Apply")');
    await browser.waitForText("Start apply");
    await browser.click('[role="combobox"][id$="-device"]');
    await browser.click(`[role="option"]:has-text("golden-laptop")`);
    await browser.click('button:has-text("Start apply")');
    await browser.waitForText("Queued. A device picks it up shortly.");
    const detail = await poll(
      "the apply task",
      async () => {
        const d = await getApplication(lab.user.api, appId);
        return d.tasks.find((t) => t.kind === "apply") ? d : null;
      },
      { timeoutMs: 30_000 }
    );
    const task = detail.tasks.find((t) => t.kind === "apply") as Record<
      string,
      unknown
    >;
    const taskId = String(task.id);
    expect(task.target_device_id).toBe(device.id);

    // The submit approval appears on the dashboard; the user approves it there.
    const approval = await lab.approvalFor(taskId, "submit", 180_000, worker);
    await browser.goto(`${WEB_ORIGIN}/automation?approval=${approval.id}`);
    await browser.waitFor('button:has-text("Approve and submit")', {
      timeout: 60_000,
    });
    await browser.click('button:has-text("Approve and submit")');
    await browser.waitForText("Submit this application to");
    await browser.click(
      '[role="alertdialog"] button:has-text("Approve and submit")'
    );

    const result = await worker.taskResult(taskId, 240_000);
    expect(result.outcome).toBe("submitted");
    const final = await waitForTask(lab.user.api, taskId);
    expect(final.task.state).toBe("submitted");
    await worker.stop();

    // The employer received exactly one submission, with the approved CV.
    const posts = await lab.fixture.submissions("cv/1");
    expect(posts).toHaveLength(1);
    expect(posts[0].files.resume).toMatch(PDF_NAME);
    expect(posts[0].form.first_name).toEqual(["Ayu"]);
    // submit_intent was acknowledged before the click on Submit (D-19).
    expect(Number(final.task.submit_intent_at)).toBeLessThan(posts[0].wallAt);

    // Evidence: verified, with two independent positive signals (19 §9).
    const after = await getApplication(lab.user.api, appId);
    expect(after.application.stage).toBe("applied");
    expect(after.application.submission_status).toBe("submitted_verified");
    const evidence = after.evidence.find((e) => e.task_id === taskId) as {
      verdict: string;
      signals: Record<string, unknown>;
    };
    expect(evidence.verdict).toBe("verified");
    const positive = ["url_match", "dom_marker", "form_gone", "xhr_2xx"].filter(
      (k) => evidence.signals[k] === true
    );
    const ai = Number(evidence.signals.application_received ?? 0) >= 0.85;
    expect(positive.length + (ai ? 1 : 0)).toBeGreaterThanOrEqual(2);

    // Every event of the timeline, in order.
    const events = await listEvents(lab.user.api, appId);
    expect(
      phases(events, [
        ["created:saved@user"],
        ["stage_changed:preparing@system"],
        ["approval_requested@system"],
        ["cv_variant_attached@user", "stage_changed:ready@system"],
        ["automation_task_created@user"],
        ["automation_task_claimed@automation"],
        ["approval_requested@automation"],
        ["approval_decided@user"],
        [
          "submit_intent@automation",
          "submission_status_changed:in_progress@automation",
        ],
        [
          "stage_changed:applied@automation",
          "submission_status_changed:submitted_verified@automation",
          "automation_task_finished@automation",
        ],
      ])
    ).toEqual([]);
    for (const e of events) {
      expect(e.applied_to_state).toBe(true);
    }

    // The board shows the card in Applied with the Verified badge ("Applied ✓ Verified").
    await browser.goto(`${WEB_ORIGIN}/board`);
    const card = `section[aria-labelledby="column-applied"] [data-card-id="${appId}"]`;
    await browser.waitFor(card, { timeout: 60_000 });
    expect(await browser.text(card)).toContain("Verified");
    // The CLI and the api agreed on every request of the run (no 4xx / 5xx).
    const failures = device.proxy.log
      .filter((e) => (e.status ?? 0) >= 400)
      .map(
        (e) =>
          `${e.method} ${e.path} → ${e.status} ${JSON.stringify(e.responseJson).slice(0, 200)}`
      );
    expect(failures).toEqual([]);
  }, 900_000);
});
