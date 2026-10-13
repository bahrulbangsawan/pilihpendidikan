"""The local worker and the task / lease protocol client (16 §7, 21; leaf 4.4).

- `lease` — `ApiLeaseChannel` (the `LeaseChannel` of PLAN C6): heartbeats, fencing (90 s
  pause / 110 s lost on a monotonic clock, 409 `lease_lost`, 401 revoked), batched events
  through the outbox, approvals, the synchronous `submit_intent`, AI proxy, files;
- `runner` — `TaskRunner`: one task under its lease, signals, results, releases;
- `apply` — `ApplyOrchestrator`: task targeted at this device → claim → run (`apply`);
- `worker` — `Worker`: heartbeat / poll / sync / runner / scheduler loops on one event loop;
- `poll`, `syncloop`, `device`, `scheduler`, `recovery`, `hooks` — the loops' building blocks;
- `locks`, `ipc`, `signals`, `service` — one worker per device, local IPC, SIGINT / SIGTERM,
  launchd / systemd --user / Task Scheduler service files;
- `local` — `local_tasks` and the `runs` index in `state.db`.

Submodules are imported directly (`from pilih_jobs.tasks.worker import Worker`); this
package imports nothing at load time so `--help` stays fast.
"""
