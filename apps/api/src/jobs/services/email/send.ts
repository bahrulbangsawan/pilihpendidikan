// `server_send` (09 §6.2, §7, §8): the Worker sends the approved message
// through the Cloudflare `EMAIL` binding — only behind the operator flag
// `JOBS_EMAIL_SERVER_SEND_ENABLED` (D-33, A-03).
//
// Sender identity (09 §7): `From` is ALWAYS `applications@pilihpendidikan.com`
// with the display name "<Full Name> via pilihpendidikan" (the name cleaned
// so it can never read as an address); `Reply-To` and `Cc` are `users.email`,
// the address the user proved by magic link — never a typed fact. One
// recipient, no BCC, plain text, no tracking.
//
// Limits (09 §8), checked before sending: 10 sent per rolling 24 h and 50 per
// rolling 30 days per user, 3 per recipient registrable domain per 30 days,
// none during the first 7 days after `users.created_at`. Attachments are read
// from R2 and re-hashed against `files.sha256` before anything is sent.

import { EMAIL_LIMITS } from "@pilihpendidikan/jobs-contracts/email";
import type { Env } from "../../../env";
import { DAY_MS } from "../../core/clock";
import type { FeatureFlags } from "../../core/flags";
import { apiError } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import type { EmailFileRow } from "../../repo/email";
import { listSentSince } from "../../repo/email";
import type { ContentAttachment, EmailContent } from "./content";
import { sha256Hex } from "./content";
import { recipientRegistrableDomain } from "./recipient";

/** The only sender address of server-sent applications (09 §6.2). */
export const APPLICATIONS_SENDER = "applications@pilihpendidikan.com";
export const SENDER_SUFFIX = " via pilihpendidikan";
export const SEND_LIMITS = {
  perDay: 10,
  perMonth: 50,
  perDomain: 3,
  dayMs: DAY_MS,
  monthMs: 30 * DAY_MS,
  domainWindowMs: 30 * DAY_MS,
  newAccountMs: 7 * DAY_MS,
} as const;
const NAME_MAX_CHARS = 64;
const NAME_UNSAFE_RE = /[<>"@\\,;:()[\]]|\p{Cc}|\p{Cf}/gu;
const SPACES_RE = /\s+/g;

function policy(reason: string, message: string, details = {}) {
  return apiError("policy_violation", message, {
    details: { reason, ...details },
  });
}

/**
 * The display name "<Full Name> via pilihpendidikan" (09 §7). Characters
 * that could make the name look like an address or break the header are
 * removed; without a usable name the sender says "An applicant".
 */
export function senderName(fullName: unknown): string {
  const cleaned =
    typeof fullName === "string"
      ? fullName
          .replace(NAME_UNSAFE_RE, " ")
          .replace(SPACES_RE, " ")
          .trim()
          .slice(0, NAME_MAX_CHARS)
          .trim()
      : "";
  return `${cleaned === "" ? "An applicant" : cleaned}${SENDER_SUFFIX}`;
}

/** 422 unless server_send may run now for this user (09 §8). */
export async function assertSendAllowed(
  db: JobsDb,
  scope: UserScope,
  input: {
    accountCreatedAt: number;
    flags: FeatureFlags;
    now: number;
    to: string;
  }
): Promise<void> {
  if (!input.flags.JOBS_EMAIL_SERVER_SEND_ENABLED) {
    throw policy(
      "server_send_disabled",
      "Sending from pilihpendidikan is not available; use local hand-off.",
      { flag: "JOBS_EMAIL_SERVER_SEND_ENABLED" }
    );
  }
  const availableAt = input.accountCreatedAt + SEND_LIMITS.newAccountMs;
  if (input.now < availableAt) {
    throw policy(
      "new_account",
      "Sending from pilihpendidikan unlocks 7 days after sign-up.",
      { available_at: availableAt }
    );
  }
  const sent = await listSentSince(db, scope, input.now - SEND_LIMITS.monthMs);
  const lastDay = sent.filter(
    (row) => row.sent_at >= input.now - SEND_LIMITS.dayMs
  ).length;
  if (lastDay >= SEND_LIMITS.perDay) {
    throw policy("daily_limit", "You reached 10 sent emails in 24 hours.", {
      limit: SEND_LIMITS.perDay,
      sent: lastDay,
    });
  }
  if (sent.length >= SEND_LIMITS.perMonth) {
    throw policy("monthly_limit", "You reached 50 sent emails in 30 days.", {
      limit: SEND_LIMITS.perMonth,
      sent: sent.length,
    });
  }
  const domain = recipientRegistrableDomain(input.to);
  const toDomain = sent.filter(
    (row) =>
      row.sent_at >= input.now - SEND_LIMITS.domainWindowMs &&
      recipientRegistrableDomain(row.to_address) === domain
  ).length;
  if (toDomain >= SEND_LIMITS.perDomain) {
    throw policy(
      "domain_limit",
      `You reached 3 sent emails to ${domain} in 30 days.`,
      { limit: SEND_LIMITS.perDomain, domain, sent: toDomain }
    );
  }
}

export interface LoadedAttachment {
  attachment: ContentAttachment;
  bytes: Uint8Array;
}

/**
 * Reads every attachment from R2 and verifies it against `files.sha256`
 * (09 §5.3). A missing object or a changed hash refuses the send.
 */
export async function loadVerifiedAttachments(
  env: Pick<Env, "JOBS_FILES">,
  attachments: readonly ContentAttachment[],
  files: readonly EmailFileRow[]
): Promise<LoadedAttachment[]> {
  const byId = new Map(files.map((file) => [file.id, file]));
  const out: LoadedAttachment[] = [];
  let total = 0;
  for (const attachment of attachments) {
    const file = byId.get(attachment.file_id);
    const object = file ? await env.JOBS_FILES.get(file.r2_key) : null;
    if (!(file && object)) {
      throw policy("attachment_unavailable", "An attachment is missing.", {
        file_id: attachment.file_id,
      });
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    total += bytes.byteLength;
    if ((await sha256Hex(bytes)) !== file.sha256) {
      throw policy(
        "attachment_integrity",
        "An attachment no longer matches its checksum.",
        { file_id: attachment.file_id }
      );
    }
    out.push({ attachment, bytes });
  }
  if (total > EMAIL_LIMITS.attachmentBytesTotal) {
    throw policy(
      "attachments_too_large",
      "Attachments are larger than 10 MB in total.",
      { total_bytes: total }
    );
  }
  return out;
}

/** The `EMAIL.send` builder of an approved application (09 §6.2, §7). */
export function buildServerMessage(input: {
  accountEmail: string;
  attachments: readonly LoadedAttachment[];
  content: EmailContent;
  fullName: unknown;
}): EmailMessageBuilder {
  return {
    from: { email: APPLICATIONS_SENDER, name: senderName(input.fullName) },
    to: input.content.to,
    cc: input.accountEmail,
    replyTo: input.accountEmail,
    subject: input.content.subject,
    text: input.content.body_text,
    attachments: input.attachments.map(({ attachment, bytes }) => ({
      disposition: "attachment" as const,
      filename: attachment.name,
      type: attachment.content_type,
      content: bytes,
    })),
  };
}

export type SendOutcome =
  | { messageId: string; ok: true }
  | { error: string; ok: false };

/** One provider call; a rejection is an outcome, not a throw. */
export async function sendThroughProvider(
  env: Pick<Env, "EMAIL">,
  message: EmailMessageBuilder
): Promise<SendOutcome> {
  try {
    const result = await env.EMAIL.send(message);
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    console.error(
      JSON.stringify({ evt: "email_application_send_failed", error: name })
    );
    return {
      ok: false,
      error: "The email service did not accept the message.",
    };
  }
}
