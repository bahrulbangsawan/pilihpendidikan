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
    // The Cursor design system (DESIGN.md) in email-safe inline styles: the
    // dark page, a card with the wordmark over a 10% rule, one light pill as
    // the action, orange links.
    html: `<!doctype html><html lang="en"><head><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;padding:24px 12px;background:#14120b;font-family:Geist,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:21px;color:#edecec">
<div style="max-width:480px;margin:0 auto;border-radius:4px;background:#1b1913">
<p style="margin:0;padding:14px 24px;border-bottom:1px solid #302e29;color:#edecec;font-size:16px;line-height:24px">pilihpendidikan</p>
<div style="padding:24px">
<p style="margin:0 0 20px;font-size:16px;line-height:24px">Use this link to ${purpose}. It expires in 15 minutes and works once.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;padding:9px 16px;border-radius:9999px;background:#edecec;color:#14120b;font-size:14px;line-height:18px;text-decoration:none">Continue</a></p>
<p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#999895">Or paste this address into your browser:</p>
<p style="margin:0 0 24px;font-size:12px;line-height:18px;word-break:break-all"><a href="${link}" style="color:#f54e00;text-decoration:none">${link}</a></p>
<p style="margin:0;font-size:12px;line-height:18px;color:#999895">If you did not ask for this, ignore this email.</p>
</div></div></body></html>`,
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
