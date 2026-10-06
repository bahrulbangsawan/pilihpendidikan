// Machine-readable descriptions of the hub, built from the service config so
// they never mention a service that is not live.

import type { Services, ToolId } from "@/config/services";
import { connectUrl, isLive, mcpEndpoint, TOOL_IDS } from "@/config/services";
import { BASE_URL, getT } from "@/i18n";

const AUTHOR = {
  "@type": "Person",
  name: "Bahrul Bangsawan",
  url: "https://bahrul.me",
} as const;

function liveToolIds(services: Services): ToolId[] {
  return TOOL_IDS.filter((id) => isLive(services[id]));
}

/** `/llms.txt`: the hub, plus only the services that are live. */
export function buildLlmsTxt(services: Services): string {
  const t = getT("en");
  const lines = [
    `# ${t("meta.siteName")}`,
    "",
    `> ${t("hero.intro")}`,
    "",
    "## Pages",
    "",
    `- [${t("meta.siteName")} (English)](${BASE_URL}): ${t("meta.description")}`,
    `- [${t("meta.siteName")} (Bahasa Indonesia)](${BASE_URL}/id): Indonesian version of this page.`,
  ];

  const tools = liveToolIds(services);
  const api = services.api;
  if (tools.length > 0 || isLive(api)) {
    lines.push("", "## Tools", "");
    for (const id of tools) {
      lines.push(
        `- [${t(`services.${id}.name`)}](${services[id].url}): ${t(`services.${id}.description`)} Indonesian at ${services[id].url}/id.`
      );
    }
    if (isLive(api)) {
      lines.push(
        `- [${t("services.mcp.name")}](${mcpEndpoint(api)}): ${t("services.mcp.description")} Personal tokens: ${connectUrl(api)}.`
      );
    }
  }

  lines.push("", "## Author", "", `- ${AUTHOR.name}: ${AUTHOR.url}`, "");
  return lines.join("\n");
}

/** JSON-LD for the hub page; live builders are listed as parts of the site. */
export function buildJsonLd(services: Services) {
  const t = getT("en");
  const parts = liveToolIds(services).map((id) => ({
    "@type": "SoftwareApplication",
    name: t(`services.${id}.name`),
    description: t(`services.${id}.description`),
    url: services[id].url,
    applicationCategory: "BusinessApplication",
    operatingSystem: "All",
  }));
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: t("meta.siteName"),
    description: t("meta.description"),
    url: BASE_URL,
    inLanguage: ["en", "id"],
    author: AUTHOR,
    ...(parts.length > 0 ? { hasPart: parts } : {}),
  };
}
