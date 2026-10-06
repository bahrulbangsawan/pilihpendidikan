import { fadeInOnLoad } from "@rulisme/ui/lib/image-fade";
import { Link } from "@tanstack/react-router";
import { NotFound } from "@rulisme/ui/ui/not-found";

// Wired as the router's `defaultNotFoundComponent` (see `src/router.tsx`) and
// rendered by the `/$` catch-all. Home route for this app is `/` (the invoice
// editor at `src/routes/index.tsx`).
//
// Logo: the app's favicon brand mark — the same red wordmark on every app, so
// all the apps' 404s stay on-brand and consistent. (`src/logo.svg` is the
// unused React-template default, not a real brand mark — intentionally not used
// here; swap this `src` if a dedicated logo asset lands.)
export function NotFoundPage() {
  return (
    <NotFound
      homeAction={<Link to="/">Back to home</Link>}
      logo={
        <img
          alt=""
          className="image-fade size-10 rounded-lg"
          decoding="async"
          height={40}
          ref={fadeInOnLoad}
          src="/favicon-active/apple-touch-icon.png"
          width={40}
        />
      }
    />
  );
}
