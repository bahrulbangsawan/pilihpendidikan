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
    // Zedative (DESIGN.md) in email-safe inline styles: paper, a ruled card
    // with the wordmark band, one cobalt action with its lip, cobalt links.
    html: `<!doctype html><html lang="en"><body style="margin:0;padding:24px 12px;background:#f4f4f2;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:20px;color:#393d45">
<div style="max-width:480px;margin:0 auto;border:1px solid #cbcfd4;background:#fafafa">
<p style="margin:0;padding:16px 24px;border-bottom:1px solid #cbcfd4;color:#000000;font-size:16px;line-height:22px;font-weight:600"><span style="display:inline-block;width:20px;height:20px;margin-right:8px;border-radius:2px;background:#1348dc;color:#ffffff;font-size:10px;line-height:20px;text-align:center;vertical-align:-4px">&#9671;</span>pilihpendidikan</p>
<div style="padding:24px">
<p style="margin:0 0 16px;font-size:14px;line-height:20px">Use this link to ${purpose}. It expires in 15 minutes and works once.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;padding:8px 12px 6px;border-bottom:2px solid #053794;border-radius:4px;background:#1348dc;color:#ffffff;text-decoration:none">Continue</a></p>
<p style="margin:0 0 8px;font-size:12px;line-height:16px;color:#5a6170">Or paste this address into your browser:</p>
<p style="margin:0 0 24px;font-size:12px;line-height:16px;word-break:break-all"><a href="${link}" style="color:#1348dc">${link}</a></p>
<p style="margin:0;font-size:12px;line-height:16px;color:#5a6170">If you did not ask for this, ignore this email.</p>
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
