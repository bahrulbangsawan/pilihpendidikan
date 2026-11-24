import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Check, ChevronDown, Globe, Languages } from "lucide-react";
import type { ReactNode } from "react";
import { TOOL_IDS } from "@/config/services";
import { localePath, useTranslation } from "@/i18n";

// cursor.com's footer links: 14px ink, 4.67px above and below, dimming on
// hover.
const LINK_CLASS =
  "type-body inline-block py-[4.67px] text-foreground transition-colors duration-140 ease-standard hover:text-ink-sec";

function FooterColumn({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <h2 className="type-body pb-[4.67px] text-ink-sec">{heading}</h2>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

/**
 * The footer, cursor.com's: the card colour, five 252px columns 10px apart
 * with grey headings and 14px links, then the copyright line and a language
 * pill. Nothing here links to a builder or the api host: each live service
 * is linked once, from its own card.
 */
export function HubFooter() {
  const { locale, t } = useTranslation();

  return (
    <footer className="bg-card px-5 pt-[67.2px] pb-[30px]">
      <div className="mx-auto grid max-w-rail grid-cols-2 gap-x-[10px] gap-y-10 md:grid-cols-5">
        <FooterColumn heading={t("footer.builders")}>
          {TOOL_IDS.map((id) => (
            <li key={id}>
              <a className={LINK_CLASS} href={`${localePath(locale)}#tools`}>
                {t(`services.${id}.name`)}
              </a>
            </li>
          ))}
        </FooterColumn>
        <FooterColumn heading={t("footer.onThisPage")}>
          <li>
            <a className={LINK_CLASS} href={`${localePath(locale)}#why`}>
              {t("nav.features")}
            </a>
          </li>
          <li>
            <a className={LINK_CLASS} href={`${localePath(locale)}#exports`}>
              {t("nav.exports")}
            </a>
          </li>
          <li>
            <a className={LINK_CLASS} href={`${localePath(locale)}#mcp`}>
              {t("footer.assistants")}
            </a>
          </li>
        </FooterColumn>
        <FooterColumn heading={t("footer.resources")}>
          <li>
            <a className={LINK_CLASS} href="/llms.txt">
              llms.txt
            </a>
          </li>
          <li>
            <a className={LINK_CLASS} href="/bot">
              {t("nav.crawler")}
            </a>
          </li>
          <li>
            <a className={LINK_CLASS} href={`${localePath(locale)}#mcp`}>
              {t("footer.mcp")}
            </a>
          </li>
        </FooterColumn>
        <FooterColumn heading={t("footer.language")}>
          <li>
            <a className={LINK_CLASS} href="/" lang="en">
              {t("footer.english")}
            </a>
          </li>
          <li>
            <a className={LINK_CLASS} href="/id" lang="id">
              {t("footer.indonesian")}
            </a>
          </li>
        </FooterColumn>
        <FooterColumn heading={t("footer.builtBy")}>
          <li>
            <a className={LINK_CLASS} href="https://bahrul.me">
              Bahrul Bangsawan
            </a>
          </li>
        </FooterColumn>
      </div>
      <div className="mx-auto mt-[86px] flex max-w-rail flex-wrap items-center justify-between gap-4">
        <p className="type-body flex flex-wrap gap-x-4 text-ink-sec">
          <span>{t("footer.copyright")}</span>
          <span>{t("footer.note")}</span>
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="secondary">
              <Globe aria-hidden="true" data-icon="inline-start" />
              {locale === "id" ? t("footer.indonesian") : t("footer.english")}
              <ChevronDown aria-hidden="true" data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuItem asChild>
              <a href="/" lang="en">
                <Languages aria-hidden="true" />
                {t("footer.english")}
                {locale === "en" ? (
                  <Check aria-hidden="true" className="ml-auto" />
                ) : null}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="/id" lang="id">
                <Languages aria-hidden="true" />
                {t("footer.indonesian")}
                {locale === "id" ? (
                  <Check aria-hidden="true" className="ml-auto" />
                ) : null}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </footer>
  );
}
