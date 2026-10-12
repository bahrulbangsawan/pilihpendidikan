import { cn } from "@rulisme/ui/lib/utils";
import type { ReactNode } from "react";

const DEFAULT_STATES = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
] as const;

/**
 * A labelled variant × state table. Each cell renders one component with its
 * state pinned through `previewState(state)`, so hover, focus and pressed sit
 * side by side without interaction. State names live in the header, never
 * inside the component.
 */
export function StateMatrix<Row extends string>({
  rows,
  states = DEFAULT_STATES,
  render,
  className,
}: {
  rows: readonly Row[];
  states?: readonly string[];
  render: (row: Row, state: string) => ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto border border-line", className)}>
      <table className="w-full border-separate border-spacing-x-3 border-spacing-y-3">
        <thead>
          <tr>
            <th className="w-0" />
            {states.map((state) => (
              <th
                className="type-caption text-left text-muted-foreground"
                key={state}
                scope="col"
              >
                {state}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th
                className="type-caption whitespace-nowrap pr-2 text-left text-muted-foreground"
                scope="row"
              >
                {row}
              </th>
              {states.map((state) => (
                <td key={state}>{render(row, state)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PINNED_STATES = new Set(["hover", "focus", "active"]);

/** Spread onto a component to pin a state without interaction. */
export function previewState(
  state: string
): { disabled: true } | { "data-preview": string } | Record<string, never> {
  if (state === "disabled") {
    return { disabled: true };
  }
  if (PINNED_STATES.has(state)) {
    return { "data-preview": state };
  }
  return {};
}
