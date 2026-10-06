// Sibling file extracted to satisfy only-export-components:
// RootDocument and RootComponent are components referenced by Route
// but must be exported for Fast Refresh to work correctly.

import {
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { getT, I18nProvider, localeFromPath } from "@/i18n";

function useLocale() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return localeFromPath(pathname);
}

// Warp is dark-canonical and the hub has no theme toggle, so `.dark` is set on
// the server and no theme script runs.
export function RootDocument({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  return (
    <html className="dark" lang={locale}>
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

export function RootComponent() {
  const locale = useLocale();
  const i18nValue = useMemo(() => ({ locale, t: getT(locale) }), [locale]);

  return (
    <I18nProvider value={i18nValue}>
      <Outlet />
    </I18nProvider>
  );
}
