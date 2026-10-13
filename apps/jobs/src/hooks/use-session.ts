// The session as the browser knows it: signed in or not, the email and the
// locale (src/functions/session.functions.ts). Never the bearer.

import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { SessionState } from "@/functions/session.functions";
import { getSessionState, signOut } from "@/functions/session.functions";
import { DEFAULT_LOCALE } from "@/lib/locale";
import { queryKeys } from "@/lib/query";

export const SIGNED_OUT_STATE: SessionState = {
  signedIn: false,
  email: null,
  expiresAt: null,
  locale: DEFAULT_LOCALE,
};

export function sessionQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.session,
    queryFn: () => getSessionState(),
    staleTime: 60_000,
  });
}

export function useSession(): SessionState {
  const { data } = useQuery(sessionQueryOptions());
  return data ?? SIGNED_OUT_STATE;
}

/** Signs out, drops every cached query and returns to the sign-in band. */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    try {
      await signOut();
    } finally {
      const locale =
        queryClient.getQueryData<SessionState>(queryKeys.session)?.locale ??
        DEFAULT_LOCALE;
      queryClient.clear();
      queryClient.setQueryData<SessionState>(queryKeys.session, {
        ...SIGNED_OUT_STATE,
        locale,
      });
      await navigate({ to: "/" });
    }
  }, [navigate, queryClient]);
}
