import { badgeVariants } from "@rulisme/ui/ui/badge-variants";
import { buttonVariants } from "@rulisme/ui/ui/button-variants";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@rulisme/ui/ui/card";
import { ArrowUpRight } from "lucide-react";
import type { Service, ToolId } from "@/config/services";
import { connectUrl, isLive, mcpEndpoint } from "@/config/services";
import { useTranslation } from "@/i18n";

const CARD_CLASS = "h-full gap-3 py-5";
const CARD_HEADER_CLASS = "px-5";
const CARD_BODY_CLASS = "px-5";

function StatusBadge({ live }: { live: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={badgeVariants({ variant: live ? "secondary" : "outline" })}
      data-slot="status-badge"
    >
      {live ? t("status.live") : t("status.soon")}
    </span>
  );
}

/**
 * One builder. A "soon" service renders no link at all — not a disabled
 * anchor — so the hub never points at a subdomain that isn't serving.
 */
export function ServiceCard({ id, service }: { id: ToolId; service: Service }) {
  const { locale, t } = useTranslation();
  const live = isLive(service);
  const name = t(`services.${id}.name`);
  // The builders are bilingual too: English at `/`, Indonesian at `/id`.
  const href = locale === "id" ? `${service.url}/id` : service.url;

  return (
    <Card className={CARD_CLASS} data-service={id} data-status={service.status}>
      <CardHeader className={CARD_HEADER_CLASS}>
        <CardTitle className="text-subheading">
          <h3>{name}</h3>
        </CardTitle>
        <CardAction>
          <StatusBadge live={live} />
        </CardAction>
      </CardHeader>
      <CardDescription className={`${CARD_BODY_CLASS} flex-1 text-body-sm`}>
        <p>{t(`services.${id}.description`)}</p>
      </CardDescription>
      {live && (
        <CardFooter className={`${CARD_BODY_CLASS} pt-2`}>
          <a className={buttonVariants({ size: "lg" })} href={href}>
            {t("status.open")}
            <span className="sr-only"> {name}</span>
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
          </a>
        </CardFooter>
      )}
    </Card>
  );
}

/**
 * MCP / AI-assistant access, gated on the api Worker. While the api is "soon"
 * it shows neither the endpoint nor any link to the api host.
 */
export function McpCard({ api }: { api: Service }) {
  const { t } = useTranslation();
  const live = isLive(api);

  return (
    <Card className={CARD_CLASS} data-service="api" data-status={api.status}>
      <CardHeader className={CARD_HEADER_CLASS}>
        <CardTitle className="text-subheading">
          <h3>{t("services.mcp.name")}</h3>
        </CardTitle>
        <CardAction>
          <StatusBadge live={live} />
        </CardAction>
      </CardHeader>
      <CardDescription className={`${CARD_BODY_CLASS} text-body-sm`}>
        <p>{t("services.mcp.description")}</p>
      </CardDescription>
      {live && (
        <CardFooter
          className={`${CARD_BODY_CLASS} flex-wrap items-center gap-3 pt-2`}
        >
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground text-xs">
            {t("services.mcp.endpointLabel")}
            <code className="break-all rounded-md bg-muted px-2 py-1 font-mono text-foreground text-xs">
              {mcpEndpoint(api)}
            </code>
          </p>
          <a
            className={buttonVariants({ size: "lg", variant: "outline" })}
            href={connectUrl(api)}
          >
            {t("services.mcp.connect")}
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
          </a>
        </CardFooter>
      )}
    </Card>
  );
}
