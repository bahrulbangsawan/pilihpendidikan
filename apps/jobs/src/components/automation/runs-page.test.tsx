// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest } from "@/lib/bff";
import { makeTask } from "@/test/fixtures-rest";
import { click } from "@/test/render";
import { RunsPage } from "./runs-page";
import {
  buttonByText,
  fakeApi,
  flush,
  renderScreen,
} from "./screen-harness.test-utils";

interface ToastOptions {
  action?: { onClick: () => void };
}
const toasts = vi.hoisted(() => ({ calls: [] as [string, unknown][] }));
vi.mock("sonner", () => {
  const record =
    (kind: string) =>
    (message: string, options?: unknown): void => {
      toasts.calls.push([kind, { message, ...(options as object) }]);
    };
  return {
    toast: Object.assign(record("default"), {
      success: record("success"),
      warning: record("warning"),
      info: record("info"),
      error: record("error"),
    }),
  };
});

let cleanup: (() => void) | null = null;

afterEach(() => {
  toasts.calls.length = 0;
  cleanup?.();
  cleanup = null;
  setBffTransport(null);
  document.body.replaceChildren();
});

const failed = makeTask({ state: "failed", error_class: "timeout" });
const unknown = makeTask({ state: "outcome_unknown" });
const running = makeTask({ state: "running" });
const submitting = makeTask({ state: "running", submit_intent_at: 1 });
const done = makeTask({ state: "succeeded" });
const all = [failed, unknown, running, submitting, done];

function api() {
  return fakeApi((request) => {
    if (request.route === "GET /api/v1/tasks") {
      return { ok: true, data: { items: all, next_cursor: null } };
    }
    if (request.route === "POST /api/v1/tasks/{tsk_id}/retry") {
      return {
        ok: true,
        data: { task: makeTask({ state: "queued", retry_of: failed.id }) },
      };
    }
    if (request.route === "POST /api/v1/tasks/{tsk_id}/cancel") {
      return {
        ok: true,
        data: { task: { ...running, cancel_requested: true } },
      };
    }
    return;
  });
}

function sent(requests: BffRequest[], route: string) {
  return requests.filter((request) => request.route === route);
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[role=alertdialog]");
}

async function selectAllAndOpen(label: string) {
  const screen = await renderScreen(<RunsPage />);
  cleanup = screen.unmount;
  await click(
    screen.container.querySelector(
      "button[role=checkbox][aria-label='Select all']"
    )
  );
  expect(screen.container.textContent).toContain("5 selected");
  await click(buttonByText(screen.container, label));
  await flush();
  return screen;
}

async function openReport(): Promise<string> {
  const options = toasts.calls.at(-1)?.[1] as ToastOptions | undefined;
  await act(async () => {
    options?.action?.onClick();
    await Promise.resolve();
  });
  await flush(2);
  return document.body.querySelector("[role=dialog]")?.textContent ?? "";
}

describe("TW-RUNS bulk run controls (12 §6.3)", () => {
  it("TW-RUNS bulk retry retries failed runs only and never blind-retries an outcome_unknown run", async () => {
    const requests = api();
    await selectAllAndOpen("Retry…");
    expect(dialog()?.textContent).toContain(
      "1 failed runs will be queued again and 4 skipped"
    );
    expect(sent(requests, "POST /api/v1/tasks/{tsk_id}/retry")).toHaveLength(0);
    await click(buttonByText(dialog() ?? document.body, "Retry 1"));
    await flush();
    const retries = sent(requests, "POST /api/v1/tasks/{tsk_id}/retry");
    expect(retries).toHaveLength(1);
    expect(retries[0]?.params).toEqual({ tsk_id: failed.id });
    const body = retries[0]?.body as Record<string, unknown>;
    expect(body.confirm_not_submitted).toBeUndefined();
    expect(body.idempotency_key).toBe(retries[0]?.idempotency_key);
    const report = await openReport();
    expect(report).toContain(
      "Answer “Did this application go through?” on this run first."
    );
    expect(report).toContain("Only failed runs can be retried.");
  });

  it("TW-RUNS bulk cancel asks first and cancels only live runs not yet submitting", async () => {
    const requests = api();
    await selectAllAndOpen("Cancel…");
    expect(dialog()?.textContent).toContain(
      "1 will be cancelled and 4 skipped"
    );
    expect(
      buttonByText(dialog() ?? document.body, "Keep running")
    ).toBeDefined();
    await click(buttonByText(dialog() ?? document.body, "Cancel 1"));
    await flush();
    const cancels = sent(requests, "POST /api/v1/tasks/{tsk_id}/cancel");
    expect(cancels.map((request) => request.params)).toEqual([
      { tsk_id: running.id },
    ]);
    expect(toasts.calls.at(-1)?.[1]).toMatchObject({
      message: "1 done · 4 skipped · 0 changed elsewhere · 0 failed",
    });
    const report = await openReport();
    expect(report).toContain("Already submitting: too late to cancel.");
    expect(report).toContain("Already finished.");
  });
});
