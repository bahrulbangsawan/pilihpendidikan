// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest } from "@/lib/bff";
import {
  makeApproval,
  makeRule,
  ruleActivationPayload,
} from "@/test/fixtures-rest";
import { click } from "@/test/render";
import { RulesPage } from "./rules-page";
import {
  buttonByText,
  fakeApi,
  flush,
  renderScreen,
  typeInto,
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

const rule = makeRule({
  name: "Greenhouse auto-apply",
  mode: "auto",
  enabled: false,
  allowed_domains: ["greenhouse.io"],
  revision: 4,
});
const activation = makeApproval(ruleActivationPayload(rule), {
  payload_hash: "a1".repeat(32),
});

function routes(requests: BffRequest[]) {
  return requests.map((request) => request.route);
}

describe("TW-RULES rules table and auto activation (12 §6.2)", () => {
  it("TW-RULES turning on an auto rule sends base_revision, then activation needs the exact rule name", async () => {
    const requests = fakeApi((request) => {
      if (request.route === "GET /api/v1/rules") {
        return { ok: true, data: { items: [rule], next_cursor: null } };
      }
      if (request.route === "PATCH /api/v1/rules/{rul_id}") {
        return {
          ok: true,
          data: { rule: { ...rule, revision: 5 }, approval: activation },
        };
      }
      if (request.route === "POST /api/v1/approvals/{apr_id}/decide") {
        return {
          ok: true,
          data: { approval: { ...activation, state: "approved" }, task: null },
        };
      }
      return;
    });
    const screen = await renderScreen(<RulesPage />);
    cleanup = screen.unmount;
    expect(screen.container.textContent).toContain("Greenhouse auto-apply");
    await click(screen.container.querySelector("button[role=switch]"));
    await flush();
    const patch = requests.find(
      (request) => request.route === "PATCH /api/v1/rules/{rul_id}"
    );
    expect(patch?.params).toEqual({ rul_id: rule.id });
    expect(patch?.body).toEqual({ enabled: true, base_revision: 4 });

    const dialog =
      document.body.querySelector<HTMLElement>("[role=alertdialog]");
    expect(dialog?.textContent).toContain("Activate “Greenhouse auto-apply”?");
    expect(dialog?.textContent).toContain("Up to 5 applications a day");
    const activate = buttonByText(dialog ?? document.body, "Activate rule");
    const input = dialog?.querySelector<HTMLInputElement>("input");
    expect(activate?.disabled).toBe(true);
    if (!input) {
      throw new Error("No name field.");
    }
    await typeInto(input, "greenhouse auto-apply");
    expect(activate?.disabled).toBe(true);
    await click(activate);
    expect(routes(requests)).not.toContain(
      "POST /api/v1/approvals/{apr_id}/decide"
    );
    await typeInto(input, "Greenhouse auto-apply");
    expect(activate?.disabled).toBe(false);
    await click(activate);
    await flush();
    const decide = requests.find(
      (request) => request.route === "POST /api/v1/approvals/{apr_id}/decide"
    );
    expect(decide?.params).toEqual({ apr_id: activation.id });
    expect(decide?.body).toEqual({
      decision: "approve",
      payload_hash: activation.payload_hash,
    });
  });

  it("TW-RULES the table summarizes criteria and limits and flags a pending activation", async () => {
    fakeApi((request) => {
      if (request.route === "GET /api/v1/rules") {
        return { ok: true, data: { items: [rule], next_cursor: null } };
      }
      if (request.route === "GET /api/v1/approvals") {
        return { ok: true, data: { items: [activation], next_cursor: null } };
      }
      return;
    });
    const screen = await renderScreen(<RulesPage />);
    cleanup = screen.unmount;
    const text = screen.container.textContent ?? "";
    expect(text).toContain("react, frontend · score 80+");
    expect(text).toContain("5 a day · 2 per company in 30 days · 08:00–20:00");
    expect(text).toContain("Needs activation");
    expect(buttonByText(screen.container, "Activate…")).toBeDefined();
  });

  it("TW-RULES the editor refuses an auto rule without its constraints and sends nothing", async () => {
    const requests = fakeApi((request) =>
      request.route === "GET /api/v1/rules"
        ? { ok: true, data: { items: [], next_cursor: null } }
        : undefined
    );
    const screen = await renderScreen(<RulesPage />);
    cleanup = screen.unmount;
    await click(buttonByText(screen.container, "New rule"));
    await flush();
    const sheet = document.body.querySelector<HTMLElement>("[role=dialog]");
    if (!sheet) {
      throw new Error("No editor.");
    }
    const name = sheet.querySelector<HTMLInputElement>("input");
    if (!name) {
      throw new Error("No name field.");
    }
    await typeInto(name, "Everything, automatically");
    const auto = [
      ...sheet.querySelectorAll<HTMLButtonElement>("[role=radio]"),
    ].find((radio) => radio.getAttribute("value") === "auto");
    await click(auto);
    await click(buttonByText(sheet, "Save"));
    await flush();
    const text = sheet.textContent ?? "";
    expect(text).toContain(
      "Auto rules need keywords, title patterns, companies or sources."
    );
    expect(text).toContain("Auto rules need at least one allowed domain.");
    expect(routes(requests)).not.toContain("POST /api/v1/rules");
  });
});

const manualOff = makeRule({
  name: "Design roles",
  enabled: false,
  revision: 7,
});
const approvalOn = makeRule({ name: "Frontend roles", revision: 3 });
const autoOff = makeRule({
  name: "Lever auto-apply",
  mode: "auto",
  enabled: false,
  allowed_domains: ["lever.co"],
  revision: 9,
});

function bulkRules(
  onWrite?: (request: BffRequest) => ReturnType<Parameters<typeof fakeApi>[0]>
) {
  return fakeApi((request) => {
    if (request.route === "GET /api/v1/rules") {
      return {
        ok: true,
        data: { items: [manualOff, approvalOn, autoOff], next_cursor: null },
      };
    }
    if (
      request.route === "PATCH /api/v1/rules/{rul_id}" ||
      request.route === "DELETE /api/v1/rules/{rul_id}"
    ) {
      return (
        onWrite?.(request) ?? {
          ok: true,
          data:
            request.route === "PATCH /api/v1/rules/{rul_id}"
              ? { rule: manualOff }
              : { id: request.params?.rul_id, deleted: true },
        }
      );
    }
    return;
  });
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

function selectAll(root: Element) {
  return root.querySelector<HTMLButtonElement>(
    "button[role=checkbox][aria-label='Select all']"
  );
}

describe("TW-RULES bulk actions", () => {
  it("TW-RULES bulk turn on sends base_revision for plain rules and never turns an auto rule on", async () => {
    const requests = bulkRules();
    const screen = await renderScreen(<RulesPage />);
    cleanup = screen.unmount;
    await click(selectAll(screen.container));
    expect(screen.container.textContent).toContain("3 selected");
    await click(buttonByText(screen.container, "Turn on"));
    await flush();
    const patches = requests.filter(
      (request) => request.route === "PATCH /api/v1/rules/{rul_id}"
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]?.params).toEqual({ rul_id: manualOff.id });
    expect(patches[0]?.body).toEqual({ enabled: true, base_revision: 7 });
    expect(routes(requests)).not.toContain(
      "POST /api/v1/approvals/{apr_id}/decide"
    );
    expect(toasts.calls.at(-1)?.[1]).toMatchObject({
      message: "1 done · 2 skipped · 0 changed elsewhere · 0 failed",
    });
    const report = await openReport();
    expect(report).toContain("Already on.");
    expect(report).toContain(
      "Auto rules are turned on one at a time: use its switch and type its name to activate it."
    );
  });

  it("TW-RULES bulk turn off only touches rules that are on", async () => {
    const requests = bulkRules();
    const screen = await renderScreen(<RulesPage />);
    cleanup = screen.unmount;
    await click(selectAll(screen.container));
    await click(buttonByText(screen.container, "Turn off"));
    await flush();
    const patches = requests.filter(
      (request) => request.route === "PATCH /api/v1/rules/{rul_id}"
    );
    expect(patches.map((request) => request.body)).toEqual([
      { enabled: false, base_revision: 3 },
    ]);
  });

  it("TW-RULES bulk delete asks first, then deletes each rule at its revision and reports a conflict", async () => {
    const requests = bulkRules((request) =>
      request.route === "DELETE /api/v1/rules/{rul_id}" &&
      request.params?.rul_id === approvalOn.id
        ? { ok: false, status: 409, error: "revision_conflict" }
        : undefined
    );
    const screen = await renderScreen(<RulesPage />);
    cleanup = screen.unmount;
    await click(selectAll(screen.container));
    await click(buttonByText(screen.container, "Delete…"));
    await flush();
    const dialog =
      document.body.querySelector<HTMLElement>("[role=alertdialog]");
    expect(dialog?.textContent).toContain("Delete the selected rules?");
    expect(dialog?.textContent).toContain("Rules to delete: 3.");
    expect(routes(requests)).not.toContain("DELETE /api/v1/rules/{rul_id}");
    await click(buttonByText(dialog ?? document.body, "Delete 3"));
    await flush();
    const deletes = requests.filter(
      (request) => request.route === "DELETE /api/v1/rules/{rul_id}"
    );
    expect(
      deletes.map((request) => [request.params?.rul_id, request.query]).sort()
    ).toEqual(
      [
        [manualOff.id, { base_revision: 7 }],
        [approvalOn.id, { base_revision: 3 }],
        [autoOff.id, { base_revision: 9 }],
      ].sort()
    );
    expect(toasts.calls.at(-1)?.[1]).toMatchObject({
      message: "2 done · 0 skipped · 1 changed elsewhere · 0 failed",
    });
  });
});
