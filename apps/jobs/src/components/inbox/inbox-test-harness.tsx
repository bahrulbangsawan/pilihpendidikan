// Test harness for the inbox screens: a fake BFF transport that answers by
// contract route, a fresh QueryClient, the tooltip provider, and a polling
// waitFor. Imported by the *.test.tsx files only.

import { TooltipProvider } from "@rulisme/ui/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest, BffResult, JsonValue } from "@/lib/bff";
import type { Rendered } from "@/test/render";
import { render } from "@/test/render";

export type RouteHandler = (request: BffRequest) => unknown;

/** Installs a transport answering each route key; records every request. */
export function fakeApi(handlers: Partial<Record<string, RouteHandler>>) {
  const requests: BffRequest[] = [];
  setBffTransport((request) => {
    requests.push(request);
    const handler = handlers[request.route];
    if (!handler) {
      const missing: BffResult = {
        ok: false,
        status: 404,
        error: { error: "not_found", message: `No fake for ${request.route}` },
      };
      return Promise.resolve(missing);
    }
    const ok: BffResult = {
      ok: true,
      status: 200,
      data: handler(request) as JsonValue,
      etag: null,
      notModified: false,
      replayed: false,
    };
    return Promise.resolve(ok);
  });
  return requests;
}

const mounted = new Set<Rendered>();

export function renderWithQuery(node: ReactNode): Rendered {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>
  );
  const tracked: Rendered = {
    container: rendered.container,
    unmount: () => {
      if (mounted.delete(tracked)) {
        rendered.unmount();
      }
    },
  };
  mounted.add(tracked);
  return tracked;
}

/** Unmounts everything rendered (window key listeners included). */
export function cleanup(): void {
  for (const rendered of [...mounted]) {
    rendered.unmount();
  }
  setBffTransport(null);
  document.body.replaceChildren();
}

/** Lets React Query and effects settle until `check` passes (or throws). */
export async function waitFor<T>(
  check: () => T | null | undefined | false,
  attempts = 40
): Promise<T> {
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = check();
      if (value) {
        return value;
      }
    } catch (error) {
      last = error;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw last instanceof Error ? last : new Error("waitFor timed out");
}

export async function press(key: string): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    );
    await Promise.resolve();
  });
}
