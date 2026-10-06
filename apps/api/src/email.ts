// Sign-in emails, sent through the `EMAIL` send_email binding from the
// pilihpendidikan.com sender. Plain HTML + text, no template dependency.

import { escapeHtml } from "./html";
import type { Env } from "./env";

const DEFAULT_FROM = "noreply@pilihpendidikan.com";
const SENDER_NAME = "pilihpendidikan";

export interface SignInEmail {
  to: string;
  link: string;
  // What the link does, e.g. "sign in" or "connect Claude".
  purpose: string;
}

export function renderSignInEmail(email: SignInEmail): {
  subject: string;
  html: string;
  text: string;
} {
  const link = escapeHtml(email.link);
  const purpose = escapeHtml(email.purpose);
  return {
    subject: `Your pilihpendidikan link to ${email.purpose}`,
    html: `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f6f6f4;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e1e1d">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-size:16px">Use this link to ${purpose}. It expires in 15 minutes and works once.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;padding:10px 16px;background:#1e1e1d;color:#ffffff;text-decoration:none;border-radius:4px">Continue</a></p>
<p style="margin:0 0 8px;font-size:14px;color:#5c5c5a">Or paste this address into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${link}" style="color:#1e1e1d">${link}</a></p>
<p style="margin:0;font-size:13px;color:#5c5c5a">If you did not ask for this, ignore this email.</p>
</div></body></html>`,
    text: `Use this link to ${email.purpose}. It expires in 15 minutes and works once.\n\n${email.link}\n\nIf you did not ask for this, ignore this email.`,
  };
}

// Sends in the background so the request returns immediately. `onFailure`
// runs when delivery fails (the caller rolls back the stored link token).
export function sendSignInEmail(
  env: Env,
  ctx: ExecutionContext,
  email: SignInEmail,
  onFailure: () => Promise<void>
): void {
  const { subject, html, text } = renderSignInEmail(email);
  ctx.waitUntil(
    env.EMAIL.send({
      from: { email: env.EMAIL_FROM || DEFAULT_FROM, name: SENDER_NAME },
      to: email.to,
      subject,
      html,
      text,
    }).then(
      () => undefined,
      async (err: unknown) => {
        console.error("sign-in email send failed", { err });
        await onFailure().catch(() => undefined);
      }
    )
  );
}
