import { Button } from "@rulisme/ui/ui/button";
import {
  BriefcaseBusiness,
  Eye,
  FileDown,
  FileText,
  Languages,
  LayoutTemplate,
  ReceiptText,
} from "lucide-react";
import type { Services } from "@/config/services";
import { isLive, TOOL_IDS } from "@/config/services";
import { useTranslation } from "@/i18n";
import { EditorMock } from "./editor-mock";
import { HubFooter } from "./hub-footer";
import { HubHeader } from "./hub-header";
import { PaintedBackdrop } from "./painted-backdrop";
import { McpCard, ServiceCard } from "./service-card";

// cursor.com's section: 67.2px above and below, 20px gutters, the 1300px
// container inside.
const SECTION_CLASS = "px-5 py-[67.2px]";
const CONTAINER_CLASS = "mx-auto w-full max-w-rail";

const STRIP_ITEMS = [
  { key: "cv", Icon: FileText },
  { key: "invoice", Icon: ReceiptText },
  { key: "portfolio", Icon: LayoutTemplate },
  { key: "jobs", Icon: BriefcaseBusiness },
  { key: "preview", Icon: Eye },
  { key: "pdf", Icon: FileDown },
  { key: "english", Icon: Languages },
  { key: "indonesian", Icon: Languages },
] as const;

const WHY_ITEMS = [
  "preview",
  "pdf",
  "languages",
  "templates",
  "regions",
  "browser",
] as const;

/** The hero: cursor.com's headline, two pills and the product window. */
function Hero({ anySoon }: { anySoon: boolean }) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="hero-title"
      className="px-5 pt-[112px] pb-[67.2px]"
    >
      <div className={CONTAINER_CLASS}>
        <p className="sr-only">{t("hero.title")}</p>
        <h1
          className="type-display-compact sm:type-display max-w-[440px] text-balance"
          id="hero-title"
        >
          {t("hero.headline")}
        </h1>
        <div className="mt-[22px] flex flex-wrap gap-[10px]">
          <Button asChild size="lg">
            <a href="#tools">
              {t("hero.primary")}
              <span aria-hidden="true">↓</span>
            </a>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <a href="#mcp">
              {t("hero.secondary")}
              <span aria-hidden="true">→</span>
            </a>
          </Button>
        </div>
        {anySoon && (
          <p className="type-body mt-4 max-w-xl text-pretty text-muted-foreground">
            {t("hero.rollout")}
          </p>
        )}
        <p className="sr-only">{t("hero.intro")}</p>
        <div className="relative mt-[57px] overflow-hidden rounded-sm bg-card px-4 pt-6 sm:h-[720px] sm:px-[110px] sm:pt-[50px]">
          <PaintedBackdrop />
          <EditorMock />
        </div>
      </div>
    </section>
  );
}

/** The strip under the hero: a 14px line and eight 100px tiles. */
function Strip() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="strip-heading" className="px-5 pb-[33.6px]">
      <div className={CONTAINER_CLASS}>
        <h2 className="type-body text-center" id="strip-heading">
          {t("strip.heading")}
        </h2>
        <ul className="mt-[22px] grid grid-cols-2 gap-[10px] sm:grid-cols-4 lg:grid-cols-8">
          {STRIP_ITEMS.map(({ key, Icon }) => (
            <li
              className="type-title-compact flex h-[100px] items-center justify-center gap-2 rounded-sm border border-hairline bg-card text-foreground"
              key={key}
            >
              <Icon aria-hidden="true" className="size-5 shrink-0" />
              {t(`strip.${key}`)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** A centred 36px headline over six cards, like cursor.com's quotes. */
function Why() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="why-heading" className={SECTION_CLASS}>
      <div className={CONTAINER_CLASS}>
        <h2
          className="type-headline-compact md:type-headline mx-auto max-w-[810px] text-balance text-center"
          id="why-heading"
        >
          {t("why.heading")}
        </h2>
        <ul className="mt-14 grid gap-[10px] md:grid-cols-3">
          {WHY_ITEMS.map((key) => (
            <li
              className="flex min-h-[180px] flex-col rounded-sm border border-hairline bg-card px-[17.5px] pt-[15.9px] pb-[17.5px]"
              key={key}
            >
              <h3 className="type-subtitle">{t(`why.${key}.title`)}</h3>
              <p className="type-subtitle text-pretty text-ink-sec">
                {t(`why.${key}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The hub, drawn as cursor.com's homepage: a fixed 52px header, the hero
 * with the product window, a strip of tiles, one large card per builder
 * (alternating sides, 90px apart), a centred headline over six cards, the
 * AI-assistant card, the 72px closing line and the card-coloured footer.
 */
export function HubPage({ services }: { services: Services }) {
  const { t } = useTranslation();
  const anySoon = Object.values(services).some((service) => !isLive(service));

  return (
    <div className="flex min-h-dvh flex-col pt-[52px]">
      <HubHeader />

      <main className="flex-1">
        <Hero anySoon={anySoon} />
        <Strip />

        <section
          aria-labelledby="tools-heading"
          className="scroll-mt-[52px] px-5 py-[67.2px]"
          id="tools"
        >
          <h2 className="sr-only" id="tools-heading">
            {t("tools.heading")}
          </h2>
          <ul className={`${CONTAINER_CLASS} flex flex-col gap-[90px]`}>
            {TOOL_IDS.map((id, index) => (
              <li key={id}>
                <ServiceCard
                  flip={index % 2 === 1}
                  id={id}
                  service={services[id]}
                />
              </li>
            ))}
          </ul>
        </section>

        <Why />

        <section
          aria-labelledby="mcp-heading"
          className={`${SECTION_CLASS} scroll-mt-[52px]`}
          id="mcp"
        >
          <div className={CONTAINER_CLASS}>
            <h2 className="type-title" id="mcp-heading">
              {t("services.mcp.heading")}
            </h2>
            <div className="mt-[51px]">
              <McpCard api={services.api} />
            </div>
          </div>
        </section>

        <section
          aria-labelledby="cta-heading"
          className="px-5 pt-[67.2px] pb-[134.4px]"
        >
          <div className="mx-auto max-w-[810px] text-center">
            <h2
              className="type-hero-compact sm:type-hero mb-[22.4px] text-balance"
              id="cta-heading"
            >
              {t("cta.title")}
            </h2>
            <Button asChild size="lg">
              <a href="#tools">
                {t("cta.button")}
                <span aria-hidden="true">↑</span>
              </a>
            </Button>
          </div>
        </section>
      </main>

      <HubFooter />
    </div>
  );
}
