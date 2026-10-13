// DOM test helpers for the CLI & devices and Sources screens: a fake BFF
// transport keyed by contract route, React Query + tooltip providers around
// the shared render(), and small async helpers. Used only by *.test.tsx.

import { TooltipProvider } from "@rulisme/ui/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest, BffResult, JsonValue } from "@/lib/bff";
import type { Rendered } from "@/test/render";
import { render } from "@/test/render";

/** A failure answer from a fake route. */
export class FakeFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  constructor(status: number, code: string, message = code) {
    this.status = status;
    this.code = code;
    this.message = message;
  }
}

export type FakeRoute = (request: BffRequest) => unknown;

export interface FakeApi {
  /** Requests for `route`, in order. */
  calls: (route: string) => BffRequest[];
  requests: BffRequest[];
}

/** Installs a transport answering `routes` (404 for anything else). */
export function fakeApi(routes: Partial<Record<string, FakeRoute>>): FakeApi {
  const requests: BffRequest[] = [];
  setBffTransport((request): Promise<BffResult> => {
    requests.push(request);
    const handler = routes[request.route];
    if (!handler) {
      return Promise.resolve({
        ok: false,
        status: 404,
        error: { error: "not_found", message: `no fake for ${request.route}` },
      });
    }
    const answer = handler(request);
    if (answer instanceof FakeFailure) {
      return Promise.resolve({
        ok: false,
        status: answer.status,
        error: { error: answer.code, message: answer.message },
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      data: (answer ?? null) as JsonValue,
      etag: null,
      notModified: false,
      replayed: false,
    });
  });
  return {
    requests,
    calls: (route) => requests.filter((request) => request.route === route),
  };
}

const mounted: Rendered[] = [];

export function renderWithProviders(node: ReactNode): Rendered & {
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>
  );
  mounted.push(rendered);
  return { ...rendered, queryClient };
}

/** Lets pending promises and React updates settle. */
export async function settle(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Polls `check` until it stops throwing (or fails after `timeoutMs`). */
export async function waitFor(
  check: () => void,
  timeoutMs = 2000
): Promise<void> {
  const started = Date.now();
  let last: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      check();
      return;
    } catch (error) {
      last = error;
    }
    await settle(1);
  }
  throw last instanceof Error ? last : new Error("waitFor timed out");
}

/** A single key pressed with nothing focused (the global shortcuts). */
export async function pressKey(key: string): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true })
    );
    await Promise.resolve();
  });
}

/** Opens a Radix trigger (menus and tabs react to pointer / mouse down). */
export async function pointerDown(element: Element | null): Promise<void> {
  if (!element) {
    throw new Error("Nothing to press.");
  }
  await act(async () => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 })
    );
    element.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 })
    );
    await Promise.resolve();
  });
}

export function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim().includes(text)
  );
}

export function itemByText(text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
    (item) => item.textContent?.trim().includes(text)
  );
}

/** Types into a React-controlled input (the native setter + an input event). */
export async function typeInto(
  input: HTMLInputElement | null | undefined,
  value: string
): Promise<void> {
  if (!input) {
    throw new Error("No input.");
  }
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

export function cleanup(): void {
  for (const rendered of mounted.splice(0)) {
    rendered.unmount();
  }
  setBffTransport(null);
  document.body.replaceChildren();
}
