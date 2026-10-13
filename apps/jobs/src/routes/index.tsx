import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignInPage } from "@/components/sign-in/sign-in-page";
import { completeSignIn } from "@/functions/session.functions";
import { queryKeys } from "@/lib/query";
import { pageTitle } from "./-guards";

export interface SignInSearch {
  /** One-time code from the api's `/auth/verify` redirect (12 §1.1). */
  code?: string;
  /** Set when a 401 ended the session. */
  expired?: 1;
}

// `/` (12 §2): the sign-in band when signed out, the board otherwise. With
// `?code=` it finishes the email sign-in: exchange → sealed cookie → /board.
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    ...(typeof search.code === "string" && search.code.length > 0
      ? { code: search.code }
      : {}),
    ...(search.expired === 1 || search.expired === "1" ? { expired: 1 } : {}),
  }),
  beforeLoad: async ({ context, search }) => {
    if (search.code) {
      const result = await completeSignIn({ data: { code: search.code } });
      if (result.ok) {
        await context.queryClient.invalidateQueries({
          queryKey: queryKeys.session,
        });
        throw redirect({ to: "/board", replace: true });
      }
      return { signInError: result.reason };
    }
    if (context.session.signedIn) {
      throw redirect({ to: "/board", replace: true });
    }
    return {
      signInError: search.expired ? ("session_expired" as const) : null,
    };
  },
  head: ({ match }) => pageTitle(match, "signIn.pageTitle"),
  component: SignInRoute,
});

function SignInRoute() {
  const { signInError } = Route.useRouteContext();
  return <SignInPage initialError={signInError} />;
}
