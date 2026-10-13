// A tiny DOM harness for component tests (happy-dom + React's act), the
// pattern of packages/ui's use-shortcut test. No testing-library needed.

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { getT, I18nProvider } from "@/i18n";

declare global {
  // React's flag for tests that drive updates with act().
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

export interface Rendered {
  container: HTMLDivElement;
  unmount: () => void;
}

export function render(node: ReactNode, locale: "en" | "id" = "en"): Rendered {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider value={{ locale, t: getT(locale) }}>{node}</I18nProvider>
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

export async function click(
  element: Element | null | undefined
): Promise<void> {
  if (!element) {
    throw new Error("Nothing to click.");
  }
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
}

export function byText(
  container: Element,
  text: string
): HTMLElement | undefined {
  return [
    ...container.querySelectorAll<HTMLElement>("button, a, p, span, h2"),
  ].find((element) => element.textContent?.trim() === text);
}
