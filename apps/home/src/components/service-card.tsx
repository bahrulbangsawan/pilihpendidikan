import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { ArrowUpRight } from "lucide-react";
import type { Service, ToolId } from "@/config/services";
import { connectUrl, isLive, mcpEndpoint } from "@/config/services";
import { useTranslation } from "@/i18n";

// The single-letter shortcut behind each action's <Kbd> hint (DESIGN.md
// § Components). A key is registered only while its service is live, so a
// hint never shows without a working shortcut.
const TOOL_SHORTCUTS: Record<ToolId, string> = {
  cv: "C",
  invoice: "I",
  portfolio: "P",
};
const MCP_SHORTCUT = "M";

// A butted cell in the ruled column (DESIGN.md § Layout), not a floating
// card: the hub's grid draws the hairlines between cells.
const CELL_CLASS = "flex h-full flex-col gap-3 px-5 py-8 sm:px-10";

/** Same-tab navigation, exactly what a click on the action's link does. */
function navigateTo(href: string) {
  window.location.assign(href);
}

function CellHeader({ title, live }: { title: string; live: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-3">
      <h3 className="type-subtitle weight-semibold">{title}</h3>
      <Badge className="shrink-0" variant={live ? "secondary" : "outline"}>
        {live ? t("status.live") : t("status.soon")}
      </Badge>
    </div>
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
  const shortcut = TOOL_SHORTCUTS[id];
  useShortcut(shortcut, () => navigateTo(href), live);

  return (
    <div className={CELL_CLASS} data-service={id} data-status={service.status}>
      <CellHeader live={live} title={name} />
      <p className="type-body flex-1 text-pretty">
        {t(`services.${id}.description`)}
      </p>
      {live && (
        <Button asChild className="self-start" variant="outline">
          <a aria-keyshortcuts={shortcut} href={href}>
            {t("status.open")}
            <span className="sr-only"> {name}</span>
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
            <Kbd aria-hidden="true">{shortcut}</Kbd>
          </a>
        </Button>
      )}
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
  useShortcut(MCP_SHORTCUT, () => navigateTo(connectUrl(api)), live);

  return (
    <div className={CELL_CLASS} data-service="api" data-status={api.status}>
      <CellHeader live={live} title={t("services.mcp.name")} />
      <p className="type-body max-w-2xl text-pretty">
        {t("services.mcp.description")}
      </p>
      {live && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-1">
          <p className="type-caption flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground">
            {t("services.mcp.endpointLabel")}
            <code className="type-caption break-all rounded-sm bg-muted px-1.5 text-foreground">
              {mcpEndpoint(api)}
            </code>
          </p>
          <Button asChild variant="outline">
            <a aria-keyshortcuts={MCP_SHORTCUT} href={connectUrl(api)}>
              {t("services.mcp.connect")}
              <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
              <Kbd aria-hidden="true">{MCP_SHORTCUT}</Kbd>
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
