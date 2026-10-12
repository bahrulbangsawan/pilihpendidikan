import { NotFound } from "@rulisme/ui/ui/not-found";
import { localePath, useTranslation } from "@/i18n";
import { BrandMark } from "./brand-mark";

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
      logo={<BrandMark size="lg" />}
      showBack={false}
      title={t("notFound.title")}
    />
  );
}
