// The single source of truth for what the hub links to. Flip a service to
// "live" only after its Worker is deployed and smoke-tested (DEPLOY.md →
// "Going live"), then redeploy the hub. The page, JSON-LD and /llms.txt all
// read this object; a "soon" service is never linked.

export type ServiceStatus = "soon" | "live";

export type ServiceId = "cv" | "invoice" | "portfolio" | "jobs" | "api";

export interface Service {
  status: ServiceStatus;
  url: string;
}

export type Services = Record<ServiceId, Service>;

export const SERVICES = {
  cv: { status: "live", url: "https://cv.pilihpendidikan.com" },
  invoice: { status: "live", url: "https://invoice.pilihpendidikan.com" },
  portfolio: { status: "live", url: "https://portfolio.pilihpendidikan.com" },
  jobs: { status: "soon", url: "https://jobs.pilihpendidikan.com" },
  api: { status: "live", url: "https://api.pilihpendidikan.com" },
} as const satisfies Services;

/**
 * The tools, in display order: the three document builders and the job
 * tracker (job-tracker-spec 12 §15). `api` is shown as the MCP item.
 */
export const TOOL_IDS = ["cv", "invoice", "portfolio", "jobs"] as const;

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
