// @vitest-environment happy-dom
import type { ApprovalRecord } from "@pilihpendidikan/jobs-contracts/records";
import { afterEach, describe, expect, it } from "vitest";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest } from "@/lib/bff";
import { makeBoard, makeCard } from "@/test/fixtures";
import {
  answerPayload,
  makeApproval,
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

let cleanup: (() => void) | null = null;

afterEach(() => {
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
      "button[role=checkbox]"
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
