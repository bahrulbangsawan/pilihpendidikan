import { describe, expect, it } from "vitest";
import {
  bodyBytes,
  checkRecipient,
  needsRecipientConfirmation,
  parseMailtoApply,
} from "./email-recipient";

const ACME = { companyDomain: "acme.example", applyDomain: "greenhouse.io" };

describe("TW-EML recipient validation hints (09 §1)", () => {
  it("TW-EML the employer's domain or a subdomain needs no confirmation", () => {
    expect(checkRecipient("careers@acme.example", ACME)).toEqual({
      kind: "employer",
      domain: "acme.example",
    });
    expect(checkRecipient("hr@jobs.acme.example", ACME).kind).toBe("employer");
    expect(
      needsRecipientConfirmation(checkRecipient("hr@acme.example", ACME))
    ).toBe(false);
  });

  it("TW-EML free-mail and other domains always need the tick; invalid addresses are refused", () => {
    expect(checkRecipient("recruiter.acme@gmail.com", ACME)).toEqual({
      kind: "free_mail",
      domain: "gmail.com",
    });
    expect(checkRecipient("hr@acme-careers.example", ACME).kind).toBe(
      "other_domain"
    );
    expect(checkRecipient("x@notacme.example", ACME).kind).toBe("other_domain");
    for (const check of [
      checkRecipient("a@gmail.com", ACME),
      checkRecipient("a@other.example", ACME),
    ]) {
      expect(needsRecipientConfirmation(check)).toBe(true);
    }
    for (const bad of [
      "no-at",
      "a@b",
      "a b@c.example",
      `${"a".repeat(250)}@b.example`,
    ]) {
      expect(checkRecipient(bad, ACME).kind).toBe("invalid");
    }
    expect(checkRecipient("  ", ACME).kind).toBe("empty");
  });

  it("TW-EML a mailto apply link pre-fills the recipient and subject; body size counts UTF-8 bytes", () => {
    expect(
      parseMailtoApply(
        "mailto:careers@acme.example?subject=Frontend%20%E2%80%94%20ref%2042"
      )
    ).toEqual({ to: "careers@acme.example", subject: "Frontend — ref 42" });
    expect(parseMailtoApply("https://acme.example/jobs")).toBeNull();
    expect(parseMailtoApply("mailto:not-an-address")).toBeNull();
    expect(bodyBytes("é")).toBe(2);
  });
});
