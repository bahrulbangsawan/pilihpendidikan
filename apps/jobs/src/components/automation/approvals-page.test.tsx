// @vitest-environment happy-dom
import type { ApprovalRecord } from "@pilihpendidikan/jobs-contracts/records";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest } from "@/lib/bff";
import { fixtureId, makeBoard, makeCard } from "@/test/fixtures";
import {
  answerPayload,
  cvVariantPayload,
  makeApproval,
  makeRule,
  ruleActivationPayload,
  submitPayload,
} from "@/test/fixtures-rest";
import { click } from "@/test/render";
import { ApprovalsPage } from "./approvals-page";
import type { Handler } from "./screen-harness.test-utils";
import {
  buttonByText,
  fakeApi,
  flush,
  press,
  renderScreen,
} from "./screen-harness.test-utils";

const acme = makeCard({
  company: "Acme",
  title: "Frontend Engineer",
  stage: "ready",
});
const board = makeBoard([acme]);
const submit = makeApproval(submitPayload(acme.posting.id), {
  application_id: acme.id,
  payload_hash: "e".repeat(64),
});
const answer = makeApproval(answerPayload(), {
  application_id: acme.id,
  payload_hash: "f".repeat(64),
  expires_at: submit.expires_at + 60_000,
});

const WEB_KEY_RE = /^web:/;

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

function queue(
  approvals: ApprovalRecord[],
  onDecide?: (request: BffRequest) => ReturnType<Handler>
): Handler {
  return (request) => {
    if (request.route === "GET /api/v1/approvals") {
      return { ok: true, data: { items: approvals, next_cursor: null } };
    }
    if (request.route === "POST /api/v1/approvals/{apr_id}/decide") {
      return (
        onDecide?.(request) ?? {
          ok: true,
          data: {
            approval: { ...approvals[0], state: "approved" },
            task: null,
          },
        }
      );
    }
    return;
  };
}

function decides(requests: BffRequest[]) {
  return requests.filter(
    (request) => request.route === "POST /api/v1/approvals/{apr_id}/decide"
  );
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[role=alertdialog]");
}

describe("TW-APPROVAL approval queue (12 §6.1)", () => {
  it("TW-APPROVAL approving asks first, then decides with the payload_hash and an idempotency key", async () => {
    const requests = fakeApi(queue([submit]), board);
    const screen = await renderScreen(<ApprovalsPage />);
    cleanup = screen.unmount;
    expect(screen.container.textContent).toContain(
      "Submit application to Acme — Frontend Engineer"
    );
    await click(buttonByText(screen.container, "Approve and submit"));
    await flush();
    expect(decides(requests)).toHaveLength(0);
    expect(dialog()?.textContent).toContain("Submit this application to Acme?");
    expect(dialog()?.textContent).toContain("This can't be undone.");
    await click(buttonByText(dialog() ?? document.body, "Approve and submit"));
    await flush();
    const [sent] = decides(requests);
    expect(sent?.params).toEqual({ apr_id: submit.id });
    expect(sent?.body).toEqual({
      decision: "approve",
      payload_hash: submit.payload_hash,
    });
    expect(sent?.idempotency_key).toMatch(WEB_KEY_RE);
  });

  it("TW-APPROVAL a changed form says the agent will ask again", async () => {
    fakeApi(
      queue([submit], () => ({
        ok: false,
        status: 409,
        error: "revision_conflict",
        details: { reason: "payload_hash_mismatch" },
      })),
      board
    );
    const screen = await renderScreen(<ApprovalsPage />);
    cleanup = screen.unmount;
    await click(buttonByText(screen.container, "Approve and submit"));
    await flush();
    await click(buttonByText(dialog() ?? document.body, "Approve and submit"));
    await flush();
    expect(screen.container.textContent).toContain(
      "The form changed since this was prepared. The agent will ask again."
    );
  });

  it("TW-APPROVAL J / K move through the queue, Y approves and X rejects (each asks first)", async () => {
    const requests = fakeApi(queue([submit, answer]), board);
    const screen = await renderScreen(<ApprovalsPage />);
    cleanup = screen.unmount;
    const current = () =>
      screen.container
        .querySelector("[aria-current=true]")
        ?.getAttribute("data-approval-id");
    expect(current()).toBe(submit.id);
    await press("j");
    expect(current()).toBe(answer.id);
    await press("k");
    expect(current()).toBe(submit.id);
    await press("x");
    expect(dialog()?.textContent).toContain("Don't submit this application?");
    await click(buttonByText(dialog() ?? document.body, "Reject"));
    await flush();
    expect(decides(requests)[0]?.body).toMatchObject({
      decision: "reject",
      payload_hash: submit.payload_hash,
    });
    await press("y");
    expect(dialog()).not.toBeNull();
  });

  it("TW-APPROVAL contact values start masked and the toggle reveals them", async () => {
    fakeApi(queue([submit]), board);
    const screen = await renderScreen(<ApprovalsPage />);
    cleanup = screen.unmount;
    const text = () => screen.container.textContent ?? "";
    expect(text()).not.toContain("rina.wulandari@example.com");
    expect(text()).toContain("r…@example.com");
    expect(text()).toContain("(your saved answer)");
    await click(buttonByText(screen.container, "Show contact values"));
    expect(text()).toContain("rina.wulandari@example.com");
  });

  it("TW-APPROVAL an answer approval sends the answers, saved to the bank only when ticked", async () => {
    const requests = fakeApi(queue([answer]), board);
    const screen = await renderScreen(<ApprovalsPage />);
    cleanup = screen.unmount;
    expect(screen.container.textContent).toContain(
      "Do you require visa sponsorship?"
    );
    const save = screen.container.querySelector<HTMLButtonElement>(
      "article button[role=checkbox]"
    );
    await click(save);
    await press("y");
    await click(buttonByText(dialog() ?? document.body, "Send answers"));
    await flush();
    const body = decides(requests)[0]?.body as {
      response: { answers: Record<string, unknown>[] };
    };
    expect(body.response.answers).toEqual([
      {
        ref: "q1",
        value: "no",
        save_to_bank: true,
        sensitivity: "protected",
        auto_use: "approval",
      },
    ]);
  });
});

// Bulk decisions: every approval far from expiry (the fixtures' clock is fixed).
const LATER = Date.now() + 86_400_000;
const bulkSubmit = { ...submit, expires_at: LATER };
const bulkAnswer = { ...answer, expires_at: LATER + 1 };
const cv = makeApproval(cvVariantPayload(fixtureId("cvv"), fixtureId("fil")), {
  application_id: acme.id,
  payload_hash: "c".repeat(64),
  expires_at: LATER + 2,
});
const otherCv = makeApproval(
  cvVariantPayload(fixtureId("cvv"), fixtureId("fil")),
  {
    application_id: acme.id,
    payload_hash: "d".repeat(64),
    expires_at: LATER + 3,
  }
);
const ruleActivation = makeApproval(ruleActivationPayload(makeRule()), {
  payload_hash: "b".repeat(64),
  expires_at: LATER + 4,
});

function selectAll(root: Element) {
  return root.querySelector<HTMLButtonElement>(
    "button[role=checkbox][aria-label='Select all']"
  );
}

/** Opens the per-row results from the summary toast's "Details" action. */
async function openReport(): Promise<string> {
  const options = toasts.calls.at(-1)?.[1] as ToastOptions | undefined;
  await act(async () => {
    options?.action?.onClick();
    await Promise.resolve();
  });
  await flush(2);
  return document.body.querySelector("[role=dialog]")?.textContent ?? "";
}

describe("TW-APPROVAL bulk decisions", () => {
  it("TW-APPROVAL bulk approve sends only approvals that need no input, each with its own payload_hash, and skips submissions, answers and rule activations", async () => {
    const requests = fakeApi(
      queue([bulkSubmit, bulkAnswer, cv, otherCv, ruleActivation], (request) =>
        request.params?.apr_id === otherCv.id
          ? {
              ok: false,
              status: 409,
              error: "revision_conflict",
              details: { reason: "payload_hash_mismatch" },
            }
          : undefined
      ),
      board
    );
    const screen = await renderScreen(<ApprovalsPage />);
    cleanup = screen.unmount;
    await click(selectAll(screen.container));
    expect(screen.container.textContent).toContain("5 selected");
    await click(buttonByText(screen.container, "Approve…"));
    await flush();
    expect(dialog()?.textContent).toContain("2 will be approved and 3 skipped");
    expect(decides(requests)).toHaveLength(0);
    await click(buttonByText(dialog() ?? document.body, "Approve 2"));
    await flush();
    const sent = decides(requests);
    expect(sent.map((request) => request.params?.apr_id).sort()).toEqual(
      [cv.id, otherCv.id].sort()
    );
    for (const request of sent) {
      const own = request.params?.apr_id === cv.id ? cv : otherCv;
      expect(request.body).toEqual({
        decision: "approve",
        payload_hash: own.payload_hash,
      });
      expect(request.idempotency_key).toMatch(WEB_KEY_RE);
    }
    expect(sent[0]?.idempotency_key).not.toBe(sent[1]?.idempotency_key);
    expect(toasts.calls.at(-1)?.[1]).toMatchObject({
      message: "1 done · 3 skipped · 1 changed elsewhere · 0 failed",
    });
    const report = await openReport();
    expect(report).toContain(
      "Submissions are reviewed one at a time: open it on its own."
    );
    expect(report).toContain("Needs your answers: open it on its own.");
    expect(report).toContain(
      "Needs the rule's name typed: open it on its own."
    );
    expect(report).toContain("Changed elsewhere");
    expect(report).toContain(
      "The form changed since this was prepared. The agent will ask again."
    );
  });

  it("TW-APPROVAL bulk reject covers every pending kind, still asks first, and selection checkboxes do not change the open approval", async () => {
    const requests = fakeApi(queue([bulkSubmit, cv]), board);
    const screen = await renderScreen(<ApprovalsPage />);
    cleanup = screen.unmount;
    const current = () =>
      screen.container
        .querySelector("[aria-current=true]")
        ?.getAttribute("data-approval-id");
    expect(current()).toBe(bulkSubmit.id);
    const rows = screen.container.querySelectorAll<HTMLButtonElement>(
      "li button[role=checkbox]"
    );
    expect(rows).toHaveLength(2);
    await click(rows[1]);
    await click(rows[0]);
    expect(current()).toBe(bulkSubmit.id);
    await click(buttonByText(screen.container, "Reject…"));
    await flush();
    expect(dialog()?.textContent).toContain("2 will be rejected and 0 skipped");
    await click(buttonByText(dialog() ?? document.body, "Reject 2"));
    await flush();
    expect(
      decides(requests)
        .map((request) => request.body)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    ).toEqual([
      { decision: "reject", payload_hash: cv.payload_hash },
      { decision: "reject", payload_hash: bulkSubmit.payload_hash },
    ]);
  });

  it("TW-APPROVAL a selection of submissions only cannot be bulk approved", async () => {
    const requests = fakeApi(queue([bulkSubmit]), board);
    const screen = await renderScreen(<ApprovalsPage />);
    cleanup = screen.unmount;
    await click(selectAll(screen.container));
    await click(buttonByText(screen.container, "Approve…"));
    await flush();
    expect(dialog()?.textContent).toContain("0 will be approved and 1 skipped");
    const confirm = buttonByText(dialog() ?? document.body, "Approve 0");
    expect(confirm?.disabled).toBe(true);
    await click(confirm);
    await flush();
    expect(decides(requests)).toHaveLength(0);
  });
});
