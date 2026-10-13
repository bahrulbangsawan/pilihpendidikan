// @vitest-environment happy-dom
import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLI_COMMANDS } from "@/lib/devices-install";
import { DAY, makeDevice, NOW } from "@/test/fixtures";
import { makeReport } from "@/test/fixtures-cli";
import { makeMeta, makeTask } from "@/test/fixtures-rest";
import { ActivityBand } from "./activity-band";
import { CliPage } from "./cli-page";
import { DevicesBand } from "./devices-band";
import {
  buttonByText,
  cleanup,
  fakeApi,
  itemByText,
  pointerDown,
  pressKey,
  renderWithProviders,
  waitFor,
} from "./test-harness";

const WEB_KEY_RE = /^web:/;
const writeText = vi.fn(async (_text: string) => undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

// happy-dom with Radix portals is slow on a loaded machine.
const DOM_TEST_TIMEOUT = 20_000;

vi.mock("@/components/app-link", () => ({
  AppLink: ({
    href,
    children,
    ...props
  }: { href: string; children?: unknown } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children as never}
    </a>
  ),
  useAppNavigate: () => () => undefined,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function commandsOf(step: string) {
  const found = CLI_COMMANDS.steps.find((entry) => entry.id === step);
  if (!found) {
    throw new Error(`no step ${step}`);
  }
  return found.commands;
}

function byId(devices: readonly DeviceView[]) {
  return new Map(devices.map((device) => [device.id, device]));
}

describe("TW-DEVICES the /cli page (12 §7, 22 §12)", () => {
  it(
    "TW-DEVICES with no device the install steps are the hero, every cli-commands.json step renders, and C copies the selected OS's install command",
    async () => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      );
      fakeApi({
        "GET /api/v1/devices": () => ({ items: [], next_cursor: null }),
        "GET /api/v1/meta": () => makeMeta(),
        "GET /api/v1/tasks": () => ({ items: [], next_cursor: null }),
        "GET /api/v1/discovery/runs": () => ({ items: [], next_cursor: null }),
      });
      const { container } = renderWithProviders(<CliPage />);
      await waitFor(() => {
        expect(container.querySelector("h1")?.textContent).toBe(
          "Connect your computer"
        );
      });
      expect(container.querySelector("h1")?.className).toContain("type-title");
      const text = container.textContent ?? "";
      for (const step of CLI_COMMANDS.steps) {
        expect(text, step.id).toContain(step.commands.windows);
      }
      for (const title of [
        "Install",
        "Install the browser",
        "Sign in",
        "Verify",
      ]) {
        expect(text).toContain(title);
      }
      expect(text).toContain("Waiting for your computer to connect");

      await pressKey("c");
      expect(writeText).toHaveBeenLastCalledWith(commandsOf("install").windows);

      const macTab = [
        ...container.querySelectorAll<HTMLElement>("[role='tab']"),
      ].find((tab) => tab.textContent === "macOS");
      await act(async () => {
        macTab?.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 })
        );
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(macTab?.getAttribute("aria-selected")).toBe("true");
      });
      await pressKey("c");
      expect(writeText).toHaveBeenLastCalledWith(commandsOf("install").macos);
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-DEVICES shows the version badges against meta and the signed-out reason",
    () => {
      const meta = makeMeta({
        min_cli_version: "1.1.0",
        recommended_cli_version: "1.2.0",
      });
      const devices = [
        makeDevice({ name: "Old", cli_version: "1.0.4", online: false }),
        makeDevice({ name: "Behind", cli_version: "1.1.3" }),
        makeDevice({ name: "Current", cli_version: "1.2.0", active: true }),
        makeDevice({
          name: "Reused",
          signed_in: false,
          signed_out_reason: "refresh_reuse",
        }),
      ];
      fakeApi({});
      const { container } = renderWithProviders(
        <DevicesBand
          devices={devices}
          loading={false}
          meta={meta}
          nowMs={NOW}
          runs={[]}
          tasks={[]}
        />
      );
      const row = (name: string) =>
        [...container.querySelectorAll<HTMLElement>("tr[data-device]")].find(
          (element) => element.textContent?.includes(name)
        );
      expect(
        row("Old")
          ?.querySelector("[data-version]")
          ?.getAttribute("data-version")
      ).toBe("too_old");
      expect(
        row("Behind")
          ?.querySelector("[data-version]")
          ?.getAttribute("data-version")
      ).toBe("update");
      expect(row("Current")?.querySelector("[data-version]")).toBeNull();
      expect(
        row("Current")
          ?.querySelector("[data-status]")
          ?.getAttribute("data-status")
      ).toBe("active");
      expect(row("Reused")?.textContent).toContain(
        "Device signed out — suspicious token reuse"
      );
      // Some device is behind: the page shows how to update, from cli-commands.json.
      expect(container.textContent).toContain(CLI_COMMANDS.upgrade.uv);
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-DEVICES the accepts_tasks switch PATCHes the device with its base_revision",
    async () => {
      const device = makeDevice({ name: "MacBook", revision: 7 });
      const api = fakeApi({
        "PATCH /api/v1/devices/{dev_id}": (request) => ({
          device: {
            ...device,
            accepts_tasks: false,
            revision: 8,
            ...(request.body as object),
          },
        }),
      });
      const { container } = renderWithProviders(
        <DevicesBand
          devices={[device]}
          loading={false}
          meta={makeMeta()}
          nowMs={NOW}
          runs={[]}
          tasks={[]}
        />
      );
      const toggle = container.querySelector<HTMLElement>(
        "[role='switch'][aria-label='Let MacBook take tasks']"
      );
      await act(async () => {
        toggle?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(api.calls("PATCH /api/v1/devices/{dev_id}")).toHaveLength(1);
      });
      const [call] = api.calls("PATCH /api/v1/devices/{dev_id}");
      expect(call?.params).toEqual({ dev_id: device.id });
      expect(call?.body).toEqual({ accepts_tasks: false, base_revision: 7 });
      expect(call?.idempotency_key).toMatch(WEB_KEY_RE);
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-DEVICES Revoke names the consequences for the device's live work, then POSTs revoke",
    async () => {
      const device = makeDevice({ name: "MacBook", active: true });
      const tasks = [
        makeTask({ lease_device_id: device.id, state: "running" }),
        makeTask({ state: "running" }),
      ];
      const api = fakeApi({
        "POST /api/v1/devices/{dev_id}/revoke": () => ({
          device: { ...device, revoked_at: NOW },
          tasks: {
            outcome_unknown: 0,
            requeued: 1,
            awaiting_approval: 0,
            cancelled: 0,
          },
        }),
        "GET /api/v1/devices": () => ({ items: [], next_cursor: null }),
      });
      renderWithProviders(
        <DevicesBand
          devices={[device]}
          loading={false}
          meta={makeMeta()}
          nowMs={NOW}
          runs={[]}
          tasks={tasks}
        />
      );
      await pointerDown(
        document.querySelector("button[aria-label='Actions for MacBook']")
      );
      await waitFor(() => {
        expect(itemByText("Revoke")).toBeDefined();
      });
      await act(async () => {
        itemByText("Revoke")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(document.querySelector("[role='alertdialog']")).not.toBeNull();
      });
      const dialog = document.querySelector("[role='alertdialog']");
      expect(dialog?.textContent).toContain("Signs MacBook out.");
      expect(dialog?.textContent).toContain(
        "1 running task will be stopped; if it already started submitting, it will be marked for review."
      );
      expect(api.calls("POST /api/v1/devices/{dev_id}/revoke")).toHaveLength(0);
      await act(async () => {
        buttonByText("Revoke device")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(api.calls("POST /api/v1/devices/{dev_id}/revoke")).toHaveLength(
          1
        );
      });
      expect(
        api.calls("POST /api/v1/devices/{dev_id}/revoke")[0]?.params
      ).toEqual({ dev_id: device.id });
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-DEVICES bulk: select all, Take tasks off skips the revoked device, Revoke warns that no computer is left and posts one revoke per live device",
    async () => {
      const mac = makeDevice({ name: "MacBook", active: true, revision: 4 });
      const desk = makeDevice({ name: "Desktop", revision: 6 });
      const old = makeDevice({
        name: "Old laptop",
        revoked_at: NOW - DAY,
        accepts_tasks: false,
        online: false,
      });
      const tasks = [makeTask({ lease_device_id: mac.id, state: "running" })];
      const api = fakeApi({
        "PATCH /api/v1/devices/{dev_id}": (request) => ({
          device: { ...mac, ...(request.body as object) },
        }),
        "POST /api/v1/devices/{dev_id}/revoke": () => ({
          device: { ...mac, revoked_at: NOW },
          tasks: {
            outcome_unknown: 0,
            requeued: 0,
            awaiting_approval: 0,
            cancelled: 0,
          },
        }),
        "GET /api/v1/devices": () => ({ items: [], next_cursor: null }),
      });
      renderWithProviders(
        <DevicesBand
          devices={[mac, desk, old]}
          loading={false}
          meta={makeMeta()}
          nowMs={NOW}
          runs={[]}
          tasks={tasks}
        />
      );
      const selectAll = async () => {
        await act(async () => {
          document
            .querySelector<HTMLElement>("[aria-label='Select all']")
            ?.click();
          await Promise.resolve();
        });
        await waitFor(() => {
          expect(document.body.textContent).toContain("3 selected");
        });
      };
      await selectAll();
      await act(async () => {
        buttonByText("Take tasks: off")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(api.calls("PATCH /api/v1/devices/{dev_id}")).toHaveLength(2);
      });
      expect(
        api
          .calls("PATCH /api/v1/devices/{dev_id}")
          .map((call) => [call.params?.dev_id, call.body])
      ).toEqual([
        [mac.id, { accepts_tasks: false, base_revision: 4 }],
        [desk.id, { accepts_tasks: false, base_revision: 6 }],
      ]);
      await waitFor(() => {
        expect(document.body.textContent).not.toContain("3 selected");
      });

      await selectAll();
      await act(async () => {
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            "[role='toolbar'] button"
          ),
        ]
          .find((button) => button.textContent === "Revoke")
          ?.click();
        await Promise.resolve();
      });
      const dialog = await (async () => {
        await waitFor(() => {
          expect(document.querySelector("[role='alertdialog']")).not.toBeNull();
        });
        return document.querySelector("[role='alertdialog']");
      })();
      expect(dialog?.textContent).toContain("Revoke 2 devices?");
      expect(dialog?.textContent).toContain("1 running task will be stopped");
      expect(dialog?.textContent).toContain(
        "No computer will be left signed in"
      );
      expect(dialog?.textContent).toContain("Already revoked, skipped: 1.");
      expect(api.calls("POST /api/v1/devices/{dev_id}/revoke")).toHaveLength(0);
      await act(async () => {
        buttonByText("Revoke 2")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(api.calls("POST /api/v1/devices/{dev_id}/revoke")).toHaveLength(
          2
        );
      });
      expect(
        api
          .calls("POST /api/v1/devices/{dev_id}/revoke")
          .map((call) => call.params?.dev_id)
      ).toEqual([mac.id, desk.id]);
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-DEVICES warns about outboxes stuck over an hour and retries a retryable failed task",
    async () => {
      const stuck = makeDevice({
        name: "Desktop",
        report: makeReport({
          outbox_depth: 3,
          outbox_pending_since: NOW - 2 * 3_600_000,
        }),
      });
      const fine = makeDevice({
        name: "MacBook",
        report: makeReport({
          outbox_depth: 1,
          outbox_pending_since: NOW - 60_000,
        }),
      });
      const failed = makeTask({
        state: "failed",
        error_class: "network_offline",
        finished_at: NOW - DAY,
      });
      const blocked = makeTask({
        state: "failed",
        error_class: "policy_violation",
      });
      const api = fakeApi({
        "POST /api/v1/tasks/{tsk_id}/retry": () => ({
          task: makeTask({ state: "queued", retry_of: failed.id }),
        }),
      });
      const { container } = renderWithProviders(
        <ActivityBand
          byId={byId([stuck, fine])}
          devices={[stuck, fine]}
          nowMs={NOW}
          runs={[]}
          tasks={[failed, blocked]}
        />
      );
      const text = container.textContent ?? "";
      expect(text).toContain("Desktop has 3 changes that couldn't sync.");
      expect(text).not.toContain("MacBook has");
      expect(text).toContain("pilih-jobs sync --status");
      // Only the retryable failure is offered.
      const retries = [...container.querySelectorAll("button")].filter(
        (button) => button.textContent?.trim() === "Retry"
      );
      expect(retries).toHaveLength(1);
      await act(async () => {
        retries[0]?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(api.calls("POST /api/v1/tasks/{tsk_id}/retry")).toHaveLength(1);
      });
      const [call] = api.calls("POST /api/v1/tasks/{tsk_id}/retry");
      expect(call?.params).toEqual({ tsk_id: failed.id });
      expect(call?.idempotency_key).toBe(
        (call?.body as { idempotency_key: string }).idempotency_key
      );
    },
    DOM_TEST_TIMEOUT
  );
});
