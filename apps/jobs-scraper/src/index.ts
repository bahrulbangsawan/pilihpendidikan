// apps/jobs-scraper Worker (job-tracker-spec/24, D-38): the `SCRAPER` service
// binding target of apps/api. It owns no data; it forwards protocol requests
// to the Python container (`ScraperContainer`) and answers 404 / 405 / 413
// for anything else. See src/routing.ts.

import { Container } from "@cloudflare/containers";
import {
  instanceName,
  MAX_BODY_BYTES,
  poolSize,
  routeRequest,
  routingKey,
} from "./routing";

interface Env {
  SCRAPER_CONTAINER: DurableObjectNamespace<ScraperContainer>;
  SCRAPER_POOL_SIZE?: string;
}

export class ScraperContainer extends Container<Env> {
  // pilih-scraper serve --host 0.0.0.0 --port 8080 (Dockerfile CMD).
  defaultPort = 8080;
  // Hourly runs: sleep between batches, wake on the next request.
  sleepAfter = "5m";
  envVars = { PILIH_SCRAPER_DATA_DIR: "/data" };

  override onError(error: unknown): unknown {
    console.error(
      JSON.stringify({
        evt: "scraper_container_error",
        error: error instanceof Error ? error.name : String(error),
      })
    );
    throw error;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = routeRequest(
      request.method,
      url.pathname,
      request.headers.get("content-length")
    );
    if (route.kind === "reject") {
      return json({ error: "not_routed" }, route.status);
    }
    const size = poolSize(env.SCRAPER_POOL_SIZE);
    if (route.kind === "health") {
      const stub = env.SCRAPER_CONTAINER.getByName(
        instanceName("health", size)
      );
      return await stub.fetch(
        new Request(new URL("/healthz", url), { method: "GET" })
      );
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return json(
        { error: "invalid_request", message: "Body is not JSON" },
        400
      );
    }
    const stub = env.SCRAPER_CONTAINER.getByName(
      instanceName(routingKey(body), size)
    );
    return await stub.fetch(
      new Request(new URL(route.path, url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      })
    );
  },
} satisfies ExportedHandler<Env>;
