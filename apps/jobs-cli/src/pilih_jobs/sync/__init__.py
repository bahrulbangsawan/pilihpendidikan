"""Local ↔ cloud synchronization (20).

- `outbox` — durable ordered pending writes with coalescing (20 §5);
- `backoff` — full-jitter retry delays and Retry-After (20 §5.3);
- `flusher` — sends ready entries, classifies responses, dead letters, conflicts;
- `cache` — the entity cache that keeps the highest revision (20 §4.1);
- `puller` — change feed with automatic snapshot on `410 cursor_expired` (20 §4);
- `engine` — `SyncEngine.sync()` / `status()` used by `pilih-jobs sync` and the worker.
"""
