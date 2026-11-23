import { cn } from "@rulisme/ui/lib/utils";
import { Badge } from "@rulisme/ui/ui/badge";
import type { ReactNode } from "react";
import type { Service, ToolId } from "@/config/services";
import { connectUrl, isLive, mcpEndpoint } from "@/config/services";
import { useTranslation } from "@/i18n";

// cursor.com's large feature card: the card colour, a 4px radius, a 2.5%
// hairline, 17.5px padding, 24 columns with 10px gaps. The copy (383px)
// sits centred against a 16-column media panel.
const LARGE_CARD_CLASS =
  "grid grid-cols-1 gap-x-[10px] gap-y-6 rounded-sm border border-hairline bg-card p-[17.5px] lg:grid-cols-24";

// cursor.com's text link: orange, dims to 75% on hover, ends in →.
export const TEXT_LINK_CLASS =
  "type-subtitle inline-flex items-center gap-1 text-link transition-colors duration-140 ease-standard hover:text-link/75";

/** Copy block of a large card: title, grey continuation, the link. */
function FeatureCopy({
  title,
  body,
  children,
  flip,
}: {
  title: string;
  body: string;
  children?: ReactNode;
  flip: boolean;
}) {
  return (
    <div
      className={cn(
        "flex max-w-[383px] flex-col justify-center px-[2.5px] lg:col-span-8 lg:row-start-1",
        flip ? "lg:col-start-17 lg:pl-[30px]" : "lg:col-start-1"
      )}
    >
      <h3 className="type-subtitle md:type-title text-pretty">{title}</h3>
      <p className="type-subtitle md:type-title text-pretty text-ink-sec">
        {body}
      </p>
      {children}
    </div>
  );
}

/** Media panel of a large card: 16 of 24 columns, 680px tall on desktop. */
const STAGES = ["bg-stage-warm", "bg-stage-stone", "bg-pane-2"] as const;

function FeatureMedia({
  children,
  flip,
  stage = 2,
}: {
  children: ReactNode;
  flip: boolean;
  stage?: number;
}) {
  return (
    <div
      className={cn(
        "relative h-[360px] overflow-hidden rounded-xs lg:col-span-16 lg:row-start-1 lg:h-[680px]",
        STAGES[stage % STAGES.length],
        flip ? "lg:col-start-1" : "lg:col-start-9"
      )}
    >
      {children}
    </div>
  );
}

/**
 * One builder as a cursor.com feature card. A "soon" service renders no link
 * at all — not a disabled anchor — so the hub never points at a subdomain
 * that isn't serving; a live one links exactly once.
 */
export function ServiceCard({
  id,
  service,
  flip,
  stage,
}: {
  id: ToolId;
  service: Service;
  flip: boolean;
  stage: number;
}) {
  const { locale, t } = useTranslation();
  const live = isLive(service);
  const name = t(`services.${id}.name`);
  // The builders are bilingual too: English at `/`, Indonesian at `/id`.
  const href = locale === "id" ? `${service.url}/id` : service.url;

  return (
    <div
      className={LARGE_CARD_CLASS}
      data-service={id}
      data-status={service.status}
    >
      <FeatureCopy
        body={t(`services.${id}.description`)}
        flip={flip}
        title={name}
      >
        {live ? (
          <>
            <span className="sr-only">{t("status.live")}</span>
            <a
              className={cn(TEXT_LINK_CLASS, "mt-[14.9px] self-start")}
              href={href}
            >
              {t(`features.${id}.cta`)}
              <span aria-hidden="true">→</span>
            </a>
          </>
        ) : (
          <Badge className="mt-[14.9px]" variant="secondary">
            {t("status.soon")}
          </Badge>
        )}
      </FeatureCopy>
      <FeatureMedia flip={flip} stage={stage}>
        <figure className="absolute top-8 left-8 w-[1000px] overflow-hidden rounded-lg border border-border bg-card shadow-lg lg:top-10">
          <figcaption className="grid h-7 grid-cols-[1fr_auto_1fr] items-center gap-3 border-border border-b px-3">
            <span aria-hidden="true" className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-pane-3" />
              <span className="size-2.5 rounded-full bg-pane-3" />
              <span className="size-2.5 rounded-full bg-pane-3" />
            </span>
            <span className="type-caption truncate text-ink-sec">
              {t("features.windowTitle").replace("{{name}}", name)}
            </span>
          </figcaption>
          <img
            alt={t("features.shotAlt").replace("{{name}}", name)}
            className="block h-auto w-full"
            decoding="async"
            height={620}
            loading="lazy"
            src={`/shots/${id}.webp`}
            width={1000}
          />
        </figure>
      </FeatureMedia>
    </div>
  );
}

/**
 * MCP / AI-assistant access, gated on the api Worker. While the api is "soon"
 * it shows neither the endpoint nor any link to the api host.
 */
export function McpCard({ api }: { api: Service }) {
  const { t } = useTranslation();
  const live = isLive(api);
  const endpoint = mcpEndpoint(api);

  return (
    <div
      className={LARGE_CARD_CLASS}
      data-service="api"
      data-status={api.status}
    >
      <FeatureCopy
        body={t("services.mcp.description")}
        flip={false}
        title={t("services.mcp.name")}
      >
        {live ? (
          <>
            <span className="sr-only">{t("status.live")}</span>
            <p className="mt-[22.4px] flex min-w-0 items-center rounded-sm bg-pane px-2.5 py-2">
              <span className="sr-only">
                {t("services.mcp.endpointLabel")}:{" "}
              </span>
              <code className="type-body truncate">{endpoint}</code>
            </p>
            <a
              className={cn(TEXT_LINK_CLASS, "mt-[14.9px] self-start")}
              href={connectUrl(api)}
            >
              {t("services.mcp.connect")}
              <span aria-hidden="true">↗</span>
            </a>
          </>
        ) : (
          <Badge className="mt-[14.9px] self-start" variant="secondary">
            {t("status.soon")}
          </Badge>
        )}
      </FeatureCopy>
      <FeatureMedia flip={false}>
        {live && (
          <figure className="absolute top-8 right-8 left-8 overflow-hidden rounded-lg border border-border bg-background shadow-lg lg:top-10 lg:right-auto lg:w-[620px]">
            <figcaption className="type-caption border-border border-b px-3 py-2 text-center text-muted-foreground">
              {t("mcpSection.configLabel")}
            </figcaption>
            <pre className="type-body overflow-x-auto p-4 text-foreground">
              {`{
  "mcpServers": {
    "pilihpendidikan": {
      "url": "${endpoint}"
    }
  }
}`}
            </pre>
          </figure>
        )}
      </FeatureMedia>
    </div>
  );
}
