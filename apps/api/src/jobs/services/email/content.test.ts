import { describe, expect, it } from "bun:test";
import { ApiError } from "../../core/http";
import type {
  AttachmentFile,
  ContentAttachment,
  EmailContent,
} from "./content";
import {
  assertBody,
  assertSubject,
  attachmentName,
  canonicalJson,
  checkAttachments,
  DOCX_TYPE,
  emailPayloadHash,
  sha256Hex,
} from "./content";
import { buildServerMessage, senderName } from "./send";

const MB = 1_048_576;
const HEADER_BREAK_RE = /[\r\n"]/;

function file(
  id: string,
  overrides: Partial<AttachmentFile> = {}
): AttachmentFile {
  return {
    id,
    kind: "attachment",
    r2_key: `u/usr/attachment/${id}.pdf`,
    content_type: "application/pdf",
    size_bytes: MB,
    sha256: "a".repeat(64),
    original_name: "Portfolio.pdf",
    status: "ready",
    ...overrides,
  };
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ApiError
      ? `${err.code}:${String(err.details?.reason ?? "")}`
      : "other";
  }
}

describe("email content (09 §4, §8)", () => {
  it("the payload hash covers to, cc, subject, body and attachment hashes canonically", async () => {
    const base: EmailContent = {
      to: "hr@acme.co.id",
      cc: [],
      subject: "Application",
      body_text: "Hello",
      attachments: [
        {
          file_id: "fil_1",
          sha256: "a".repeat(64),
          name: "CV.pdf",
          size_bytes: 1,
          content_type: "application/pdf",
        },
      ],
    };
    const hash = await emailPayloadHash(base);
    expect(hash).toBe(
      await sha256Hex(
        canonicalJson({
          attachments: ["a".repeat(64)],
          body_text: "Hello",
          cc: [],
          subject: "Application",
          to: "hr@acme.co.id",
        })
      )
    );
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 1 }] })).toBe(
      '{"a":[{"c":1,"d":2}],"b":1}'
    );
    const variants: EmailContent[] = [
      { ...base, to: "other@acme.co.id" },
      { ...base, cc: ["me@example.com"] },
      { ...base, subject: "Application!" },
      { ...base, body_text: "Hello." },
      {
        ...base,
        attachments: [
          {
            ...(base.attachments[0] as ContentAttachment),
            sha256: "b".repeat(64),
          },
        ],
      },
    ];
    for (const variant of variants) {
      expect(await emailPayloadHash(variant)).not.toBe(hash);
    }
    // The file name is display only; the bytes are what is approved.
    expect(
      await emailPayloadHash({
        ...base,
        attachments: [
          { ...(base.attachments[0] as ContentAttachment), name: "x.pdf" },
        ],
      })
    ).toBe(hash);
  });

  it("TE-LIMITS body ≤ 20 KB of UTF-8 and a one-line subject", () => {
    expect(codeOf(() => assertBody("a".repeat(20_480)))).toBeNull();
    expect(codeOf(() => assertBody("a".repeat(20_481)))).toBe(
      "invalid_request:"
    );
    // 7,000 × 3-byte characters is under 20,480 characters but over 20 KB.
    expect(codeOf(() => assertBody("€".repeat(7000)))).toBe("invalid_request:");
    expect(codeOf(() => assertBody("  "))).toBe("invalid_request:");
    expect(codeOf(() => assertSubject("Lamaran — Backend"))).toBeNull();
    expect(codeOf(() => assertSubject("a\r\nBcc: x@y.z"))).toBe(
      "invalid_request:"
    );
    expect(codeOf(() => assertSubject("x".repeat(301)))).toBe(
      "invalid_request:"
    );
  });

  it("TE-ATTACHMENTS at most 5, at most 10 MB in total, PDF/DOCX only, ready files of the user", () => {
    const five = ["f1", "f2", "f3", "f4", "f5"];
    expect(
      checkAttachments(
        five,
        five.map((id) => file(id, { size_bytes: 2 * MB }))
      )
    ).toHaveLength(5);
    const six = [...five, "f6"];
    expect(
      codeOf(() =>
        checkAttachments(
          six,
          six.map((id) => file(id))
        )
      )
    ).toBe("invalid_request:");
    expect(
      codeOf(() =>
        checkAttachments(
          five,
          five.map((id) => file(id, { size_bytes: 2.5 * MB }))
        )
      )
    ).toBe("policy_violation:attachments_too_large");
    expect(
      codeOf(() =>
        checkAttachments(["f1"], [file("f1", { content_type: "image/png" })])
      )
    ).toBe("policy_violation:attachment_type");
    expect(
      checkAttachments(["f1"], [file("f1", { content_type: DOCX_TYPE })])
    ).toHaveLength(1);
    expect(
      codeOf(() =>
        checkAttachments(["f1"], [file("f1", { kind: "evidence_screenshot" })])
      )
    ).toBe("policy_violation:attachment_kind");
    // Not the caller's (absent from the rows) or not ready.
    expect(codeOf(() => checkAttachments(["f9"], []))).toBe(
      "policy_violation:attachment_unavailable"
    );
    expect(
      codeOf(() =>
        checkAttachments(["f1"], [file("f1", { status: "deleted" })])
      )
    ).toBe("policy_violation:attachment_unavailable");
    expect(codeOf(() => checkAttachments(["f1", "f1"], [file("f1")]))).toBe(
      "invalid_request:"
    );
    expect(attachmentName(file("f1", { original_name: "../../etc/cv" }))).toBe(
      ".._.._etc_cv.pdf"
    );
    expect(
      attachmentName(file("f1", { original_name: null, kind: "cv_pdf" }))
    ).toBe("CV.pdf");
  });

  it("T9-07 the sender display name can never carry an address", () => {
    expect(senderName("Rina Wijaya")).toBe("Rina Wijaya via pilihpendidikan");
    expect(senderName("ceo@acme.com <ceo@acme.com>")).not.toContain("@");
    expect(senderName('"Rina"\r\nBcc: x')).not.toMatch(HEADER_BREAK_RE);
    expect(senderName(null)).toBe("An applicant via pilihpendidikan");
    const message = buildServerMessage({
      accountEmail: "rina@example.com",
      attachments: [],
      fullName: "rina@example.com",
      content: {
        to: "hr@acme.co.id",
        cc: ["rina@example.com"],
        subject: "S",
        body_text: "B",
        attachments: [],
      },
    });
    expect(message.from).toEqual({
      email: "applications@pilihpendidikan.com",
      name: "rina example.com via pilihpendidikan",
    });
    expect(message.replyTo).toBe("rina@example.com");
    expect(message.cc).toBe("rina@example.com");
  });
});
