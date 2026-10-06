import { NotFound } from "@rulisme/ui/ui/not-found";
import { localePath, useTranslation } from "@/i18n";

// Wired as the router's `defaultNotFoundComponent` (see `src/router.tsx`) and
// rendered by the `/$` catch-all. A plain anchor, not a router <Link>: the hub
// has no client-side navigation worth preloading.
export function NotFoundPage() {
  const { locale, t } = useTranslation();
  return (
    <NotFound
      description={t("notFound.description")}
      homeAction={<a href={localePath(locale)}>{t("notFound.home")}</a>}
      homeLabel={t("notFound.home")}
      logo={
        <img
          alt=""
          className="size-10 rounded-lg"
          decoding="async"
          height={40}
          src="/favicon/apple-touch-icon.png"
          width={40}
        />
      }
      showBack={false}
      title={t("notFound.title")}
    />
  );
}
