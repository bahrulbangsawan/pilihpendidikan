// @vitest-environment happy-dom
import {
  ADAPTER_MANIFESTS,
  EXCLUDED_SOURCES,
} from "@pilihpendidikan/jobs-contracts/adapters";
import type { DeviceView } from "@pilihpendidikan/jobs-contracts/api";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buttonByText,
  cleanup,
  FakeFailure,
  fakeApi,
  itemByText,
  pointerDown,
  renderWithProviders,
  typeInto,
  waitFor,
} from "@/components/cli/test-harness";
import { testCommand } from "@/lib/sources-model";
import { makeDevice, NOW } from "@/test/fixtures";
import { makeRun, makeSource } from "@/test/fixtures-rest";
import { RunsTable } from "./runs-table";
import type { SheetTarget } from "./source-sheet";
import { SourceSheet } from "./source-sheet";
import { SourcesTable } from "./sources-table";

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

const toasts = vi.hoisted(() => ({ calls: [] as [string, string][] }));
vi.mock("sonner", () => {
  const record =
    (kind: string) =>
    (message: string): void => {
      toasts.calls.push([kind, message]);
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

afterEach(() => {
  cleanup();
  toasts.calls.length = 0;
});

const CREATE: SheetTarget = { mode: "create" };

function renderSheet(target: SheetTarget) {
  return renderWithProviders(
    <SourceSheet
      excluded={EXCLUDED_SOURCES}
      loading={false}
      manifests={ADAPTER_MANIFESTS}
      onClose={() => undefined}
      target={target}
    />
  );
}

async function pickAdapter(id: string) {
  const radio = document.querySelector<HTMLElement>(
    `[data-adapter='${id}'] [role='radio']`
  );
  await act(async () => {
    radio?.click();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(radio?.getAttribute("aria-checked")).toBe("true");
  });
}

function input(name: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(`input[name='${name}']`);
}

async function submit() {
  await act(async () => {
    buttonByText("Add source")?.click();
    await Promise.resolve();
  });
}

describe("TW-SOURCES the /sources screens (12 §8, D-17, C-11)", () => {
  it(
    "TW-SOURCES lists LinkedIn and Indeed disabled with the reason; Workday needs the opt-in tick before it saves",
    async () => {
      const api = fakeApi({
        "POST /api/v1/sources": (request) => ({
          source: makeSource({
            adapter: "workday",
            ...(request.body as object),
          }),
        }),
      });
      renderSheet(CREATE);
      for (const entry of EXCLUDED_SOURCES) {
        const row = document.querySelector(`[data-adapter='${entry.id}']`);
        expect(row?.getAttribute("aria-disabled")).toBe("true");
        expect(
          row?.querySelector("[role='radio']")?.hasAttribute("disabled")
        ).toBe(true);
        expect(row?.textContent).toContain(`Not supported — ${entry.reason}`);
      }

      await pickAdapter("workday");
      expect(document.body.textContent).toContain(
        "This source needs your opt-in"
      );
      await typeInto(input("tenant"), "nvidia");
      await typeInto(input("wd_host_number"), "5");
      await typeInto(input("site"), "External");
      await submit();
      expect(document.body.textContent).toContain(
        "Tick the box to use this source."
      );
      expect(api.calls("POST /api/v1/sources")).toHaveLength(0);

      await act(async () => {
        document.querySelector<HTMLElement>("[role='checkbox']")?.click();
        await Promise.resolve();
      });
      await submit();
      await waitFor(() => {
        expect(api.calls("POST /api/v1/sources")).toHaveLength(1);
      });
      expect(api.calls("POST /api/v1/sources")[0]?.body).toEqual({
        adapter: "workday",
        label: "nvidia.wd5 / External (Workday)",
        config: { tenant: "nvidia", wd_host_number: 5, site: "External" },
        enabled: true,
      });
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-SOURCES the generated form shows required and pattern errors and never posts an invalid config",
    async () => {
      const api = fakeApi({});
      renderSheet(CREATE);
      await pickAdapter("greenhouse");
      await submit();
      expect(document.body.textContent).toContain("Required.");
      await typeInto(input("board_token"), "acme/../x");
      expect(document.body.textContent).toContain(
        "Use letters, numbers, dots, dashes or underscores."
      );
      await submit();
      expect(api.calls("POST /api/v1/sources")).toHaveLength(0);
      expect(input("board_token")?.getAttribute("aria-invalid")).toBe("true");
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-SOURCES Test shows the dry-run CLI command for a saved source and runs nothing",
    () => {
      const source = makeSource({
        adapter: "lever",
        config: { site: "globex" },
      });
      const api = fakeApi({});
      renderSheet({ mode: "edit", source });
      expect(document.body.textContent).toContain(testCommand(source.id));
      expect(document.body.textContent).toContain(
        `pilih-jobs discover --source ${source.id} --dry-run`
      );
      expect(input("site")?.value).toBe("globex");
      expect(api.requests).toHaveLength(0);
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-SOURCES the enabled switch PATCHes with base_revision and Run now POSTs a discover task for the chosen device",
    async () => {
      const source = makeSource({ label: "Acme on Greenhouse", revision: 4 });
      const device: DeviceView = makeDevice({ name: "MacBook" });
      const api = fakeApi({
        "PATCH /api/v1/sources/{src_id}": (request) => ({
          source: { ...source, ...(request.body as object), revision: 5 },
        }),
        "POST /api/v1/tasks": () => ({
          task: {
            id: "tsk_01JA0000000000000000000000",
          },
        }),
      });
      renderWithProviders(
        <SourcesTable
          devices={[device]}
          manifests={ADAPTER_MANIFESTS}
          nowMs={NOW}
          onEdit={() => undefined}
          runs={[]}
          sources={[source]}
        />
      );
      await act(async () => {
        document
          .querySelector<HTMLElement>(
            "[role='switch'][aria-label='Acme on Greenhouse enabled']"
          )
          ?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(api.calls("PATCH /api/v1/sources/{src_id}")).toHaveLength(1);
      });
      expect(api.calls("PATCH /api/v1/sources/{src_id}")[0]?.body).toEqual({
        enabled: false,
        base_revision: 4,
      });

      await pointerDown(
        document.querySelector(
          "button[aria-label='Run Acme on Greenhouse now']"
        )
      );
      await waitFor(() => {
        expect(itemByText("MacBook")).toBeDefined();
      });
      await act(async () => {
        itemByText("MacBook")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(api.calls("POST /api/v1/tasks")).toHaveLength(1);
      });
      const [call] = api.calls("POST /api/v1/tasks");
      expect(call?.body).toMatchObject({
        kind: "discover",
        payload: { source_ids: [source.id] },
        target_device_id: device.id,
        queue_without_device: false,
      });
      expect(call?.idempotency_key).toBe(
        (call?.body as { idempotency_key: string }).idempotency_key
      );
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-SOURCES bulk: select all, Disable skips the disabled one, Run now sends one discover task for the enabled ones, Delete is confirmed and reports conflicts",
    async () => {
      const first = makeSource({ label: "Acme", revision: 2 });
      const second = makeSource({ label: "Globex", revision: 3 });
      const off = makeSource({ label: "Initech", enabled: false, revision: 4 });
      const api = fakeApi({
        "PATCH /api/v1/sources/{src_id}": (request) => ({
          source: { ...first, ...(request.body as object) },
        }),
        "POST /api/v1/tasks": () => ({
          task: { id: "tsk_01JA0000000000000000000000" },
        }),
        "DELETE /api/v1/sources/{src_id}": (request) =>
          request.params?.src_id === second.id
            ? new FakeFailure(409, "revision_conflict")
            : { id: request.params?.src_id, deleted: true },
      });
      renderWithProviders(
        <SourcesTable
          devices={[makeDevice({ name: "MacBook" })]}
          manifests={ADAPTER_MANIFESTS}
          nowMs={NOW}
          onEdit={() => undefined}
          runs={[]}
          sources={[first, second, off]}
        />
      );
      await act(async () => {
        document
          .querySelector<HTMLElement>("[aria-label='Select all']")
          ?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain("3 selected");
      });
      // Clicking a row checkbox never opens anything else.
      expect(document.querySelector("[role='dialog']")).toBeNull();

      await act(async () => {
        buttonByText("Disable")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(toasts.calls).toHaveLength(1);
      });
      expect(
        api
          .calls("PATCH /api/v1/sources/{src_id}")
          .map((call) => [call.params?.src_id, call.body])
      ).toEqual([
        [first.id, { enabled: false, base_revision: 2 }],
        [second.id, { enabled: false, base_revision: 3 }],
      ]);
      expect(toasts.calls[0]?.[1]).toBe(
        "2 done · 1 skipped · 0 changed elsewhere · 0 failed"
      );

      // The selection was cleared after a success: select all again.
      await act(async () => {
        document
          .querySelector<HTMLElement>("[aria-label='Select all']")
          ?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(buttonByText("Run now")).toBeDefined();
      });
      const bulkRun = [
        ...document.querySelectorAll<HTMLButtonElement>(
          "[role='toolbar'] button"
        ),
      ].find((button) => button.textContent?.includes("Run now"));
      await pointerDown(bulkRun ?? null);
      await waitFor(() => {
        expect(itemByText("Any of my devices")).toBeDefined();
      });
      await act(async () => {
        itemByText("Any of my devices")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(api.calls("POST /api/v1/tasks")).toHaveLength(1);
      });
      expect(api.calls("POST /api/v1/tasks")[0]?.body).toMatchObject({
        kind: "discover",
        payload: { source_ids: [first.id, second.id] },
        target_device_id: null,
      });

      await act(async () => {
        document
          .querySelector<HTMLElement>("[aria-label='Select all']")
          ?.click();
        await Promise.resolve();
      });
      await act(async () => {
        buttonByText("Delete")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain("Delete 3 sources?");
      });
      expect(api.calls("DELETE /api/v1/sources/{src_id}")).toHaveLength(0);
      await act(async () => {
        buttonByText("Delete 3")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(api.calls("DELETE /api/v1/sources/{src_id}")).toHaveLength(3);
      });
      expect(api.calls("DELETE /api/v1/sources/{src_id}")[0]?.query).toEqual({
        base_revision: 2,
      });
      await waitFor(() => {
        expect(toasts.calls.at(-1)?.[1]).toBe(
          "2 done · 0 skipped · 1 changed elsewhere · 0 failed"
        );
      });
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-SOURCES the runs table shows stats and errors by class, naming the host that denied access",
    () => {
      const device = makeDevice({ name: "Desktop" });
      const run = makeRun(device.id, {
        status: "partial",
        stats: {
          postings_found: 41,
          new: 9,
          updated: 2,
          duplicates: 1,
          invalid: 1,
          errors_by_class: { access_denied: 1, rate_limited: 2 },
        },
        errors: [
          {
            error_class: "access_denied",
            url: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/x/jobs",
            http_status: 403,
          },
        ],
      });
      fakeApi({});
      const { container } = renderWithProviders(
        <RunsTable
          byId={new Map([[device.id, device]])}
          nowMs={NOW}
          runs={[run]}
        />
      );
      const row = container.querySelector(`tr[data-run='${run.id}']`);
      expect(row?.textContent).toContain("Desktop");
      expect(row?.textContent).toContain("Partial");
      expect(row?.textContent).toContain("41");
      expect(
        row?.querySelector("[data-error-class='access_denied']")?.textContent
      ).toBe("Access denied by nvidia.wd5.myworkdayjobs.com · 1");
      expect(
        row?.querySelector("[data-error-class='rate_limited']")?.textContent
      ).toBe("Rate limited · 2");
    },
    DOM_TEST_TIMEOUT
  );
});
