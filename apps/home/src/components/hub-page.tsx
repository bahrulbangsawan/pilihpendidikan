import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import { Languages } from "lucide-react";
import type { Services } from "@/config/services";
import { isLive, TOOL_IDS } from "@/config/services";
import { localePath, otherLocale, useTranslation } from "@/i18n";
import { McpCard, ServiceCard } from "./service-card";

const CONTAINER_CLASS = "mx-auto w-full max-w-5xl px-4 sm:px-6";
const SECTION_HEADING_CLASS =
  "font-medium text-caption-tracked text-muted-foreground uppercase";

export function HubPage({ services }: { services: Services }) {
  const { locale, t } = useTranslation();
  const switchTo = otherLocale(locale);
  const anySoon = Object.values(services).some((service) => !isLive(service));

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-border border-b">
        <div className={`${CONTAINER_CLASS} flex h-14 items-center gap-4`}>
          <a
            className="flex items-center gap-2 font-medium text-body-sm"
            href={localePath(locale)}
          >
            <img
              alt=""
              className="size-5 rounded-sm"
              height={20}
              src="/favicon/favicon-32x32.png"
              width={20}
            />
            pilihpendidikan
          </a>
          <a
            className={`${buttonVariants({ variant: "ghost", size: "sm" })} ml-auto`}
            href={localePath(switchTo)}
            lang={switchTo}
          >
            <Languages aria-hidden="true" data-icon="inline-start" />
            {t("nav.switchLanguage")}
          </a>
        </div>
      </header>

      <main className="flex-1">
        <section className={`${CONTAINER_CLASS} py-16 sm:py-24`}>
          <h1 className="font-medium text-heading sm:text-heading-lg">
            {t("hero.title")}
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-body text-muted-foreground">
            {t("hero.intro")}
          </p>
          {anySoon && (
            <p className="mt-3 max-w-2xl text-pretty text-body-sm text-muted-foreground">
              {t("hero.rollout")}
            </p>
          )}
        </section>

        <section
          aria-labelledby="tools-heading"
          className={`${CONTAINER_CLASS} pb-12`}
        >
          <h2 className={SECTION_HEADING_CLASS} id="tools-heading">
            {t("tools.heading")}
          </h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-3">
            {TOOL_IDS.map((id) => (
              <li key={id}>
                <ServiceCard id={id} service={services[id]} />
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="mcp-heading"
          className={`${CONTAINER_CLASS} pb-16 sm:pb-24`}
        >
          <h2 className={SECTION_HEADING_CLASS} id="mcp-heading">
            {t("services.mcp.heading")}
          </h2>
          <div className="mt-4">
            <McpCard api={services.api} />
          </div>
        </section>
      </main>

      <footer className="border-border border-t">
        <div
          className={`${CONTAINER_CLASS} flex flex-wrap items-center gap-x-4 gap-y-2 py-6 text-muted-foreground text-xs`}
        >
          <p>
            {t("footer.builtBy")}{" "}
            <a
              className="text-foreground underline-offset-4 hover:underline"
              href="https://bahrul.me"
            >
              Bahrul Bangsawan
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
