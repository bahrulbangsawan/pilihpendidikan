"""Timings and limits of the local worker and the lease protocol (16 §7, 21 §1.1, §5.4, §6)."""

from __future__ import annotations

from typing import Final

#: Server lease length (21 §5.4); the CLI never evaluates expiry itself, it only fences.
LEASE_MS: Final = 120_000
#: Heartbeat cadence unless the server sends `heartbeat_interval_ms` (21 §5.2).
HEARTBEAT_INTERVAL_MS: Final = 30_000
#: After a failed heartbeat the next one is attempted sooner, to regain the lease quickly.
HEARTBEAT_RETRY_MS: Final = 10_000
#: Local fencing deadlines on the monotonic clock (21 §5.3): pause, then treat as lost.
LOCAL_PAUSE_MS: Final = 90_000
LOCAL_LOST_MS: Final = 110_000
#: How often the watchdog compares the monotonic clock with the deadlines.
WATCHDOG_INTERVAL_S: Final = 1.0
#: After `lost` is set the executor gets this long to return on its own, then it is cancelled.
LOST_GRACE_S: Final = 1.0

#: Step events: at most 50 per request, flushed at least every 5 s (21 §6.1, 20 §5.4).
EVENTS_BATCH_MAX: Final = 50
EVENTS_FLUSH_S: Final = 5.0

#: Device heartbeat (16 §7) and the sync loop (flush every 10 s or on enqueue, pull every 60 s).
DEVICE_HEARTBEAT_S: Final = 60.0
SYNC_FLUSH_S: Final = 10.0
SYNC_PULL_S: Final = 60.0

#: Adaptive poll interval (21 §1.1).
POLL_ACTIVE_MS: Final = 5_000
POLL_IDLE_MS: Final = 30_000
POLL_DORMANT_MS: Final = 60_000
POLL_MIN_MS: Final = 2_000
POLL_JITTER: Final = 0.2
RECENT_TASK_MS: Final = 5 * 60_000
DORMANT_AFTER_MS: Final = 3_600_000

#: Backpressure (16 §7): no claim above this outbox depth or after this many failed syncs.
BACKPRESSURE_OUTBOX_DEPTH: Final = 500
BACKPRESSURE_SYNC_FAILURES: Final = 3

#: Approvals (21 §6.3, §6.4).
APPROVAL_POLL_S: Final = 5.0
APPROVAL_RELEASE_AFTER_MS: Final = 30 * 60_000

#: Signals (16 §6): SIGTERM hard deadline; post-intent verification window.
SIGTERM_DEADLINE_S: Final = 30.0
POST_INTENT_VERIFY_S: Final = 60.0

#: A targeted claim (interactive `apply`) gives back foreign tasks at most this often.
TARGETED_CLAIM_ATTEMPTS: Final = 5
#: Interactive `apply` creates its task with the highest priority so the claim returns it first.
INTERACTIVE_TASK_PRIORITY: Final = 10

#: Pause reasons that need a human at the browser (21 §6.2, 18 §8).
HUMAN_PAUSE_REASONS: Final = frozenset(
    {
        "captcha_or_challenge",
        "login_required",
        "account_creation_required",
        "mfa_required",
        "credential_field",
        "missing_information",
        "protected_question",
        "unknown_question",
        "unsupported_form",
        "unclear_page",
        "needs_headed_restart",
        "payment_requested",
        "low_confidence",
    }
)

#: Local task states that still hold (or may hold) a lease before `submit_intent`.
PRE_INTENT_STATES: Final = ("claimed", "running", "paused", "awaiting_approval")
#: Local states that are finished from the worker's point of view.
CLOSED_STATES: Final = ("done", "orphaned")
