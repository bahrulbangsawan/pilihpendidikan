// Polling (job-tracker-spec 12 §10, D-11: no WebSockets in v1). One policy per
// screen; `pollInterval` turns a policy, the tab's visibility and the number
// of consecutive failed polls into React Query's `refetchInterval`.

export interface PollPolicy {
  /** Interval while the tab is hidden; false pauses polling. */
  hidden: number | false;
  /** Interval while the tab is visible. */
  visible: number;
}

/** 12 §10, one row per screen. */
export const POLL_POLICIES = {
  board: { visible: 15_000, hidden: false },
  application: { visible: 15_000, hidden: false },
  /** A task for this application is claimed / running / awaiting approval. */
  applicationLive: { visible: 2000, hidden: 10_000 },
  runMonitor: { visible: 2000, hidden: 10_000 },
  approvals: { visible: 10_000, hidden: 60_000 },
  /** Only while a discovery run is active on some device. */
  inboxActive: { visible: 30_000, hidden: false },
  devices: { visible: 10_000, hidden: false },
  /** /cli while waiting for a new device to connect (22 §12 step 4). */
  devicesConnecting: { visible: 3000, hidden: false },
  /** Automation → Runs and the discovery runs table. */
  runs: { visible: 15_000, hidden: false },
  /** The shell's own light refresh of sidebar counts off the board screen. */
  shell: { visible: 60_000, hidden: false },
} as const satisfies Record<string, PollPolicy>;

export type PollPolicyName = keyof typeof POLL_POLICIES;

/** Errors back off 2× per consecutive failure, up to this cap (12 §10). */
export const MAX_BACKOFF_MS = 60_000;
/** After this many failed polls the screen says it is showing old data. */
export const STALE_AFTER_FAILURES = 3;

export interface PollState {
  /** Consecutive failed polls (0 after a success). */
  failures: number;
  /** `document.visibilityState === "hidden"`. */
  hidden: boolean;
}

/**
 * The next poll delay in ms, or false to pause. Visible tabs use the visible
 * interval, hidden tabs the hidden one (often false); each consecutive
 * failure doubles the delay up to 60 s.
 */
export function pollInterval(
  policy: PollPolicy,
  state: PollState
): number | false {
  const base = state.hidden ? policy.hidden : policy.visible;
  if (base === false) {
    return false;
  }
  const failures = Math.max(0, Math.floor(state.failures));
  if (failures === 0) {
    return base;
  }
  return Math.min(MAX_BACKOFF_MS, base * 2 ** failures);
}

/** True once polling has failed often enough to call the data stale. */
export function isStale(failures: number): boolean {
  return failures >= STALE_AFTER_FAILURES;
}

/** Task states during which the application detail polls every 2 s. */
export const LIVE_POLL_TASK_STATES = [
  "claimed",
  "running",
  "awaiting_approval",
] as const;

export function isLivePollState(state: string): boolean {
  return (LIVE_POLL_TASK_STATES as readonly string[]).includes(state);
}
