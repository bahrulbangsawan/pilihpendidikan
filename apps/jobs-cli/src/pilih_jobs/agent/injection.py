"""Suspicious-instruction heuristics (11 T-01 defence 7, 19 §4.2, §7).

Regex heuristics run on every observation next to the `injection_suspected` predicate of
the page classification. A hit never changes what the agent *may* do (the action space is
closed either way); it changes the policy: `auto` stops with `injection_suspected`, and
assisted/approval show "This page contains text aimed at AI agents" in the approval.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Final

from pilih_jobs.browser.observer import Observation

_PATTERNS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    (
        "ignore_instructions",
        re.compile(
            r"\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|all|earlier|"
            r"your)\b.{0,20}\b(instructions?|prompts?|rules?|directions?)\b",
            re.I,
        ),
    ),
    (
        "addresses_ai",
        re.compile(
            r"\b(dear|hey|hi|attention|note to( the)?|instructions? (for|to)( the)?)\s+"
            r"(ai|llm|assistant|bot|agent|language model|automated agent)s?\b|"
            r"\b(ai|a\.i\.|llm|language model|chatgpt|assistant|bot|automated agent|ai agent|"
            r"autonomous agent)s?\s*[:,]\s*(please\s+)?(you must|must|should|now|click|type|"
            r"enter|select|upload|navigate|go to|reveal|ignore|answer|fill|press|submit|"
            r"withdraw)\b|"
            r"\bif you are an? (ai|llm|language model|assistant|bot|automated|agent)\b",
            re.I,
        ),
    ),
    (
        "role_play",
        re.compile(
            r"\b(you are (now )?(an? )?(ai|assistant|bot|agent)|as an ai|system prompt|"
            r"developer mode|jailbreak|new instructions?)\b",
            re.I,
        ),
    ),
    (
        "fake_system",
        re.compile(
            r"^\s*(system|assistant|developer)\s*(message|prompt)?\s*:\s*\S|<\|im_start\|>|"
            r"\[/?inst\]|###\s*instruction",
            re.I | re.M,
        ),
    ),
    (
        "credential_bait",
        re.compile(
            r"\b(type|enter|provide|reveal|paste)\b.{0,30}\b(password|passcode|ssn|"
            r"social security|credit card|api key|secret|private key|token)\b",
            re.I,
        ),
    ),
    (
        "file_bait",
        re.compile(
            r"(~|/home/|/users/|c:\\\\|%userprofile%).{0,40}(\.ssh|id_rsa|\.env|passwd|keychain)",
            re.I,
        ),
    ),
    (
        "destructive",
        re.compile(
            r"\b(click|press|select)\b.{0,30}"
            r"\b(withdraw|delete (my )?(account|application)|unsubscribe)\b",
            re.I,
        ),
    ),
    (
        "exfiltrate",
        re.compile(
            r"\b(navigate|go|redirect|send|post|upload)\b.{0,30}\b(to|at)\b.{0,10}(https?://|www\.)",
            re.I,
        ),
    ),
)


def injection_hits(texts: Iterable[str]) -> list[str]:
    """Names of the heuristics that fired on any of `texts`."""
    hits: list[str] = []
    for text in texts:
        if not text:
            continue
        for name, pattern in _PATTERNS:
            if name not in hits and pattern.search(text):
                hits.append(name)
    return hits


def observation_texts(obs: Observation) -> list[str]:
    texts = [obs.raw_text, obs.title, obs.aria_snapshot]
    for f in obs.fields:
        texts.extend([f.label, f.description, f.section or ""])
        texts.extend(str(o.get("label") or "") for o in f.options)
    texts.extend(c.text for c in obs.controls)
    texts.extend(str(e.get("text") or "") for e in obs.errors)
    return texts


def observation_injection(obs: Observation) -> list[str]:
    return injection_hits(observation_texts(obs))
