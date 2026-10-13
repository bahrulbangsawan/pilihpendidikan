"""Local policy (16 §2): domain allowlists, credential / sensitivity / payment lexicons.

Pure functions only (no browser, no network) so the browser executor, the agent and the
tests share one definition of "allowed domain", "credential field" and "protected
question" (18 §4.3, §7.4; 19 §6.2, §7; 03 §9).
"""
