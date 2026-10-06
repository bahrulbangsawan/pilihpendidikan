import { describe, expect, it } from "vitest";
import type { Services } from "@/config/services";
import { SERVICES } from "@/config/services";
import { buildJsonLd, buildLlmsTxt } from "./discovery";

const SUBDOMAINS = ["cv.", "invoice.", "portfolio.", "api."];

function services(live: (keyof Services)[]): Services {
  const copy = structuredClone(SERVICES) as unknown as Services;
  for (const serviceId of live) {
    copy[serviceId].status = "live";
  }
  return copy;
}

describe("llms.txt", () => {
  it("names no subdomain while everything is soon", () => {
    const text = buildLlmsTxt(services([]));
    expect(text).toContain("https://pilihpendidikan.com");
    for (const subdomain of SUBDOMAINS) {
      expect(text).not.toContain(`${subdomain}pilihpendidikan.com`);
    }
    expect(text).not.toContain("## Tools");
  });

  it("lists only the live tool", () => {
    const text = buildLlmsTxt(services(["cv"]));
    expect(text).toContain("](https://cv.pilihpendidikan.com)");
    for (const subdomain of ["invoice.", "portfolio.", "api."]) {
      expect(text).not.toContain(`${subdomain}pilihpendidikan.com`);
    }
  });

  it("adds the MCP endpoint once the api is live", () => {
    const text = buildLlmsTxt(services(["api"]));
    expect(text).toContain("https://api.pilihpendidikan.com/mcp");
    expect(text).toContain("https://api.pilihpendidikan.com/connect");
  });
});

describe("JSON-LD", () => {
  it("lists no parts while everything is soon", () => {
    expect(buildJsonLd(services([]))).not.toHaveProperty("hasPart");
  });

  it("lists live tools as parts", () => {
    const jsonLd = buildJsonLd(services(["portfolio"]));
    expect(jsonLd.hasPart?.map((part) => part.url)).toEqual([
      "https://portfolio.pilihpendidikan.com",
    ]);
  });
});
