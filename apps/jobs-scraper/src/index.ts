// apps/jobs-scraper Worker (job-tracker-spec/24, D-38): the `SCRAPER` service
// binding target of apps/api. It owns no data; it forwards protocol requests
// to the Python container (`ScraperContainer`) and answers 404 / 405 / 413
// for anything else. See src/routing.ts.

import { Container } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";
import { boundaryOf, nextAlarmAt, ticksFor } from "./clock";
import {
  instanceName,
  MAX_BODY_BYTES,
  poolSize,
  routeRequest,
  routingKey,
} from "./routing";

/** The api's private RPC entrypoint `CloudScheduler` (apps/api). */
interface CloudSchedulerRpc {
  tick(cron: string): Promise<{ failed: string[]; ran: string[] }>;
}

interface Env {
  API?: CloudSchedulerRpc;
  DISPATCH_CLOCK: DurableObjectNamespace<DispatchClock>;
  SCRAPER_CONTAINER: DurableObjectNamespace<ScraperContainer>;
  SCRAPER_POOL_SIZE?: string;
}

interface ClockState {
  armed_for: number | null;
  last_boundary: number | null;
  last_error: string | null;
  last_ran: string[];
  last_tick_at: number | null;
}

/**
 * The scheduler fallback (24 §6.6): one Durable Object whose alarm fires 30 s
 * after every 5-minute boundary and ticks the api's 5-minute and hourly
 * schedules through the `API` RPC binding. Alarms do not depend on Cron
 * Trigger activation, which failed for the api Worker (Cloudflare incident,
 * 2026-10-13/14). The alarm always re-arms itself, even when a tick fails.
 */
export class DispatchClock extends DurableObject<Env> {
  async ensure(): Promise<ClockState> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null) {
      await this.ctx.storage.setAlarm(nextAlarmAt(Date.now()));
    }
    return await this.status();
  }

  async status(): Promise<ClockState> {
    const last = (await this.ctx.storage.get<Omit<ClockState, "armed_for">>(
      "last"
    )) ?? {
      last_boundary: null,
      last_tick_at: null,
      last_ran: [],
      last_error: null,
    };
    return { armed_for: await this.ctx.storage.getAlarm(), ...last };
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const boundary = boundaryOf(now);
    const ran: string[] = [];
    let lastError: string | null = null;
    try {
      if (!this.env.API) {
        throw new Error("the API service binding is missing");
      }
      for (const cron of ticksFor(boundary)) {
        try {
          const report = await this.env.API.tick(cron);
          ran.push(...report.ran);
          if (report.failed.length > 0) {
            lastError = `${cron}: ${report.failed.join(", ")} failed`;
          }
        } catch (err) {
          lastError = `${cron}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      await this.ctx.storage.put("last", {
        last_boundary: boundary,
        last_tick_at: now,
        last_ran: ran,
        last_error: lastError,
      });
      await this.ctx.storage.setAlarm(nextAlarmAt(Date.now()));
    }
    console.log(
      JSON.stringify({
        evt: "scheduler_clock_tick",
        boundary: new Date(boundary).toISOString(),
        ran,
        error: lastError,
      })
    );
  }
}

function clockStub(env: Env) {
  return env.DISPATCH_CLOCK.getByName("scheduler");
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
    if (route.kind === "clock") {
      const stub = clockStub(env);
      const state =
        route.action === "ensure" ? await stub.ensure() : await stub.status();
      return json(state, 200);
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
  // Watchdog: re-arms the clock should its alarm ever be lost. The clock, not
  // this cron, ticks the api (a Cron Trigger may not be dispatched at all).
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await clockStub(env).ensure();
  },
} satisfies ExportedHandler<Env>;
