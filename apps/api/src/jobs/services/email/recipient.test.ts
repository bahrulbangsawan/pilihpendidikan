import { describe, expect, it } from "bun:test";
import {
  checkRecipient,
  normalizeRecipient,
  recipientAccepted,
  recipientWarnings,
} from "./recipient";

const ACME = { companyDomain: "acme.co.id", applyDomain: "greenhouse.io" };

describe("recipient validation (09 §1)", () => {
  it("T9-01 invalid addresses are rejected", () => {
    for (const bad of [
      "",
      "hr",
      "hr@",
      "@acme.co.id",
      "hr@acme",
      "hr @acme.co.id",
      "HR <hr@acme.co.id>",
      "a@acme.co.id, b@acme.co.id",
      "a@b@acme.co.id",
      "hr@acme..co.id",
      `${"x".repeat(250)}@acme.co.id`,
      "hr@acme.co.id\r\nBcc: x@evil.com",
    ]) {
      expect(normalizeRecipient(bad)).toBeNull();
    }
    expect(normalizeRecipient("  Rina.HR@Acme.CO.ID ")).toBe(
      "Rina.HR@acme.co.id"
    );
  });

  it("T9-01 the employer's domain or a subdomain matches without a tick", () => {
    for (const address of [
      "hr@acme.co.id",
      "talent@careers.acme.co.id",
      "jobs@greenhouse.io",
    ]) {
      const check = checkRecipient(address, ACME);
      expect(check.matchesEmployer).toBe(true);
      expect(check.confirmationRequired).toBe(false);
      expect(recipientAccepted(check, false)).toBe(true);
      expect(recipientWarnings(check)).toEqual([]);
    }
    // A look-alike is not a subdomain.
    const lookalike = checkRecipient("hr@notacme.co.id", ACME);
    expect(lookalike.matchesEmployer).toBe(false);
    expect(recipientAccepted(lookalike, false)).toBe(false);
    expect(recipientAccepted(lookalike, true)).toBe(true);
    expect(recipientWarnings(lookalike)).toEqual([
      "recipient_domain_unverified",
    ]);
  });

  it("T9-01 free-mail domains always need the tick, even when they match", () => {
    const gmail = checkRecipient("acme.hiring@gmail.com", {
      companyDomain: "gmail.com",
    });
    expect(gmail.freeMail).toBe(true);
    expect(gmail.matchesEmployer).toBe(true);
    expect(gmail.confirmationRequired).toBe(true);
    expect(recipientAccepted(gmail, false)).toBe(false);
    expect(recipientAccepted(gmail, true)).toBe(true);
    expect(recipientWarnings(gmail)).toContain("free_mail_recipient");
    expect(checkRecipient("hr@yahoo.co.id", ACME).freeMail).toBe(true);
    expect(checkRecipient("x@pilihpendidikan.com", ACME).ownDomain).toBe(true);
  });
});
