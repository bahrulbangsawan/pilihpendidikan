// Account emails (11 §10): "your export is ready" and "confirm deleting your
// account", in the user's locale (en / id), sent through the `EMAIL` binding
// with the sign-in email's Cursor styling (src/email.ts): the dark page, a
// card with the wordmark over a 10% rule, one light pill as the action.

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import type { Env } from "../../../env";
import { escapeHtml } from "../../../html";

const DEFAULT_FROM = "noreply@pilihpendidikan.com";
const SENDER_NAME = "pilihpendidikan";

export interface AccountEmail {
  html: string;
  subject: string;
  text: string;
}

interface EmailCopy {
  action: string;
  fallback: string;
  footer: string;
  lead: string;
  subject: string;
}

const EXPORT_COPY: Record<Locale, EmailCopy> = {
  en: {
    subject: "Your pilihpendidikan data export is ready",
    lead: "Your Job Tracker data export is ready. Download it within 24 hours; you need to be signed in.",
    action: "Download export",
    fallback: "Or paste this address into your browser:",
    footer:
      "If you did not ask for this, sign in and review your devices and sessions.",
  },
  id: {
    subject: "Ekspor data pilihpendidikan Anda sudah siap",
    lead: "Ekspor data Job Tracker Anda sudah siap. Unduh dalam 24 jam; Anda perlu masuk terlebih dahulu.",
    action: "Unduh ekspor",
    fallback: "Atau tempel alamat ini di peramban Anda:",
    footer:
      "Jika Anda tidak memintanya, masuk dan periksa perangkat serta sesi Anda.",
  },
};

const DELETE_COPY: Record<Locale, EmailCopy> = {
  en: {
    subject: "Confirm deleting your pilihpendidikan account",
    lead: "You asked to delete your pilihpendidikan account. Deleting removes your Job Tracker data, signs out every device and cannot be undone. The link expires in 60 minutes.",
    action: "Review and confirm",
    fallback: "Or paste this address into your browser:",
    footer:
      "If you did not ask for this, ignore this email. Nothing is deleted without the confirmation.",
  },
  id: {
    subject: "Konfirmasi penghapusan akun pilihpendidikan Anda",
    lead: "Anda meminta penghapusan akun pilihpendidikan. Penghapusan menghilangkan data Job Tracker Anda, mengeluarkan semua perangkat, dan tidak dapat dibatalkan. Tautan berlaku 60 menit.",
    action: "Tinjau dan konfirmasi",
    fallback: "Atau tempel alamat ini di peramban Anda:",
    footer:
      "Jika Anda tidak memintanya, abaikan email ini. Tidak ada yang dihapus tanpa konfirmasi.",
  },
};

function render(copy: EmailCopy, link: string, lang: Locale): AccountEmail {
  const href = escapeHtml(link);
  return {
    subject: copy.subject,
    html: `<!doctype html><html lang="${lang}"><head><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;padding:24px 12px;background:#14120b;font-family:Geist,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:21px;color:#edecec">
<div style="max-width:480px;margin:0 auto;border-radius:4px;background:#1b1913">
<p style="margin:0;padding:14px 24px;border-bottom:1px solid #302e29;color:#edecec;font-size:16px;line-height:24px">pilihpendidikan</p>
<div style="padding:24px">
<p style="margin:0 0 20px;font-size:16px;line-height:24px">${escapeHtml(copy.lead)}</p>
<p style="margin:0 0 24px"><a href="${href}" style="display:inline-block;padding:9px 16px;border-radius:9999px;background:#edecec;color:#14120b;font-size:14px;line-height:18px;text-decoration:none">${escapeHtml(copy.action)}</a></p>
<p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#999895">${escapeHtml(copy.fallback)}</p>
<p style="margin:0 0 24px;font-size:12px;line-height:18px;word-break:break-all"><a href="${href}" style="color:#f54e00;text-decoration:none">${href}</a></p>
<p style="margin:0;font-size:12px;line-height:18px;color:#999895">${escapeHtml(copy.footer)}</p>
</div></div></body></html>`,
    text: `${copy.lead}\n\n${link}\n\n${copy.footer}`,
  };
}

/** "Your export is ready" with the download link (valid 24 h). */
export function renderExportReadyEmail(input: {
  link: string;
  locale: Locale;
}): AccountEmail {
  return render(EXPORT_COPY[input.locale], input.link, input.locale);
}

/** "Confirm deleting your account" with the confirmation link (60 min). */
export function renderDeleteConfirmEmail(input: {
  link: string;
  locale: Locale;
}): AccountEmail {
  return render(DELETE_COPY[input.locale], input.link, input.locale);
}

/** Sends one account email; delivery errors propagate to the caller. */
export async function sendAccountEmail(
  env: Pick<Env, "EMAIL" | "EMAIL_FROM">,
  to: string,
  email: AccountEmail
): Promise<void> {
  await env.EMAIL.send({
    from: { email: env.EMAIL_FROM || DEFAULT_FROM, name: SENDER_NAME },
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
}
