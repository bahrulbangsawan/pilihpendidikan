// Test-only harness for the automation screens: a memory router (they use
// <Link>), a fresh QueryClient and a fake BFF transport answering by route
// key. Imported by the *.test.tsx files next to it; never by app code.

import type { BoardResponse } from "@pilihpendidikan/jobs-contracts/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { act } from "react";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest, BffResult, JsonValue } from "@/lib/bff";
import { makeBoard } from "@/test/fixtures";
import { render } from "@/test/render";

export type Answer =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string; details?: unknown };

export type Handler = (request: BffRequest) => Answer | undefined;

const EMPTY_PAGE = { items: [], next_cursor: null };

/** Installs a transport that answers with `handler`, then sane defaults. */
export function fakeApi(handler: Handler, board?: BoardResponse) {
  const requests: BffRequest[] = [];
  setBffTransport((request) => {
    requests.push(request);
    const answer = handler(request) ?? defaults(request, board);
    if (answer.ok) {
      const result: BffResult = {
        ok: true,
        status: 200,
        data: (answer.data ?? null) as JsonValue,
        etag: null,
        notModified: false,
        replayed: false,
      };
      return Promise.resolve(result);
    }
    return Promise.resolve({
      ok: false,
      status: answer.status,
      error: {
        error: answer.error,
        message: answer.error,
        ...(answer.details
          ? { details: answer.details as { [key: string]: JsonValue } }
          : {}),
      },
    });
  });
  return requests;
}

function defaults(request: BffRequest, board?: BoardResponse): Answer {
  switch (request.route) {
    case "GET /api/v1/board":
      return { ok: true, data: board ?? makeBoard([]) };
    case "GET /api/v1/devices":
    case "GET /api/v1/sources":
    case "GET /api/v1/approvals":
    case "GET /api/v1/rules":
    case "GET /api/v1/tasks":
    case "GET /api/v1/cvs":
    case "GET /api/v1/applications/{app_id}/events":
      return { ok: true, data: EMPTY_PAGE };
    default:
      return { ok: false, status: 404, error: "not_found" };
  }
}

/** Lets queries settle (microtasks and zero-delay timers), inside act. */
export async function flush(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

export async function renderScreen(
  node: ReactNode,
  locale: "en" | "id" = "en"
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screen = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{node}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screen]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(async () => {
    await router.load();
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
    locale
  );
  await flush();
  return {
    ...rendered,
    queryClient,
    unmount: () => {
      rendered.unmount();
      queryClient.clear();
    },
  };
}

/** Presses a single key the way a user would, outside any field. */
export async function press(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await Promise.resolve();
  });
  await flush(2);
}

export function buttonByText(
  root: Element,
  text: string
): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim().startsWith(text)
  );
}

/** Types into a React-controlled input. */
export async function typeInto(
  input: HTMLInputElement,
  value: string
): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}
