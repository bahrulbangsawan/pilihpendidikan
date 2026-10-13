// Shell actions any screen may trigger (the empty board's New button, the
// command palette's "Shortcut sheet" …) without prop drilling.

import { createContext, use } from "react";

export interface ShellActions {
  openNewJob: () => void;
  openPalette: () => void;
  openShortcuts: () => void;
}

const noop = () => undefined;

const ShellContext = createContext<ShellActions>({
  openNewJob: noop,
  openPalette: noop,
  openShortcuts: noop,
});

export const ShellActionsProvider = ShellContext.Provider;

export function useShellActions(): ShellActions {
  return use(ShellContext);
}
