import { NotFound } from "@rulisme/ui/ui/not-found";
import { Link } from "@tanstack/react-router";
import { useSession } from "@/hooks/use-session";
import { useTranslation } from "@/i18n";
import { BrandMark } from "./shell/brand-mark";

// The router's defaultNotFoundComponent and the `/$` catch-all. Inside the
// signed-in shell it renders as a block of the page (the shell owns <main>).
export function NotFoundPage() {
  const { t } = useTranslation();
  const session = useSession();
  return (
    <NotFound
      as={session.signedIn ? "div" : "main"}
      backLabel={t("notFound.back")}
      description={t("notFound.description")}
      homeAction={
        <Link to={session.signedIn ? "/board" : "/"}>{t("notFound.home")}</Link>
      }
      homeLabel={t("notFound.home")}
      logo={<BrandMark label={t("app.name")} />}
      title={t("notFound.title")}
    />
  );
}
