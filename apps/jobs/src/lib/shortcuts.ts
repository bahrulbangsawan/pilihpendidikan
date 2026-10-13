// Every keyboard shortcut of the app (12 §2.2, 06 §10) in one table: the `?`
// sheet renders it, the screens register the same keys, and the TW-SHORTCUTS
// test checks that each hint has a handler.
//
// Keys on a focused board card are handled by the card itself (they win over
// the global keys: `R` on a card rejects it, elsewhere it opens Runs).

export type ShortcutScope =
  | "global"
  | "board"
  | "card"
  | "application"
  | "profile"
  | "inbox"
  | "job"
  | "approvals"
  | "monitor"
  | "cli";

export interface ShortcutDef {
  /** i18n key under `shortcuts.` */
  action: string;
  /** What the user presses, as shown in <Kbd>. */
  keys: readonly string[];
  scope: ShortcutScope;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { scope: "global", keys: ["⌘", "K"], action: "palette" },
  { scope: "global", keys: ["B"], action: "board" },
  { scope: "global", keys: ["I"], action: "inbox" },
  { scope: "global", keys: ["A"], action: "approvals" },
  { scope: "global", keys: ["R"], action: "runs" },
  { scope: "global", keys: ["N"], action: "newJob" },
  { scope: "global", keys: ["?"], action: "sheet" },
  { scope: "global", keys: ["Esc"], action: "close" },
  { scope: "board", keys: ["/"], action: "search" },
  { scope: "board", keys: ["J"], action: "nextCard" },
  { scope: "board", keys: ["K"], action: "previousCard" },
  { scope: "card", keys: ["←", "→"], action: "columns" },
  { scope: "card", keys: ["↑", "↓"], action: "cards" },
  { scope: "card", keys: ["Enter"], action: "open" },
  { scope: "card", keys: ["Space"], action: "pickUp" },
  { scope: "card", keys: ["M"], action: "move" },
  { scope: "card", keys: ["1", "–", "7"], action: "moveToStage" },
  { scope: "card", keys: ["R"], action: "reject" },
  { scope: "card", keys: ["W"], action: "withdraw" },
  { scope: "card", keys: ["E"], action: "archive" },
  { scope: "card", keys: ["X"], action: "select" },
  { scope: "card", keys: ["F"], action: "followUp" },
  { scope: "application", keys: ["M"], action: "move" },
  { scope: "application", keys: ["Y"], action: "nextStep" },
  { scope: "profile", keys: ["S"], action: "saveFacts" },
  { scope: "inbox", keys: ["/"], action: "filter" },
  { scope: "inbox", keys: ["J"], action: "nextRow" },
  { scope: "inbox", keys: ["K"], action: "previousRow" },
  { scope: "inbox", keys: ["Enter"], action: "openRow" },
  { scope: "inbox", keys: ["X"], action: "selectRow" },
  { scope: "inbox", keys: ["S"], action: "track" },
  { scope: "inbox", keys: ["D"], action: "dismiss" },
  { scope: "job", keys: ["S"], action: "trackJob" },
  { scope: "approvals", keys: ["J"], action: "nextApproval" },
  { scope: "approvals", keys: ["K"], action: "previousApproval" },
  { scope: "approvals", keys: ["Y"], action: "approve" },
  { scope: "approvals", keys: ["X"], action: "rejectApproval" },
  { scope: "monitor", keys: ["Y"], action: "resumeOrConfirm" },
  { scope: "cli", keys: ["C"], action: "copyInstall" },
];

/** Keys a focused board card handles itself (06 §10, 12 §2.2). */
export const CARD_KEYS = {
  move: "m",
  archive: "e",
  select: "x",
  followUp: "f",
  withdraw: "w",
  reject: "r",
  open: "Enter",
} as const;

/** `1`–`7` move the focused card to Saved…Accepted (06 §10). */
export const STAGE_DIGITS = ["1", "2", "3", "4", "5", "6", "7"] as const;

/** Global single-key navigation (12 §2.2). */
export const NAV_SHORTCUTS = {
  b: "/board",
  i: "/inbox",
  a: "/automation",
  r: "/automation/runs",
} as const;

const BOARD_ORDER = [
  "saved",
  "preparing",
  "ready",
  "applied",
  "interviewing",
  "offer",
  "accepted",
] as const;

export type CardKeyAction =
  | { kind: "open" }
  | { kind: "focus"; direction: "up" | "down" | "left" | "right" }
  | { kind: "move" }
  | { kind: "archive" }
  | { kind: "select" }
  | { kind: "followUp" }
  | {
      kind: "stage";
      stage: (typeof BOARD_ORDER)[number] | "rejected" | "withdrawn";
    };

const ARROWS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * What a key pressed on a focused board card does (06 §10, 12 §2.2), or null
 * to let it through (to dnd-kit's Space, to the global shortcuts, to the
 * browser). Modified keys are never card shortcuts.
 */
export function cardKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >
): CardKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }
  const arrow = ARROWS[event.key];
  if (arrow) {
    return { kind: "focus", direction: arrow };
  }
  if (event.key === CARD_KEYS.open) {
    return { kind: "open" };
  }
  if (event.shiftKey || event.key.length !== 1) {
    return null;
  }
  const digit = STAGE_DIGITS.indexOf(
    event.key as (typeof STAGE_DIGITS)[number]
  );
  if (digit !== -1) {
    return { kind: "stage", stage: BOARD_ORDER[digit] ?? "saved" };
  }
  switch (event.key.toLowerCase()) {
    case CARD_KEYS.move:
      return { kind: "move" };
    case CARD_KEYS.archive:
      return { kind: "archive" };
    case CARD_KEYS.select:
      return { kind: "select" };
    case CARD_KEYS.followUp:
      return { kind: "followUp" };
    case CARD_KEYS.reject:
      return { kind: "stage", stage: "rejected" };
    case CARD_KEYS.withdraw:
      return { kind: "stage", stage: "withdrawn" };
    default:
      return null;
  }
}
