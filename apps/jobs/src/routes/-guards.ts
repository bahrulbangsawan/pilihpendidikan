// Route-level helpers. Route guards are UX only: the data boundary is the BFF
// (every server function reads the session itself).

import type { AnyRouteMatch } from "@tanstack/react-router";
import { redirect } from "@tanstack/react-router";
import type { SessionState } from "@/functions/session.functions";
import { getT } from "@/i18n";

interface GuardContext {
  session: SessionState;
}

/** Sends a signed-out visitor to the sign-in band. */
export function requireSignedIn({ context }: { context: GuardContext }) {
  if (!context.session.signedIn) {
    throw redirect({ to: "/" });
  }
}

/** `<title>` in the visitor's locale: "Board · Pilih Jobs". */
export function pageTitle(match: AnyRouteMatch | undefined, key: string) {
  const session = (match?.context as Partial<GuardContext> | undefined)
    ?.session;
  const t = getT(session?.locale ?? "en");
  return { meta: [{ title: `${t(key)} · ${t("app.name")}` }] };
}
