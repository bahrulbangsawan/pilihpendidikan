// Building blocks the scenarios share: the dashboard sign-in, seeding
// applications the way a user would (manual job → application), approvals.
import type { ApiServer } from "./api";
import type { Browser, Cookie } from "./browser";
import { WEB_ORIGIN } from "./env";
import { poll } from "./procs";
import type { Client } from "./users";
import { newKey } from "./users";

const SESSION_COOKIE = /(?:^|\s)session=([^;]+)/;

/**
 * S-01's flow: the dashboard's sign-in band → the e-mailed link → the api's
 * confirm page → back on the dashboard with `?code=` → the BFF cookie.
 * Returns the api session bearer the BFF now holds (read from the browser's
 * cookie jar by the test, never by the page).
 *
 * `confirm: "fetch"` presses the confirm page's Continue outside the browser
 * and opens the resulting `?code=` URL in it (the same requests; used by the
 * scenarios that only need a signed-in dashboard, see requests/leaf-5.1.md #1).
 */
export async function webSignIn(
  browser: Browser,
  api: ApiServer,
  email: string,
  opts: { confirm?: "browser" | "fetch" } = {}
): Promise<{ bearer: string; cookies: Cookie[] }> {
  // Start signed out: a browser still holding another user's BFF cookie
  // would be sent straight to its board.
  await browser.clearCookies();
  await browser.goto(`${WEB_ORIGIN}/`);
  await browser.waitForHydration('input[type="email"]');
  await browser.fill('input[type="email"]', email);
  await browser.click('button[type="submit"]');
  await browser.waitForText("Check your inbox");
  const mail = await api.waitForMail(email);
  let bearer: string | undefined;
  if (opts.confirm === "fetch") {
    const token = new URL(mail.link).searchParams.get("t") ?? "";
    const verify = await fetch(`${api.origin}/auth/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: api.origin,
      },
      body: new URLSearchParams({ t: token }).toString(),
      redirect: "manual",
    });
    const location = verify.headers.get("location") ?? "";
    bearer = SESSION_COOKIE.exec(verify.headers.get("set-cookie") ?? "")?.[1];
    if (verify.status !== 303 || !location.startsWith(WEB_ORIGIN)) {
      throw new Error(`/auth/verify → ${verify.status} ${location}`);
    }
    await browser.goto(location);
  } else {
    await browser.goto(mail.link);
    await browser.waitForText("Confirm sign-in");
    await browser.click('form[action="/auth/verify"] button[type="submit"]');
  }
  await browser.waitForUrl(`^${WEB_ORIGIN.replace(/[.]/g, "\\.")}/`, 60_000);
  const cookies = await poll(
    "the BFF session cookie",
    async () => {
      const jar = await browser.cookies();
      return jar.some((c) => c.name === "jobs-session") ? jar : null;
    },
    { timeoutMs: 60_000 }
  );
  bearer ??= cookies.find((c) => c.name === "session")?.value;
  if (!bearer) {
    throw new Error("the api session cookie was not set");
  }
  return { bearer, cookies };
}

export interface SeededApplication {
  id: string;
  userJobId: string;
  postingId: string;
  revision: number;
}

/** A manually added job (05 §4 `POST /user-jobs`) tracked as an application. */
export async function createApplication(
  client: Client,
  opts: {
    title: string;
    company: string;
    applyUrl?: string;
    stage?: string;
    mode?: string;
    description?: string;
  }
): Promise<SeededApplication> {
  const job = await client.ok<{
    user_job: { id: string };
    posting: { id: string };
  }>(
    "POST",
    "/api/v1/user-jobs",
    {
      title: opts.title,
      company_name: opts.company,
      apply_url: opts.applyUrl ?? null,
      description_text:
        opts.description ??
        `${opts.title} at ${opts.company}. Build reliable services in TypeScript and Python.`,
      requirements: ["TypeScript", "Python"],
    },
    { idempotencyKey: newKey("ujb") }
  );
  const created = await client.ok<{
    application: { id: string; revision: number };
  }>(
    "POST",
    "/api/v1/applications",
    {
      user_job_id: job.user_job.id,
      stage: opts.stage ?? "saved",
      ...(opts.mode ? { mode: opts.mode } : {}),
    },
    { idempotencyKey: newKey("app") }
  );
  return {
    id: created.application.id,
    userJobId: job.user_job.id,
    postingId: job.posting.id,
    revision: created.application.revision,
  };
}

export async function getApplication(client: Client, appId: string) {
  return await client.ok<{
    application: Record<string, unknown> & {
      stage: string;
      submission_status: string;
      revision: number;
    };
    tasks: Record<string, unknown>[];
    approvals: Record<string, unknown>[];
    evidence: Record<string, unknown>[];
    cv_variants: Record<string, unknown>[];
    emails: Record<string, unknown>[];
  }>("GET", `/api/v1/applications/${appId}`);
}

export async function listEvents(
  client: Client,
  appId: string
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await client.ok<{
      items: Record<string, unknown>[];
      next_cursor: string | null;
    }>("GET", `/api/v1/applications/${appId}/events`, undefined, {
      query: { limit: 200, cursor },
    });
    out.push(...page.items);
    if (!page.next_cursor) {
      break;
    }
    cursor = page.next_cursor;
  }
  return out.sort(
    (a, b) =>
      Number(a.recorded_at) - Number(b.recorded_at) ||
      String(a.id).localeCompare(String(b.id))
  );
}

export async function getTask(client: Client, taskId: string) {
  return await client.ok<{
    task: Record<string, unknown> & {
      state: string;
      attempt_count: number;
      target_device_id: string | null;
      submit_intent_at: number | null;
      lease_id: string | null;
    };
    attempts?: Record<string, unknown>[];
  }>("GET", `/api/v1/tasks/${taskId}`);
}

export const TERMINAL_TASK_STATES = [
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
  "expired",
];

/** Waits until the api has the task in one of `states` (results travel through the outbox). */
export async function waitForTask(
  client: Client,
  taskId: string,
  states: string[] = TERMINAL_TASK_STATES,
  timeoutMs = 90_000,
  /** Called on every poll, e.g. `worker.assertHealthy()` to fail fast. */
  check: () => void = () => undefined
) {
  return await poll(
    `task ${taskId} in ${states.join("|")}`,
    async () => {
      check();
      const task = await getTask(client, taskId);
      return states.includes(task.task.state) ? task : null;
    },
    { timeoutMs, intervalMs: 500 }
  );
}

/** Creates an apply task targeting a device (the "Start" button of the Apply tab). */
export async function startApply(
  client: Client,
  appId: string,
  opts: { mode?: string; deviceId?: string | null } = {}
): Promise<string> {
  const key = newKey("apply");
  const created = await client.ok<{ task: { id: string } }>(
    "POST",
    "/api/v1/tasks",
    {
      kind: "apply",
      application_id: appId,
      payload: { mode: opts.mode ?? "approval" },
      target_device_id: opts.deviceId ?? null,
      idempotency_key: key,
      queue_without_device: true,
    },
    { idempotencyKey: key }
  );
  return created.task.id;
}

export interface ApprovalRecord {
  id: string;
  kind: string;
  state: string;
  payload_hash: string;
  application_id: string | null;
  task_id: string | null;
  payload: Record<string, unknown>;
  created_at: number;
}

export async function pendingApprovals(
  client: Client,
  filter: (a: ApprovalRecord) => boolean = () => true
): Promise<ApprovalRecord[]> {
  const page = await client.ok<{ items: ApprovalRecord[] }>(
    "GET",
    "/api/v1/approvals",
    undefined,
    { query: { state: "pending", limit: 100 } }
  );
  return page.items.filter(filter);
}

/** Approves (as the user, on the web) the approval with its `payload_hash`. */
export async function decide(
  client: Client,
  approval: ApprovalRecord,
  decision: "approve" | "reject" = "approve"
) {
  return await client.ok<{ approval: ApprovalRecord }>(
    "POST",
    `/api/v1/approvals/${approval.id}/decide`,
    { decision, payload_hash: approval.payload_hash },
    { idempotencyKey: newKey("decide") }
  );
}
