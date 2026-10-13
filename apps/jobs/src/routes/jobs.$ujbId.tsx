// biome-ignore-all lint/style/useFilenamingConvention: TanStack route params are `$camelCase` in the file name.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { TrackedJobPage } from "@/components/inbox/tracked-job-page";
import { NotFoundPage } from "@/components/not-found";
import { pageTitle, requireSignedIn } from "./-guards";

export const Route = createFileRoute("/jobs/$ujbId")({
  beforeLoad: requireSignedIn,
  head: ({ match }) => pageTitle(match, "pages.job"),
  component: TrackedJobRoute,
});

function TrackedJobRoute() {
  const { ujbId } = Route.useParams();
  const router = useRouter();
  const navigate = useCallback(
    (href: string, options?: { replace?: boolean }) => {
      router.navigate({ href, replace: options?.replace ?? false });
    },
    [router]
  );
  return (
    <TrackedJobPage
      key={ujbId}
      notFound={<NotFoundPage />}
      onNavigate={navigate}
      ujbId={ujbId}
    />
  );
}
