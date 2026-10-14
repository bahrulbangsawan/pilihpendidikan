// @vitest-environment happy-dom
import type { CloudSourceListResponse } from "@pilihpendidikan/jobs-contracts/api";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeRoute } from "@/components/cli/test-harness";
import {
  buttonByText,
  cleanup,
  FakeFailure,
  fakeApi,
  renderWithProviders,
  waitFor,
} from "@/components/cli/test-harness";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest, BffResult, JsonValue } from "@/lib/bff";
import { NOW } from "@/test/fixtures";
import {
  makeCloudList,
  makeCloudRun,
  makeCloudSource,
} from "@/test/fixtures-cloud";
import { CloudRunItem } from "./cloud-runs-list";
import { CloudSourcesSection } from "./cloud-sources-section";

// happy-dom with Radix portals is slow on a loaded machine.
const DOM_TEST_TIMEOUT = 20_000;

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

function routes(
  list: CloudSourceListResponse,
  extra: Partial<Record<string, FakeRoute>> = {}
): Partial<Record<string, FakeRoute>> {
  return {
    "GET /api/v1/cloud-sources": () => list,
    "GET /api/v1/cloud-sources/{csr_id}": (request) => {
      const source =
        list.items.find((item) => item.id === request.params?.csr_id) ??
        list.items[0];
      return { source, runs: [makeCloudRun(source?.id ?? null)] };
    },
    ...extra,
  };
}

function row(name: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>("[data-cloud-source]")].find(
      (element) => element.textContent?.includes(name)
    ) ?? null
  );
}

function followSwitch(name: string): HTMLElement | null {
  return row(name)?.querySelector<HTMLElement>("[role='switch']") ?? null;
}

async function openSheet(name: string) {
  const open = document.querySelector<HTMLElement>(
    `button[aria-label='Open ${name}']`
  );
  await act(async () => {
    open?.click();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
  });
}

async function typeIntoTextarea(
  element: HTMLTextAreaElement | null,
  value: string
) {
  if (!element) {
    throw new Error("No textarea.");
  }
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("TW-CLOUD the remote job boards on /sources (24 §5, 05 §15)", () => {
  it(
    "TW-CLOUD-LIST lists every status with its badge and filters by status group and following",
    async () => {
      fakeApi(routes(makeCloudList()));
      renderWithProviders(<CloudSourcesSection nowMs={NOW} />);
      await waitFor(() => {
        expect(document.querySelectorAll("[data-cloud-source]").length).toBe(8);
      });
      const statuses = [
        ...document.querySelectorAll<HTMLElement>("[data-status]"),
      ].map((badge) => badge.textContent?.trim());
      expect(statuses).toEqual(
        expect.arrayContaining([
          "Active",
          "Checking now",
          "Failed",
          "Blocked",
          "Needs an account",
          "Rate limited",
          "Disabled",
          "Not a job board",
        ])
      );
      // Followed boards come first (then priority: Nomad 90 before 70).
      const order = [
        ...document.querySelectorAll<HTMLElement>("[data-cloud-source]"),
      ].map(
        (element) =>
          element
            .querySelector("[role='switch']")
            ?.getAttribute("aria-checked") ?? ""
      );
      expect(order.slice(0, 3)).toEqual(["true", "true", "false"]);
      expect(
        document.querySelector("[data-cloud-source]")?.textContent
      ).toContain("Example Nomad Jobs");

      await act(async () => {
        buttonByText("Needs attention")?.click();
        await Promise.resolve();
      });
      expect(document.querySelectorAll("[data-cloud-source]")).toHaveLength(4);
      await act(async () => {
        buttonByText("All")?.click();
        await Promise.resolve();
      });
      await act(async () => {
        buttonByText("Following")?.click();
        await Promise.resolve();
      });
      expect(document.querySelectorAll("[data-cloud-source]")).toHaveLength(2);
      expect(document.body.textContent).toContain("Checked every hour");
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-CLOUD-FOLLOW following is optimistic and rolls back when the api refuses",
    async () => {
      const list = makeCloudList();
      let release: (result: BffResult) => void = () => undefined;
      const requests: BffRequest[] = [];
      setBffTransport((request) => {
        requests.push(request);
        if (request.route === "GET /api/v1/cloud-sources") {
          return Promise.resolve({
            ok: true,
            status: 200,
            data: list as unknown as JsonValue,
            etag: null,
            notModified: false,
            replayed: false,
          });
        }
        return new Promise<BffResult>((resolve) => {
          release = resolve;
        });
      });
      renderWithProviders(<CloudSourcesSection nowMs={NOW} />);
      await waitFor(() => {
        expect(followSwitch("Example Kerja Remote")).not.toBeNull();
      });
      expect(
        followSwitch("Example Kerja Remote")?.getAttribute("aria-checked")
      ).toBe("false");
      await act(async () => {
        followSwitch("Example Kerja Remote")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(
          followSwitch("Example Kerja Remote")?.getAttribute("aria-checked")
        ).toBe("true");
      });
      expect(
        requests.some(
          (request) =>
            request.route === "PUT /api/v1/cloud-sources/{csr_id}/follow"
        )
      ).toBe(true);
      await act(async () => {
        release({
          ok: false,
          status: 503,
          error: { error: "upstream_unavailable", message: "down" },
        });
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(
          followSwitch("Example Kerja Remote")?.getAttribute("aria-checked")
        ).toBe("false");
      });
      expect(toasts.calls).toContainEqual([
        "error",
        "Couldn't change following Example Kerja Remote. Try again.",
      ]);
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-CLOUD-FOLLOW a successful follow says how many recent jobs reached the inbox",
    async () => {
      const list = makeCloudList();
      const target = list.items.find(
        (source) => source.name === "Example Kerja Remote"
      );
      const api = fakeApi(
        routes(list, {
          "PUT /api/v1/cloud-sources/{csr_id}/follow": () => ({
            source: { ...target, following: true },
            backfilled: 12,
          }),
        })
      );
      renderWithProviders(<CloudSourcesSection nowMs={NOW} />);
      await waitFor(() => {
        expect(followSwitch("Example Kerja Remote")).not.toBeNull();
      });
      await act(async () => {
        followSwitch("Example Kerja Remote")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(toasts.calls).toContainEqual([
          "success",
          "Following Example Kerja Remote: added 12 recent jobs to your inbox.",
        ]);
      });
      const put = api.calls("PUT /api/v1/cloud-sources/{csr_id}/follow")[0];
      expect(put?.params).toEqual({ csr_id: target?.id });
      expect(put?.idempotency_key).toBeTruthy();
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-CLOUD-OPERATOR operator controls are hidden from everyone else",
    async () => {
      fakeApi(routes(makeCloudList({ viewer: { operator: false } })));
      renderWithProviders(<CloudSourcesSection nowMs={NOW} />);
      await waitFor(() => {
        expect(row("Example Kerja Remote")).not.toBeNull();
      });
      expect(buttonByText("Refresh directory")).toBeUndefined();
      expect(buttonByText("Add board")).toBeUndefined();
      await openSheet("Example Kerja Remote");
      await waitFor(() => {
        expect(document.body.textContent).toContain("Recent runs");
      });
      expect(document.body.textContent).not.toContain("Operator settings");
      expect(document.body.textContent).toContain(
        "The page layout or data format changed"
      );
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-CLOUD-OPERATOR the strategy config editor validates JSON against the strategy before Save",
    async () => {
      fakeApi(routes(makeCloudList({ viewer: { operator: true } })));
      renderWithProviders(<CloudSourcesSection nowMs={NOW} />);
      await waitFor(() => {
        expect(buttonByText("Refresh directory")).toBeDefined();
      });
      await openSheet("Example Remote Board");
      await waitFor(() => {
        expect(document.body.textContent).toContain("Operator settings");
      });
      const config = document.querySelector<HTMLTextAreaElement>(
        "textarea[name='strategy_config']"
      );
      const save = () => buttonByText("Save");
      expect(document.body.textContent).toContain("Valid for this strategy.");
      expect(save()?.disabled).toBe(true);

      await typeIntoTextarea(config, '{"url": ');
      expect(document.body.textContent).toContain("This is not valid JSON.");
      expect(save()?.disabled).toBe(true);

      await typeIntoTextarea(
        config,
        JSON.stringify({ url: "https://remote-board.example/jobs.rss" })
      );
      expect(document.body.textContent).toContain(
        "The configuration does not match this strategy:"
      );
      expect(document.body.textContent).toContain("title_pattern");
      expect(save()?.disabled).toBe(true);

      await typeIntoTextarea(
        config,
        JSON.stringify({
          url: "https://remote-board.example/feed.xml",
          title_pattern: "title",
        })
      );
      expect(document.body.textContent).toContain("Valid for this strategy.");
      expect(save()?.disabled).toBe(false);
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-CLOUD-OPERATOR Retry asks first, then queues a retry run",
    async () => {
      const list = makeCloudList({ viewer: { operator: true } });
      const blocked = list.items.find((source) => source.status === "BLOCKED");
      const api = fakeApi(
        routes(list, {
          "POST /api/v1/cloud-sources/{csr_id}/runs": () => ({
            run: makeCloudRun(blocked?.id ?? null, {
              status: "queued",
              trigger: "retry",
              started_at: null,
              finished_at: null,
              duration_ms: null,
            }),
          }),
        })
      );
      renderWithProviders(<CloudSourcesSection nowMs={NOW} />);
      await waitFor(() => {
        expect(row("Example Guarded Board")).not.toBeNull();
      });
      await openSheet("Example Guarded Board");
      await waitFor(() => {
        expect(buttonByText("Retry")).toBeDefined();
      });
      await act(async () => {
        buttonByText("Retry")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(document.querySelector("[role='alertdialog']")).not.toBeNull();
      });
      expect(document.body.textContent).toContain("closes the breaker");
      expect(
        api.calls("POST /api/v1/cloud-sources/{csr_id}/runs")
      ).toHaveLength(0);
      await act(async () => {
        buttonByText("Retry now")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(
          api.calls("POST /api/v1/cloud-sources/{csr_id}/runs")
        ).toHaveLength(1);
      });
      const post = api.calls("POST /api/v1/cloud-sources/{csr_id}/runs")[0];
      expect(post?.body).toEqual({ retry: true });
      expect(post?.params).toEqual({ csr_id: blocked?.id });
      await waitFor(() => {
        expect(toasts.calls).toContainEqual([
          "success",
          "Example Guarded Board: breaker cleared and a retry queued.",
        ]);
      });
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-CLOUD-OPERATOR an operator write refused by the api says so",
    async () => {
      fakeApi(
        routes(makeCloudList({ viewer: { operator: true } }), {
          "POST /api/v1/cloud-discovery/refresh": () =>
            new FakeFailure(403, "operator_required"),
        })
      );
      renderWithProviders(<CloudSourcesSection nowMs={NOW} />);
      await waitFor(() => {
        expect(buttonByText("Refresh directory")).toBeDefined();
      });
      await act(async () => {
        buttonByText("Refresh directory")?.click();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(toasts.calls).toContainEqual([
          "error",
          "Only catalog operators can do this.",
        ]);
      });
    },
    DOM_TEST_TIMEOUT
  );

  it(
    "TW-CLOUD-LOG run logs expand and render scraped text as text",
    async () => {
      const hostile = '<img src=x onerror="window.__pwned = 1">';
      renderWithProviders(
        <ul>
          <CloudRunItem
            nowMs={NOW}
            run={makeCloudRun(makeCloudSource().id, {
              status: "failed",
              error_class: "parse_error",
              error_message: hostile,
              log: [
                {
                  at: NOW - 60_000,
                  level: "error",
                  event: "parse_error",
                  message: hostile,
                  url: "javascript:alert(1)",
                },
              ],
              warnings: [{ code: "suspicious", message: hostile, count: 1 }],
            })}
          />
        </ul>
      );
      expect(document.body.textContent).toContain("Show log (2)");
      expect(document.querySelector("[aria-label='Run log']")).toBeNull();
      await act(async () => {
        buttonByText("Show log")?.click();
        await Promise.resolve();
      });
      expect(document.querySelector("[aria-label='Run log']")).not.toBeNull();
      expect(document.querySelectorAll("img")).toHaveLength(0);
      expect(document.querySelector("a[href^='javascript']")).toBeNull();
      expect(document.body.textContent).toContain(hostile);
      expect((globalThis as { __pwned?: number }).__pwned).toBeUndefined();
    },
    DOM_TEST_TIMEOUT
  );
});
