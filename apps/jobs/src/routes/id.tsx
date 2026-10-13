import { createFileRoute, redirect } from "@tanstack/react-router";
import type { SessionState } from "@/functions/session.functions";
import { setLocale } from "@/functions/session.functions";
import { localeRedirectResponse } from "@/lib/locale";
import { queryKeys } from "@/lib/query";

// `/id` (12 §2, D-27): remember Indonesian in `jobs-lang` and go to the board,
// so links from the Indonesian hub land in Indonesian. A full request is
// answered by the server handler (302 + Set-Cookie); an in-app navigation
// runs beforeLoad instead.
export const Route = createFileRoute("/id")({
  server: {
    handlers: {
      GET: ({ request }) => localeRedirectResponse(request, "id"),
    },
  },
  beforeLoad: async ({ context }) => {
    await setLocale({ data: { locale: "id" } });
    context.queryClient.setQueryData<SessionState>(
      queryKeys.session,
      (state) => (state ? { ...state, locale: "id" } : state)
    );
    throw redirect({ to: "/board" });
  },
});
