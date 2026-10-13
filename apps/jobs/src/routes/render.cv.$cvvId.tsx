// biome-ignore-all lint/style/useFilenamingConvention: TanStack route params are `$camelCase` in the file name.
import { createFileRoute } from "@tanstack/react-router";
import { RenderCvPage } from "@/components/render/render-cv-page";
import { pageTitle } from "./-guards";

// Chrome-free (isBarePath) and open to a signed-out visitor: the render
// ticket in `?ticket=` is the credential (08 §6.4). The edge adds
// `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, the strict
// render CSP and noindex (src/lib/edge-policy.ts).
export const Route = createFileRoute("/render/cv/$cvvId")({
  head: ({ match }) => ({
    meta: [
      ...pageTitle(match, "pages.render").meta,
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RenderCvRoute,
});

function RenderCvRoute() {
  const { cvvId } = Route.useParams();
  return <RenderCvPage cvvId={cvvId} key={cvvId} />;
}
