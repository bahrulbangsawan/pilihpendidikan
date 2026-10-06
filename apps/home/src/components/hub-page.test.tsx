import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServiceId, Services, ServiceStatus } from "@/config/services";
import { SERVICES } from "@/config/services";
import type { Locale } from "@/i18n";
import { getT, I18nProvider } from "@/i18n";
import en from "@/i18n/locales/en.json";
import id from "@/i18n/locales/id.json";
import { HubPage } from "./hub-page";

const LOCALES: Locale[] = ["en", "id"];
const SERVICE_IDS: ServiceId[] = ["cv", "invoice", "portfolio", "api"];
const HREF_PATTERN = /href="([^"]*)"/g;
const CAPTURE_PATTERN = /<form|<input|<textarea|<select|mailto:/i;

function withStatuses(statuses: Partial<Record<ServiceId, ServiceStatus>>) {
  const services = structuredClone(SERVICES) as unknown as Services;
  for (const [serviceId, status] of Object.entries(statuses)) {
    services[serviceId as ServiceId].status = status;
  }
  return services;
}

function render(services: Services, locale: Locale): string {
  return renderToStaticMarkup(
    <I18nProvider value={{ locale, t: getT(locale) }}>
      <HubPage services={services} />
    </I18nProvider>
  );
}

function hrefs(html: string): string[] {
  return [...html.matchAll(HREF_PATTERN)].map((match) => match[1] ?? "");
}

function linksTo(html: string, serviceUrl: string): string[] {
  const { host } = new URL(serviceUrl);
  return hrefs(html).filter((href) => href.includes(host));
}

/** The card markup for one service (`data-service="<id>"` … next card). */
function cardHtml(html: string, serviceId: ServiceId): string {
  const start = html.indexOf(`data-service="${serviceId}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf("data-service=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe("service links follow SERVICES status", () => {
  for (const locale of LOCALES) {
    for (const serviceId of SERVICE_IDS) {
      it(`${locale}: soon ${serviceId} renders no link to its host`, () => {
        const services = withStatuses({ [serviceId]: "soon" });
        const html = render(services, locale);
        expect(linksTo(html, services[serviceId].url)).toEqual([]);
        expect(cardHtml(html, serviceId)).toContain(
          getT(locale)("status.soon")
        );
      });

      it(`${locale}: live ${serviceId} renders exactly one link to its URL`, () => {
        const services = withStatuses({ [serviceId]: "live" });
        const html = render(services, locale);
        const links = linksTo(html, services[serviceId].url);
        expect(links).toHaveLength(1);
        expect(links[0]?.startsWith(services[serviceId].url)).toBe(true);
        expect(cardHtml(html, serviceId)).toContain(
          getT(locale)("status.live")
        );
      });
    }
  }

  it("a live tool on /id opens the tool's Indonesian page", () => {
    const html = render(withStatuses({ cv: "live" }), "id");
    expect(linksTo(html, SERVICES.cv.url)).toEqual([`${SERVICES.cv.url}/id`]);
  });

  it("the shipped config links exactly the live services", () => {
    for (const locale of LOCALES) {
      const html = render(SERVICES, locale);
      for (const serviceId of SERVICE_IDS) {
        const service: { status: ServiceStatus; url: string } =
          SERVICES[serviceId];
        const expected = service.status === "live" ? 1 : 0;
        expect(linksTo(html, service.url)).toHaveLength(expected);
      }
    }
  });
});

describe("MCP item", () => {
  it("hides the endpoint while the api is soon", () => {
    const html = render(withStatuses({ api: "soon" }), "en");
    expect(html).not.toContain("/mcp");
    expect(html).not.toContain("api.pilihpendidikan.com");
  });

  it("shows the endpoint and links /connect once the api is live", () => {
    const html = render(withStatuses({ api: "live" }), "en");
    expect(html).toContain("https://api.pilihpendidikan.com/mcp");
    expect(linksTo(html, SERVICES.api.url)).toEqual([
      "https://api.pilihpendidikan.com/connect",
    ]);
  });
});

describe("content", () => {
  const allLive = withStatuses({
    cv: "live",
    invoice: "live",
    portfolio: "live",
    api: "live",
  });

  it("has no forms, inputs or mailto capture in either locale", () => {
    for (const locale of LOCALES) {
      for (const services of [SERVICES, allLive]) {
        const html = render(services, locale);
        expect(html).not.toMatch(CAPTURE_PATTERN);
      }
    }
  });

  it("ships no [PLACEHOLDER] copy", () => {
    expect(JSON.stringify(en)).not.toContain("[PLACEHOLDER");
    expect(JSON.stringify(id)).not.toContain("[PLACEHOLDER");
  });

  it("has the same translation keys in English and Indonesian", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, child]) =>
            keys(child, `${prefix}${key}.`)
          )
        : [prefix];
    expect(keys(id).sort()).toEqual(keys(en).sort());
  });

  it("links to the other language", () => {
    expect(hrefs(render(SERVICES, "en"))).toContain("/id");
    expect(hrefs(render(SERVICES, "id"))).toContain("/");
  });
});
