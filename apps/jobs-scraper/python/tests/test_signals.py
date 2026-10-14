"""Deterministic suspicious-posting signals (24 §4.3): scams, not industries."""

from __future__ import annotations

import pytest

from pilih_scraper.signals import suspicious_reasons


@pytest.mark.parametrize(
    "text",
    [
        "Tether is the company behind USDT, the largest stablecoin. Build payment rails.",
        "Tremendous sends gift cards and payouts to millions of recipients.",
        "We pay salaries in USD or in crypto, your choice. Bitcoin experience is a plus.",
        "Head of Security at a payments company; experience with wire transfers systems.",
    ],
)
def test_T24_SIG_01_employers_in_payments_or_crypto_are_not_flagged(text: str) -> None:
    assert "payment_request" not in suspicious_reasons(text)


@pytest.mark.parametrize(
    "text",
    [
        "Before you start, buy gift cards for the office supplies and send the codes.",
        "Please send 50 USDT to activate your account.",
        "Transfer the starter amount via Western Union to our agent.",
        "We will mail you a check; deposit the check and wire the money to the vendor.",
        "Kirim bitcoin untuk aktivasi akun.",
    ],
)
def test_T24_SIG_02_requests_for_the_candidates_money_are_flagged(text: str) -> None:
    assert "payment_request" in suspicious_reasons(text)
