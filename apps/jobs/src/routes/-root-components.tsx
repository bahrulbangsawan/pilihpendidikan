// Sibling of __root.tsx (only-export-components): the document shell and the
// providers every screen shares.

import { Toaster } from "@rulisme/ui/ui/sonner";
import { TooltipProvider } from "@rulisme/ui/ui/tooltip";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { AppShell } from "@/components/shell/app-shell";
import type { SessionState } from "@/functions/session.functions";
import { SIGNED_OUT_STATE, useSession } from "@/hooks/use-session";
import { getT, I18nProvider } from "@/i18n";
import { onUnauthorized } from "@/lib/api-client";
import { installBffTransport } from "@/lib/api-transport";
import { queryKeys } from "@/lib/query";

installBffTransport();

/** Pages drawn without the nav band and sidebar. */
function isBarePath(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/render/");
}

function Document({ children }: { children: ReactNode }) {
  const session = useSession();
  return (
    <html lang={session.locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export function RootDocument({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <QueryClientProvider client={router.options.context.queryClient}>
      <Document>{children}</Document>
    </QueryClientProvider>
  );
}

/** A 401 anywhere means the session ended: back to the sign-in band. */
function useSessionExpiry() {
  const queryClient = useQueryClient();
  const router = useRouter();
  useEffect(
    () =>
      onUnauthorized(() => {
        const locale =
          queryClient.getQueryData<SessionState>(queryKeys.session)?.locale ??
          SIGNED_OUT_STATE.locale;
        queryClient.setQueryData<SessionState>(queryKeys.session, {
          ...SIGNED_OUT_STATE,
          locale,
        });
        router.navigate({ to: "/", search: { expired: 1 } });
      }),
    [queryClient, router]
  );
}

function Screens() {
  useSessionExpiry();
  const session = useSession();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const i18n = useMemo(
    () => ({ locale: session.locale, t: getT(session.locale) }),
    [session.locale]
  );

  useEffect(() => {
    document.documentElement.lang = session.locale;
  }, [session.locale]);

  return (
    <I18nProvider value={i18n}>
      <TooltipProvider>
        {session.signedIn && !isBarePath(pathname) ? (
          <AppShell>
            <Outlet />
          </AppShell>
        ) : (
          <Outlet />
        )}
        <Toaster closeButton />
      </TooltipProvider>
    </I18nProvider>
  );
}

export function RootComponent() {
  // Zedative is light-canonical; Night Desk (`.dark`) only when chosen in
  // Settings or the command palette, remembered in localStorage. next-themes
  // sets the class before the body paints with an inline script that carries
  // this response's CSP nonce.
  const nonce = useRouter().options.ssr?.nonce;
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      disableTransitionOnChange
      enableSystem={false}
      nonce={nonce}
    >
      <Screens />
    </ThemeProvider>
  );
}
