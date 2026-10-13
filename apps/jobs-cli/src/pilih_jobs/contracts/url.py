"""A WHATWG URL Standard parser for the URLs the fingerprint cares about.

`packages/jobs-contracts/src/fingerprint.ts` uses the JavaScript `URL` class; the
Python port must produce byte-identical results (shared golden vectors). This module
implements the parts of https://url.spec.whatwg.org/ that the contracts rely on:

- special-scheme parsing (http, https, ws, wss, ftp) without a base URL: slash
  handling (`\\` is a separator), userinfo, ports with default-port elision;
- host parsing: IPv6 (`[…]`), percent-decoding, UTS #46 domain-to-ASCII
  (non-transitional, `CheckHyphens=false`, `UseSTD3ASCIIRules=false`), the forbidden
  domain code points and the IPv4 number forms (`0x7f.1`, `1.2.3`);
- path dot-segment resolution and percent-encoding with the path and special-query
  encode sets.

Non-special schemes keep an opaque host, which is all `asciiHost` needs.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from typing import Final

import idna

SPECIAL_PORTS: Final[dict[str, int | None]] = {
    "http": 80,
    "https": 443,
    "ws": 80,
    "wss": 443,
    "ftp": 21,
    "file": None,
}

# JavaScript String.prototype.trim(): WhiteSpace (incl. U+FEFF and Zs) + LineTerminator.
_JS_TRIM: Final = "\t\n\v\f\r                  　﻿"
_C0_OR_SPACE: Final = "".join(chr(c) for c in range(0x21))
_TAB_OR_NEWLINE = re.compile(r"[\t\n\r]")
_SCHEME = re.compile(r"^([A-Za-z][A-Za-z0-9+.\-]*):")

_FORBIDDEN_HOST: Final = frozenset("\x00\t\n\r #/:<>?@[\\]^|")
_FORBIDDEN_DOMAIN: Final = _FORBIDDEN_HOST | frozenset(chr(c) for c in range(0x20)) | {"%", "\x7f"}

# Percent-encode sets (bytes that are encoded besides C0 controls and > 0x7E).
_PATH_SET: Final = frozenset(b' "#<>?`{}')
_SPECIAL_QUERY_SET: Final = frozenset(b" \"#<>'")


def js_trim(value: str) -> str:
    return value.strip(_JS_TRIM)


def _usv(value: str) -> str:
    """USVString conversion: lone surrogates become U+FFFD (as in `new URL(...)`)."""
    if not any(0xD800 <= ord(ch) <= 0xDFFF for ch in value):
        return value
    return "".join("�" if 0xD800 <= ord(ch) <= 0xDFFF else ch for ch in value)


def _percent_encode(text: str, extra: frozenset[int]) -> str:
    out: list[str] = []
    for ch in text:
        code = ord(ch)
        if code < 0x80 and code > 0x1F and code != 0x7F and code not in extra:
            out.append(ch)
            continue
        out.extend(f"%{byte:02X}" for byte in ch.encode("utf-8"))
    return "".join(out)


def _percent_decode_bytes(text: str) -> bytes:
    raw = text.encode("utf-8")
    out = bytearray()
    i = 0
    hexdigits = b"0123456789abcdefABCDEF"
    while i < len(raw):
        byte = raw[i]
        if (
            byte == 0x25
            and i + 2 < len(raw)
            and raw[i + 1] in hexdigits
            and raw[i + 2] in hexdigits
        ):
            out.append(int(raw[i + 1 : i + 3], 16))
            i += 3
            continue
        out.append(byte)
        i += 1
    return bytes(out)


class HostError(ValueError):
    """The host is not valid per the URL Standard (the URL constructor would throw)."""


# ------------------------------------------------------------------- IPv4
def _parse_ipv4_number(part: str) -> int | None:
    if part == "":
        return None
    radix = 10
    if len(part) >= 2 and part[:2] in ("0x", "0X"):
        part, radix = part[2:], 16
    elif len(part) >= 2 and part[0] == "0":
        part, radix = part[1:], 8
    if part == "":
        return 0
    digits = {8: "01234567", 10: "0123456789", 16: "0123456789abcdefABCDEF"}[radix]
    if any(ch not in digits for ch in part):
        return None
    return int(part, radix)


def _ends_in_number(domain: str) -> bool:
    parts = domain.split(".")
    if parts[-1] == "":
        if len(parts) == 1:
            return False
        parts.pop()
    last = parts[-1]
    if last != "" and all(ch in "0123456789" for ch in last):
        return True
    return _parse_ipv4_number(last) is not None


def _parse_ipv4(domain: str) -> str:
    parts = domain.split(".")
    if parts[-1] == "" and len(parts) > 1:
        parts.pop()
    if len(parts) > 4:
        raise HostError("too many IPv4 parts")
    numbers: list[int] = []
    for part in parts:
        number = _parse_ipv4_number(part)
        if number is None:
            raise HostError("invalid IPv4 part")
        numbers.append(number)
    if any(n > 255 for n in numbers[:-1]):
        raise HostError("IPv4 part out of range")
    if numbers[-1] >= 256 ** (5 - len(numbers)):
        raise HostError("IPv4 address out of range")
    address = numbers[-1]
    for index, number in enumerate(numbers[:-1]):
        address += number * 256 ** (3 - index)
    return ".".join(str((address >> shift) & 0xFF) for shift in (24, 16, 8, 0))


# ------------------------------------------------------------------- IPv6
def _serialize_ipv6(inner: str) -> str:
    if "%" in inner:
        raise HostError("IPv6 zone identifiers are not allowed")
    try:
        address = ipaddress.IPv6Address(inner)
    except ValueError as exc:
        raise HostError("invalid IPv6 address") from exc
    pieces = [(int(address) >> (112 - 16 * i)) & 0xFFFF for i in range(8)]
    # Compress the first longest run of two or more zero pieces.
    best_start, best_len, start = -1, 1, -1
    for i in range(9):
        if i < 8 and pieces[i] == 0:
            if start < 0:
                start = i
        elif start >= 0:
            if i - start > best_len:
                best_start, best_len = start, i - start
            start = -1
    out: list[str] = []
    i = 0
    while i < 8:
        if i == best_start:
            out.append("::" if i == 0 else ":")
            i += best_len
            continue
        out.append(f"{pieces[i]:x}")
        if i < 7 and i + 1 != best_start:
            out.append(":")
        i += 1
    return "".join(out)


# ------------------------------------------------------------------- domains
def _label_to_ascii(label: str) -> str:
    if label.isascii():
        if label[:4].lower() == "xn--":
            try:
                decoded = label[4:].encode("ascii").decode("punycode")
            except (UnicodeError, ValueError) as exc:
                raise HostError("invalid punycode label") from exc
            if decoded == "" or decoded.isascii():
                raise HostError("invalid punycode label")
            try:
                if idna.uts46_remap(decoded, std3_rules=False, transitional=False) != decoded:
                    raise HostError("punycode label is not in mapped form")
            except idna.IDNAError as exc:
                raise HostError("invalid punycode label") from exc
        return label
    try:
        idna.check_bidi(label)
    except idna.IDNAError as exc:
        raise HostError("bidi rule violation") from exc
    return "xn--" + label.encode("punycode").decode("ascii")


def domain_to_ascii(domain: str) -> str:
    """UTS #46 ToASCII as used by the URL Standard (beStrict = false)."""
    try:
        mapped = idna.uts46_remap(domain, std3_rules=False, transitional=False)
    except (idna.IDNAError, UnicodeError) as exc:
        raise HostError("disallowed code point") from exc
    return ".".join(_label_to_ascii(label) for label in mapped.split("."))


def parse_host(host: str, *, special: bool) -> str:
    """The serialized host (`URL.hostname`), or raise HostError."""
    if host.startswith("["):
        if not host.endswith("]"):
            raise HostError("unterminated IPv6 address")
        return f"[{_serialize_ipv6(host[1:-1])}]"
    if not special:
        if any(ch in _FORBIDDEN_HOST for ch in host):
            raise HostError("forbidden host code point")
        return _percent_encode(host, frozenset())
    domain = _percent_decode_bytes(host).decode("utf-8", errors="replace")
    ascii_domain = domain_to_ascii(domain)
    if ascii_domain == "" or any(ch in _FORBIDDEN_DOMAIN for ch in ascii_domain):
        raise HostError("forbidden domain code point")
    if _ends_in_number(ascii_domain):
        return _parse_ipv4(ascii_domain)
    return ascii_domain


# ------------------------------------------------------------------- URLs
@dataclass(frozen=True)
class ParsedUrl:
    scheme: str  # lowercase, without ":"
    hostname: str  # serialized host ("" for none); IPv6 keeps its brackets
    port: str  # "" when absent or the scheme default
    pathname: str
    query: str | None  # serialized query without "?" (None when absent)

    @property
    def search(self) -> str:
        """`URL.search`: "" for an absent or empty query."""
        return f"?{self.query}" if self.query else ""


def _is_double_dot(segment: str) -> bool:
    return segment.lower() in {"..", ".%2e", "%2e.", "%2e%2e"}


def _is_single_dot(segment: str) -> bool:
    return segment.lower() in {".", "%2e"}


def _parse_path(raw: str, *, special: bool) -> str:
    separators = re.compile(r"[/\\]") if special else re.compile(r"/")
    if raw == "":
        return "/" if special else ""
    segments = separators.split(raw)
    # raw starts with a separator for special URLs (authority ended at one), so the
    # first element is "" and is skipped.
    segments = segments[1:] if segments and segments[0] == "" else segments
    path: list[str] = []
    for index, segment in enumerate(segments):
        last = index == len(segments) - 1
        if _is_double_dot(segment):
            if path:
                path.pop()
            if last:
                path.append("")
        elif _is_single_dot(segment):
            if last:
                path.append("")
        else:
            path.append(_percent_encode(segment, _PATH_SET))
    return "/" + "/".join(path)


def parse_url(value: str) -> ParsedUrl | None:
    """Parse like `new URL(value)` (no base); None where the constructor would throw."""
    text = _TAB_OR_NEWLINE.sub("", _usv(value).strip(_C0_OR_SPACE))
    match = _SCHEME.match(text)
    if match is None:
        return None
    scheme = match.group(1).lower()
    rest = text[match.end() :]
    special = scheme in SPECIAL_PORTS and scheme != "file"
    if special:
        rest = rest.lstrip("/\\")
    elif rest.startswith("//"):
        rest = rest[2:]
    else:
        return None  # opaque-path URLs (mailto:, javascript:) have no host
    end = len(rest)
    for stop in ("/", "\\", "?", "#") if special else ("/", "?", "#"):
        position = rest.find(stop)
        if position != -1:
            end = min(end, position)
    authority, remainder = rest[:end], rest[end:]
    at = authority.rfind("@")
    hostport = authority[at + 1 :] if at != -1 else authority
    if at != -1 and hostport == "":
        return None
    host, port = hostport, ""
    bracket_depth_end = hostport.find("]") if hostport.startswith("[") else -1
    colon = hostport.find(":", bracket_depth_end + 1 if bracket_depth_end != -1 else 0)
    if colon != -1:
        host, port = hostport[:colon], hostport[colon + 1 :]
    if special and host == "":
        return None
    if port != "":
        if not port.isascii() or not port.isdigit():
            return None
        number = int(port)
        if number > 65535:
            return None
        port = "" if SPECIAL_PORTS.get(scheme) == number else str(number)
    try:
        hostname = parse_host(host, special=special) if host != "" else ""
    except HostError:
        return None
    fragment_at = remainder.find("#")
    if fragment_at != -1:
        remainder = remainder[:fragment_at]
    query: str | None = None
    query_at = remainder.find("?")
    if query_at != -1:
        query = _percent_encode(
            remainder[query_at + 1 :], _SPECIAL_QUERY_SET if special else frozenset(b' "#<>')
        )
        remainder = remainder[:query_at]
    return ParsedUrl(
        scheme=scheme,
        hostname=hostname,
        port=port,
        pathname=_parse_path(remainder, special=special),
        query=query,
    )
