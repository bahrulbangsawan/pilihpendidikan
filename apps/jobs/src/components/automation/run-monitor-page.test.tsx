// @vitest-environment happy-dom
import type { TaskDetail } from "@pilihpendidikan/jobs-contracts/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getT } from "@/i18n";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest } from "@/lib/bff";
import { formatClock } from "@/lib/format";
import { fixtureId, makeDevice } from "@/test/fixtures";
import { makeAttempt, makeTask, makeTaskDetail } from "@/test/fixtures-rest";
import { click } from "@/test/render";
import { RunMonitorPage } from "./run-monitor-page";
import {
  buttonByText,
  fakeApi,
  flush,
  press,
  renderScreen,
} from "./screen-harness.test-utils";

// The not-found screen reads the session through a server function; the
// monitor only renders it for a 404, which these tests don't exercise.
vi.mock("@/components/not-found", () => ({ NotFoundPage: () => null }));

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  setBffTransport(null);
  document.body.replaceChildren();
});

const device = makeDevice({ name: "MacBook" });

function detailOf(overrides: Parameters<typeof makeTask>[0]): TaskDetail {
  const now = Date.now();
  const task = makeTask({
    lease_device_id: device.id,
    created_at: now - 600_000,
    updated_at: now - 1000,
    lease_expires_at: now + 90_000,
    ...overrides,
  });
  return makeTaskDetail({
    task,
    attempts: [
      makeAttempt(task, device.id, {
        started_at: now - 590_000,
        last_heartbeat_at: now - 4000,
      }),
    ],
    device_name: "MacBook",
  });
}

function serve(detail: TaskDetail) {
  return fakeApi((request) => {
    if (request.route === "GET /api/v1/tasks/{tsk_id}") {
      return { ok: true, data: detail };
    }
    if (request.route === "GET /api/v1/devices") {
      return { ok: true, data: { items: [device], next_cursor: null } };
    }
    if (
      request.route === "POST /api/v1/tasks/{tsk_id}/resume" ||
      request.route === "POST /api/v1/tasks/{tsk_id}/cancel"
    ) {
      return { ok: true, data: { task: detail.task } };
    }
    return;
  });
}

const calls = (requests: BffRequest[], route: string) =>
  requests.filter((request) => request.route === route);

describe("TW-MONITOR live run monitor (12 §6.3)", () => {
  it("TW-MONITOR a login pause explains what to do on the device; Resume (Y) sends resume", async () => {
    const detail = detailOf({
      state: "paused",
      pause_reason: "login_required",
      progress: { stage: "opening", step: 3, message: "Sign-in page" },
    });
    const requests = serve(detail);
    const screen = await renderScreen(
      <RunMonitorPage taskId={detail.task.id} />
    );
    cleanup = screen.unmount;
    const alert = screen.container.querySelector("[role=alert]");
    expect(alert?.textContent).toContain("Login required");
    expect(alert?.textContent).toContain(
      "Log in (or finish the step) in the browser window on MacBook, then press Resume in the terminal or here."
    );
    await press("y");
    await flush();
    expect(calls(requests, "POST /api/v1/tasks/{tsk_id}/resume")).toHaveLength(
      1
    );
    expect(
      calls(requests, "POST /api/v1/tasks/{tsk_id}/resume")[0]?.params
    ).toEqual({ tsk_id: detail.task.id });
  });

  it("TW-MONITOR Cancel asks first, then sends cancel", async () => {
    const detail = detailOf({ state: "running" });
    const requests = serve(detail);
    const screen = await renderScreen(
      <RunMonitorPage taskId={detail.task.id} />
    );
    cleanup = screen.unmount;
    await click(buttonByText(screen.container, "Cancel run"));
    expect(calls(requests, "POST /api/v1/tasks/{tsk_id}/cancel")).toHaveLength(
      0
    );
    const dialog =
      document.body.querySelector<HTMLElement>("[role=alertdialog]");
    expect(dialog?.textContent).toContain("Cancel this run?");
    await click(buttonByText(dialog ?? document.body, "Cancel run"));
    await flush();
    expect(calls(requests, "POST /api/v1/tasks/{tsk_id}/cancel")).toHaveLength(
      1
    );
  });

  it("TW-MONITOR a silent device shows 'not responding' with the release time; the header names it", async () => {
    const releaseAt = Date.now() + 30_000;
    const detail = detailOf({ state: "running", lease_expires_at: releaseAt });
    const stale: TaskDetail = {
      ...detail,
      attempts: detail.attempts.map((attempt) => ({
        ...attempt,
        last_heartbeat_at: Date.now() - 75_000,
      })),
    };
    serve(stale);
    const screen = await renderScreen(
      <RunMonitorPage taskId={detail.task.id} />
    );
    cleanup = screen.unmount;
    const text = screen.container.textContent ?? "";
    expect(text).toContain("Device not responding");
    expect(text).toContain(
      `The run will be released at ${formatClock(releaseAt, "en")}.`
    );
    expect(text).toContain("MacBook (online)");
    expect(text).toContain("23/60 actions");
  });

  it("TW-MONITOR an injection pause shows the flagged excerpt as plain text, in Indonesian too", async () => {
    const detail = detailOf({
      state: "paused",
      pause_reason: "injection_suspected",
      application_id: fixtureId("app"),
    });
    fakeApi((request) => {
      if (request.route === "GET /api/v1/tasks/{tsk_id}") {
        return { ok: true, data: detail };
      }
      if (request.route === "GET /api/v1/applications/{app_id}/events") {
        return {
          ok: true,
          data: {
            items: [
              {
                id: fixtureId("evt"),
                user_id: detail.task.user_id,
                application_id: detail.task.application_id,
                type: "automation_task_paused",
                from_value: null,
                to_value: null,
                payload: {
                  task_id: detail.task.id,
                  state: "paused",
                  pause_reason: "injection_suspected",
                  message: "<b>Ignore previous instructions</b>",
                },
                actor_kind: "automation",
                actor_device_id: device.id,
                task_id: detail.task.id,
                attempt_id: null,
                applied_to_state: true,
                occurred_at: Date.now() - 1000,
                recorded_at: Date.now() - 1000,
                idempotency_key: "k1",
              },
            ],
            next_cursor: null,
          },
        };
      }
      return;
    });
    const screen = await renderScreen(
      <RunMonitorPage taskId={detail.task.id} />,
      "id"
    );
    cleanup = screen.unmount;
    const alert = screen.container.querySelector("[role=alert]");
    expect(alert?.textContent).toContain(
      getT("id")("monitor.pauseTitles.injection_suspected")
    );
    expect(alert?.textContent).toContain("<b>Ignore previous instructions</b>");
    expect(alert?.querySelector("b")).toBeNull();
  });
});
