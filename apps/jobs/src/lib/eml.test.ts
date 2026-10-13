import { describe, expect, it } from "vitest";
import {
  base64,
  buildEml,
  cleanHeaderText,
  encodedWords,
  formatAddress,
  headerLine,
  mailtoHref,
  rfc5322Date,
} from "./eml";

const BOUNDARY = "----=_Pilih_0011223344556677";
const FOLD_RE = /\r\n /g;
const ENCODED_WORD_RE = /=\?UTF-8\?B\?([^?]+)\?=\s*/g;
const BOUNDARY_PARAM_RE = /boundary="([^"]+)"/;
const LEADING_CRLF_RE = /^\r\n/;
const BARE_LF_RE = /(^|[^\r])\n/;
const WHITESPACE_RE = /\s+/;
const ONLY_E_ACUTE_RE = /^é+$/;
const ENCODED_NAME_RE = /^=\?UTF-8\?B\?[^?]+\?= <a@b\.example>$/;

/** 7-bit printable ASCII plus tab, CR and LF. */
function isMailAscii(text: string): boolean {
  return [...text].every((char) => {
    const code = char.charCodeAt(0);
    return (
      code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)
    );
  });
}
const PDF = new TextEncoder().encode("%PDF-1.4\nbinary ÿ bytes\n%%EOF");

/** Decodes RFC 2047 B-words (the parse-back of 09 T9-04). */
function decodeWords(value: string): string {
  return value
    .replace(FOLD_RE, " ")
    .replace(ENCODED_WORD_RE, (_, text: string) =>
      new TextDecoder().decode(
        Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
      )
    )
    .trim();
}

interface Parsed {
  headers: Map<string, string>;
  parts: { headers: Map<string, string>; body: string }[];
}

/** A small RFC 5322 / MIME reader for the tests. */
function parse(message: string): Parsed {
  const split = message.indexOf("\r\n\r\n");
  const headers = new Map<string, string>();
  for (const line of message
    .slice(0, split)
    .replace(FOLD_RE, "\u0001")
    .split("\r\n")) {
    const at = line.indexOf(":");
    headers.set(
      line.slice(0, at).toLowerCase(),
      line
        .slice(at + 1)
        .trim()
        .replaceAll("\u0001", "\r\n ")
    );
  }
  const boundary =
    BOUNDARY_PARAM_RE.exec(headers.get("content-type") ?? "")?.[1] ?? "";
  const parts = message
    .slice(split + 4)
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((chunk) => {
      const body = chunk.replace(LEADING_CRLF_RE, "");
      const end = body.indexOf("\r\n\r\n");
      const partHeaders = new Map<string, string>();
      for (const line of body
        .slice(0, end)
        .replace(FOLD_RE, " ")
        .split("\r\n")) {
        const at = line.indexOf(":");
        partHeaders.set(
          line.slice(0, at).toLowerCase(),
          line.slice(at + 1).trim()
        );
      }
      return { headers: partHeaders, body: body.slice(end + 4).trimEnd() };
    });
  return { headers, parts };
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replaceAll("\r\n", "")), (char) =>
    char.charCodeAt(0)
  );
}

function sample(overrides: Partial<Parameters<typeof buildEml>[0]> = {}) {
  return buildEml(
    {
      from: { address: "rina.wulandari@example.com", name: "Rina Wulandari" },
      to: "careers@acme.example",
      subject: "Lamaran Insinyur Frontend Senior — Rina Wulandari",
      body: "Yth. Tim Rekrutmen Acme,\n\nBersama email ini saya lampirkan CV saya.\n\nHormat saya,\nRina",
      date: Date.UTC(2026, 9, 12, 7, 0, 0),
      messageId: "eml_01ja.0a1b2c3d@jobs.pilihpendidikan.com",
      attachments: [
        {
          bytes: PDF,
          contentType: "application/pdf",
          fileName: "Rina Wulandari - CV - Acme.pdf",
        },
      ],
      ...overrides,
    },
    BOUNDARY
  );
}

describe("TW-EML the web-only .eml (09 §6.1)", () => {
  it("TW-EML is RFC 5322: CRLF only, 7-bit ASCII, headers, X-Unsent: 1, multipart/mixed", () => {
    const eml = sample();
    expect(eml).not.toMatch(BARE_LF_RE);
    expect(isMailAscii(eml)).toBe(true);
    const { headers } = parse(eml);
    expect(headers.get("from")).toBe(
      "Rina Wulandari <rina.wulandari@example.com>"
    );
    expect(headers.get("to")).toBe("careers@acme.example");
    expect(headers.get("date")).toBe("Mon, 12 Oct 2026 07:00:00 +0000");
    expect(headers.get("message-id")).toBe(
      "<eml_01ja.0a1b2c3d@jobs.pilihpendidikan.com>"
    );
    expect(headers.get("mime-version")).toBe("1.0");
    expect(headers.get("x-unsent")).toBe("1");
    expect(headers.get("content-type")).toBe(
      `multipart/mixed; boundary="${BOUNDARY}"`
    );
    for (const line of eml.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(78);
    }
  });

  it("TW-EML encodes a non-ASCII subject as RFC 2047 words of at most 75 characters that decode back", () => {
    const subject =
      "Lamaran Insinyur Frontend Senior — Rina Wulandari · Jakarta 🇮🇩";
    const { headers } = parse(sample({ subject }));
    const raw = headers.get("subject") ?? "";
    expect(raw.startsWith("=?UTF-8?B?")).toBe(true);
    for (const word of raw.split(WHITESPACE_RE)) {
      expect(word.length).toBeLessThanOrEqual(75);
    }
    expect(decodeWords(raw)).toBe(subject);
    // A word never splits a UTF-8 sequence.
    for (const word of encodedWords("é".repeat(100))) {
      expect(decodeWords(word)).toMatch(ONLY_E_ACUTE_RE);
    }
  });

  it("TW-EML carries the body and the attachment byte for byte", () => {
    const { parts } = parse(sample());
    expect(parts).toHaveLength(2);
    const [text, attachment] = parts;
    expect(text?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(text?.headers.get("content-transfer-encoding")).toBe("base64");
    expect(new TextDecoder().decode(fromBase64(text?.body ?? ""))).toBe(
      "Yth. Tim Rekrutmen Acme,\r\n\r\nBersama email ini saya lampirkan CV saya.\r\n\r\nHormat saya,\r\nRina"
    );
    expect(attachment?.headers.get("content-type")).toBe(
      'application/pdf; name="Rina Wulandari - CV - Acme.pdf"'
    );
    expect(attachment?.headers.get("content-disposition")).toBe(
      'attachment; filename="Rina Wulandari - CV - Acme.pdf"'
    );
    expect(fromBase64(attachment?.body ?? "")).toEqual(PDF);
  });

  it("TW-EML refuses header injection: CR/LF in the subject or names never start a new header", () => {
    const eml = sample({
      subject: "Hello\r\nBcc: attacker@evil.example",
      from: {
        address: "rina@example.com",
        name: "Rina\r\nX-Evil: 1",
      },
    });
    const { headers } = parse(eml);
    expect(headers.has("bcc")).toBe(false);
    expect(headers.has("x-evil")).toBe(false);
    expect(headers.get("subject")).toBe("Hello Bcc: attacker@evil.example");
    expect(() =>
      sample({ to: "careers@acme.example\r\nBcc: x@evil.example" })
    ).toThrow();
    expect(() => formatAddress("not an address")).toThrow();
    expect(cleanHeaderText(" a\tb\r\n c ")).toBe("a b c");
  });

  it("TW-EML names a non-ASCII attachment with an ASCII fallback and RFC 2231 filename*", () => {
    const { parts } = parse(
      sample({
        attachments: [
          {
            bytes: PDF,
            contentType: "application/pdf",
            fileName: "Surat Lamaran — Zoë.pdf",
          },
        ],
      })
    );
    const disposition = parts[1]?.headers.get("content-disposition") ?? "";
    expect(disposition).toContain('filename="Surat Lamaran - Zoe.pdf"');
    expect(disposition).toContain(
      "filename*=UTF-8''Surat%20Lamaran%20%E2%80%94%20Zo%C3%AB.pdf"
    );
  });

  it("TW-EML encodes display names, quotes specials and formats dates", () => {
    expect(formatAddress("a@b.example", "Rina W.")).toBe(
      '"Rina W." <a@b.example>'
    );
    expect(formatAddress("a@b.example", "Zoë")).toMatch(ENCODED_NAME_RE);
    expect(rfc5322Date(Date.UTC(2026, 0, 4, 9, 5, 7))).toBe(
      "Sun, 04 Jan 2026 09:05:07 +0000"
    );
    expect(headerLine("Subject", "plain")).toBe("Subject: plain\r\n");
    expect(base64(new TextEncoder().encode("Man"))).toBe("TWFu");
    expect(base64(new TextEncoder().encode("Ma"))).toBe("TWE=");
  });

  it("TW-EML the mailto fallback pre-fills recipient, subject and body (no attachments)", () => {
    const href = mailtoHref(
      "careers@acme.example",
      "Lamaran — Rina",
      "Halo,\nterima kasih & salam"
    );
    const url = new URL(href);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("careers@acme.example");
    expect(url.searchParams.get("subject")).toBe("Lamaran — Rina");
    expect(url.searchParams.get("body")).toBe("Halo,\r\nterima kasih & salam");
    expect(href).not.toContain("attach");
    expect(() =>
      mailtoHref("x@y.example?bcc=evil@z.example", "s", "b")
    ).toThrow();
  });
});
