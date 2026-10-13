// Recipient checks of the email composer (09 §1). The api validates again;
// these drive the hints next to the field:
//
// - the address must be a plain `local@domain` (≤ 254 characters);
// - an address on the employer's domain (company_domain or the posting's
//   apply_domain, or a subdomain of either) needs nothing more;
// - any other domain needs the "this address belongs to the employer" tick;
// - free-mail domains always need the tick and warn about recruiter scams.
// Also: the `mailto:` apply link of a posting pre-fills the composer.

import { EMAIL_LIMITS } from "@pilihpendidikan/jobs-contracts/email";

/** Consumer mail providers (09 §1): never proof of an employer. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.id",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "yandex.com",
  "zoho.com",
  "qq.com",
  "163.com",
]);

const ADDRESS_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export type RecipientCheck =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "employer"; domain: string }
  | { kind: "free_mail"; domain: string }
  | { kind: "other_domain"; domain: string };

export interface EmployerDomains {
  applyDomain: string | null;
  companyDomain: string | null;
}

function onDomain(domain: string, employer: string | null): boolean {
  if (!employer) {
    return false;
  }
  const base = employer.toLowerCase();
  return domain === base || domain.endsWith(`.${base}`);
}

export function checkRecipient(
  raw: string,
  employer: EmployerDomains
): RecipientCheck {
  const address = raw.trim();
  if (address === "") {
    return { kind: "empty" };
  }
  if (
    address.length > EMAIL_LIMITS.recipientLength ||
    !ADDRESS_RE.test(address)
  ) {
    return { kind: "invalid" };
  }
  const domain = (address.split("@")[1] ?? "").toLowerCase();
  if (FREE_MAIL_DOMAINS.has(domain)) {
    return { kind: "free_mail", domain };
  }
  if (
    onDomain(domain, employer.companyDomain) ||
    onDomain(domain, employer.applyDomain)
  ) {
    return { kind: "employer", domain };
  }
  return { kind: "other_domain", domain };
}

/** The tick "this address belongs to the employer" is required. */
export function needsRecipientConfirmation(check: RecipientCheck): boolean {
  return check.kind === "free_mail" || check.kind === "other_domain";
}

/** UTF-8 size of the body (the api caps it at 20 KB, 09 §8). */
export function bodyBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** `{to, subject}` of a posting's `mailto:` apply link, else null. */
export function parseMailtoApply(
  applyUrl: string | null
): { to: string; subject: string | null } | null {
  if (!applyUrl?.toLowerCase().startsWith("mailto:")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(applyUrl);
  } catch {
    return null;
  }
  let to = "";
  try {
    to = decodeURIComponent(url.pathname).split(",")[0]?.trim() ?? "";
  } catch {
    return null;
  }
  if (!ADDRESS_RE.test(to)) {
    return null;
  }
  const subject = url.searchParams.get("subject");
  return { to, subject: subject?.trim() ? subject.trim() : null };
}
