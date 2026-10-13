"""Local storage: `state.db` (20 §3), forward-only migrations and cross-process file locks.

Nothing in `state.db` is authoritative (16 §8): it holds caches, checkpoints, pending
operations and local task bookkeeping. Tokens are never stored in it (16 §11).
"""
