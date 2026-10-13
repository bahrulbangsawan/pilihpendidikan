// Recipient validation of email applications (09 §1).
//
//   syntax       the sign-in rules (≤ 254 chars, one `@`, a dotted domain;
//                src/sign-in.ts) plus: one bare address — no display name,
//                no list, no whitespace or control characters
//   employer     the domain equals, or is a subdomain of,
//                `job_postings.company_domain` or `apply_domain`
//   free mail    gmail.com, yahoo.com, outlook.com, … always need the tick
//                "I confirm this address belongs to the employer" (recruiter
//                impersonation scams), even when they match
//   tick         recorded in the approval payload (`recipient_confirmed`);
//                without a match it is required to approve

import { registrableDomain } from "@pilihpendidikan/jobs-contracts/fingerprint";
import { isValidEmail } from "../../../sign-in";

/** Consumer mailbox providers (09 §1); matched on the registrable domain. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.id",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "outlook.co.id",
  "hotmail.com",
  "hotmail.co.id",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "tutanota.com",
  "fastmail.com",
]);

/** Domains that never receive a server-sent application (mail loops). */
const OWN_DOMAINS: ReadonlySet<string> = new Set(["pilihpendidikan.com"]);

const FORBIDDEN_CHARS_RE = /[\s,;<>"'()[\]\\]|\p{Cc}/u;
const WWW_RE = /^www\./;

/**
 * The address in canonical form (trimmed, domain lowercased), or null when
 * it is not exactly one valid address.
 */
export function normalizeRecipient(raw: string): string | null {
  const value = raw.trim();
  if (!isValidEmail(value) || FORBIDDEN_CHARS_RE.test(value)) {
    return null;
  }
  const at = value.lastIndexOf("@");
  if (at <= 0 || value.indexOf("@") !== at) {
    return null;
  }
  const domain = value.slice(at + 1).toLowerCase();
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return null;
  }
  return `${value.slice(0, at)}@${domain}`;
}

/** The domain part of a normalized address. */
export function recipientDomain(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

/** The registrable domain of an address (its own domain when unparseable). */
export function recipientRegistrableDomain(address: string): string {
  const domain = recipientDomain(address);
  return registrableDomain(domain) ?? domain;
}

export interface EmployerDomains {
  applyDomain?: string | null;
  companyDomain?: string | null;
}

export interface RecipientCheck {
  address: string;
  /** True when the user must tick "this address belongs to the employer". */
  confirmationRequired: boolean;
  domain: string;
  /** The employer domains compared against. */
  employerDomains: string[];
  freeMail: boolean;
  matchesEmployer: boolean;
  /** pilihpendidikan's own domain (never a server_send recipient). */
  ownDomain: boolean;
}

function cleanDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase().replace(WWW_RE, "");
  return domain ? domain : null;
}

function isWithin(domain: string, parent: string): boolean {
  return domain === parent || domain.endsWith(`.${parent}`);
}

/** Validates a normalized address against the posting's domains. */
export function checkRecipient(
  address: string,
  employer: EmployerDomains
): RecipientCheck {
  const domain = recipientDomain(address);
  const registrable = registrableDomain(domain) ?? domain;
  const employerDomains = [
    ...new Set(
      [employer.companyDomain, employer.applyDomain]
        .map(cleanDomain)
        .filter((value): value is string => value !== null)
    ),
  ];
  const freeMail =
    FREE_MAIL_DOMAINS.has(domain) || FREE_MAIL_DOMAINS.has(registrable);
  const matchesEmployer = employerDomains.some((parent) =>
    isWithin(domain, parent)
  );
  return {
    address,
    domain,
    employerDomains,
    freeMail,
    matchesEmployer,
    ownDomain: OWN_DOMAINS.has(registrable),
    confirmationRequired: freeMail || !matchesEmployer,
  };
}

/** True when the recipient may be approved with this tick. */
export function recipientAccepted(
  check: RecipientCheck,
  confirmed: boolean
): boolean {
  return !check.confirmationRequired || confirmed;
}

/** Warnings shown with a draft (09 §1). */
export function recipientWarnings(check: RecipientCheck): string[] {
  const warnings: string[] = [];
  if (check.freeMail) {
    warnings.push("free_mail_recipient");
  }
  if (!check.matchesEmployer) {
    warnings.push("recipient_domain_unverified");
  }
  return warnings;
}
