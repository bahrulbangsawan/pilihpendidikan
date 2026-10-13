import { Band, Rail } from "@rulisme/ui/ui/rails";
import type { ReactNode } from "react";
import type { Services } from "@/config/services";
import { isLive, TOOL_IDS } from "@/config/services";
import { useTranslation } from "@/i18n";
import { EditorMock } from "./editor-mock";
import { HubFooter } from "./hub-footer";
import { HubHeader } from "./hub-header";
import { McpCard, ServiceCard } from "./service-card";

// Inner padding of the ruled column (DESIGN.md § Layout).
const GUTTER_CLASS = "px-5 sm:px-10";

/** A section head on its own band: a left-aligned title-role heading. */
function SectionHead({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Band>
      <Rail className={`${GUTTER_CLASS} pt-12 pb-5`}>
        <h2 className="type-title" id={id}>
          {children}
        </h2>
      </Rail>
    </Band>
  );
}

/**
 * The hub, drawn as Zedative's homepage (DESIGN.md § Layout, § Components):
 * full-bleed bands ruled by hairlines around the 1120px column, diamond nodes
 * where the rules cross, the hero on graph paper with the product shown as an
 * editor window, the builders as butted cells, and the cobalt footer slab.
 */
export function HubPage({ services }: { services: Services }) {
  const { t } = useTranslation();
  const anySoon = Object.values(services).some((service) => !isLive(service));
  const allToolsLive = TOOL_IDS.every((id) => isLive(services[id]));

  return (
    <div className="flex min-h-dvh flex-col">
      <HubHeader allToolsLive={allToolsLive} />

      <main className="flex-1">
        <Band asChild className="graph-paper">
          <section aria-labelledby="hero-title">
            <Rail className={`${GUTTER_CLASS} flex flex-col items-start pt-28`}>
              <h1
                className="type-display max-w-2xl text-primary italic"
                id="hero-title"
              >
                {t("hero.title")}
              </h1>
              <p className="type-subtitle mt-4 max-w-xl text-pretty">
                {t("hero.intro")}
              </p>
              {anySoon && (
                <p className="type-caption mt-3 max-w-xl text-pretty text-muted-foreground">
                  {t("hero.rollout")}
                </p>
              )}
              <EditorMock className="mt-12" />
            </Rail>
          </section>
        </Band>

        <section aria-labelledby="tools-heading" id="tools">
          <SectionHead id="tools-heading">{t("tools.heading")}</SectionHead>
          <Band>
            <Rail asChild>
              {/* Four tools: one column on phones, 2 × 2 on tablets, one row
                  from lg. The hairlines follow the grid at each step. */}
              <ul className="grid sm:grid-cols-2 lg:grid-cols-4">
                {TOOL_IDS.map((id) => (
                  <li
                    className="border-line border-b last:border-b-0 sm:odd:border-r lg:border-r lg:border-b-0 lg:last:border-r-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
                    key={id}
                  >
                    <ServiceCard id={id} service={services[id]} />
                  </li>
                ))}
              </ul>
            </Rail>
          </Band>
        </section>

        <section aria-labelledby="mcp-heading" id="mcp">
          <SectionHead id="mcp-heading">
            {t("services.mcp.heading")}
          </SectionHead>
          <Band>
            <Rail>
              <McpCard api={services.api} />
            </Rail>
          </Band>
        </section>
      </main>

      <HubFooter />
    </div>
  );
}
