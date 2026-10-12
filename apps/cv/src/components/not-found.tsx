import { NotFound } from "@rulisme/ui/ui/not-found";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "@/i18n";

// Wired as the router's `defaultNotFoundComponent` (see `src/router.tsx`) and
// rendered by the `/$` catch-all. Home route for this app is `/` (the CV
// editor at `src/routes/index.tsx`).
//
// Logo: the app's favicon brand mark — the same red wordmark on every app, so
// all the apps' 404s stay on-brand and consistent. (`src/logo.svg` is the
// unused React-template default, not a real brand mark — intentionally not used
// here; swap this `src` if a dedicated logo asset lands.)
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <NotFound
      backLabel={t("notFound.back")}
      description={t("notFound.description")}
      homeAction={<Link to="/">{t("notFound.home")}</Link>}
      homeLabel={t("notFound.home")}
      logo={
        <img
          alt=""
          className="size-10 rounded-lg"
          decoding="async"
          height={40}
          src="/favicon-active/apple-touch-icon.png"
          width={40}
        />
      }
      title={t("notFound.title")}
    />
  );
}
