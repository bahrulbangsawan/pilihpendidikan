// The single source of truth for what the hub links to. Flip a service to
// "live" only after its Worker is deployed and smoke-tested (DEPLOY.md →
// "Going live"), then redeploy the hub. The page, JSON-LD and /llms.txt all
// read this object; a "soon" service is never linked.

export type ServiceStatus = "soon" | "live";

export type ServiceId = "cv" | "invoice" | "portfolio" | "api";

export interface Service {
  status: ServiceStatus;
  url: string;
}

export type Services = Record<ServiceId, Service>;

export const SERVICES = {
  cv: { status: "soon", url: "https://cv.pilihpendidikan.com" },
  invoice: { status: "soon", url: "https://invoice.pilihpendidikan.com" },
  portfolio: { status: "soon", url: "https://portfolio.pilihpendidikan.com" },
  api: { status: "soon", url: "https://api.pilihpendidikan.com" },
} as const satisfies Services;

/** The document builders, in display order. `api` is shown as the MCP item. */
export const TOOL_IDS = ["cv", "invoice", "portfolio"] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export function isLive(service: Service): boolean {
  return service.status === "live";
}

/** MCP endpoint served by the api Worker (`/mcp`, Streamable HTTP). */
export function mcpEndpoint(api: Service): string {
  return `${api.url}/mcp`;
}

/** Page where a signed-in user mints a personal token for MCP clients. */
export function connectUrl(api: Service): string {
  return `${api.url}/connect`;
}
