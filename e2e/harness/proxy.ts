// A recording HTTP proxy between one CLI home and the api. It is the
// "network" of the scenarios: it records every exchange (status, the
// `Idempotent-Replayed` header, JSON bodies), can go offline (every request is
// answered by a reset connection), can drop a response after the api
// committed it (a lost ack), and can run hooks before or after an exchange
// (kill the CLI at an exact protocol step). The api sees
// `X-Forwarded-Host: localhost:<proxy port>`, so the OAuth issuer, the token
// endpoint and every link it publishes point back through the proxy.
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { freePort } from "./env";

export interface Exchange {
  id: number;
  at: number;
  method: string;
  path: string;
  query: string;
  requestHeaders: Record<string, string>;
  requestJson: unknown;
  status: number | null;
  responseHeaders: Record<string, string>;
  responseJson: unknown;
  replayed: boolean;
  /** `dropped` = the api answered but the client saw a reset connection. */
  outcome: "ok" | "offline" | "dropped" | "upstream_error";
}

export type Matcher = (method: string, path: string) => boolean;

export interface Hook {
  match: Matcher;
  /** Runs before forwarding. Return "drop" to reset the connection unforwarded. */
  before?: (ex: Exchange) => Promise<"drop" | undefined> | "drop" | undefined;
  /** Runs after the api answered. Return "drop" to lose the response. */
  after?: (ex: Exchange) => Promise<"drop" | undefined> | "drop" | undefined;
  /** Runs once the answer was written to the client. */
  afterDelivered?: (ex: Exchange) => void;
  /** Remove the hook after it fired once. */
  once?: boolean;
}

/** `route("POST", /\/lease\/[^/]+\/heartbeat$/)` */
export function route(method: string, path: RegExp): Matcher {
  return (m, p) => m === method && path.test(p);
}

function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  }
}

function headerRecord(
  headers: IncomingMessage["headers"] | Headers
): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      out[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  return out;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "te",
  "trailer",
  "content-length",
  "content-encoding",
  "host",
]);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** The client sees a reset connection; the exchange records why. */
function reset(
  req: IncomingMessage,
  ex: Exchange,
  outcome: Exchange["outcome"]
): void {
  ex.outcome = outcome;
  req.socket.destroy();
}

function deliver(
  res: ServerResponse,
  upstream: Response,
  payload: Buffer
): void {
  const out: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key) && key !== "set-cookie") {
      out[key] = value;
    }
  });
  const cookies = upstream.headers.getSetCookie?.() ?? [];
  res.writeHead(upstream.status, {
    ...out,
    ...(cookies.length > 0 ? { "set-cookie": cookies } : {}),
    "content-length": String(payload.length),
  });
  res.end(payload);
}

export class ApiProxy {
  readonly port: number;
  readonly origin: string;
  upstream: string;
  readonly log: Exchange[] = [];
  offline = false;
  private hooks: Hook[] = [];
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private nextId = 1;

  private constructor(port: number, upstream: string) {
    this.port = port;
    this.origin = `http://localhost:${port}`;
    this.upstream = upstream;
  }

  static async start(
    upstream: string,
    opts: { port?: number } = {}
  ): Promise<ApiProxy> {
    const proxy = new ApiProxy(opts.port ?? (await freePort()), upstream);
    await proxy.listen();
    return proxy;
  }

  private listen(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        req.socket.destroy();
      });
    });
    server.keepAliveTimeout = 1000;
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      // No host: dual-stack, so `localhost` works over IPv4 and IPv6.
      server.listen(this.port, () => resolve());
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const socket of this.sockets) {
      socket.destroy();
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  /** Every request fails as if the network were down (connections reset). */
  goOffline(): void {
    this.offline = true;
    for (const socket of this.sockets) {
      socket.destroy();
    }
  }

  goOnline(): void {
    this.offline = false;
  }

  addHook(hook: Hook): () => void {
    this.hooks.push(hook);
    return () => {
      this.hooks = this.hooks.filter((h) => h !== hook);
    };
  }

  clearHooks(): void {
    this.hooks = [];
  }

  /** Exchanges matching a method and path pattern. */
  find(method: string, path: RegExp): Exchange[] {
    return this.log.filter((e) => e.method === method && path.test(e.path));
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://proxy.invalid");
    const body = await readBody(req);
    const ex = this.record(req, url, body);
    if (this.offline) {
      reset(req, ex, "offline");
      return;
    }
    const hooks = this.hooks.filter((h) => h.match(ex.method, ex.path));
    if (await this.runBefore(hooks, ex)) {
      reset(req, ex, "dropped");
      return;
    }
    if (this.offline) {
      reset(req, ex, "offline");
      return;
    }
    const upstream = await this.forward(ex, url, body);
    if (!upstream) {
      reset(req, ex, "upstream_error");
      return;
    }
    const payload = Buffer.from(await upstream.arrayBuffer());
    ex.status = upstream.status;
    ex.responseHeaders = headerRecord(upstream.headers);
    ex.replayed = upstream.headers.get("idempotent-replayed") === "true";
    if ((upstream.headers.get("content-type") ?? "").includes("json")) {
      ex.responseJson = parseJson(payload.toString("utf8"));
    }
    for (const hook of hooks) {
      if (hook.after && (await hook.after(ex)) === "drop") {
        reset(req, ex, "dropped");
        return;
      }
    }
    if (this.offline) {
      reset(req, ex, "offline");
      return;
    }
    deliver(res, upstream, payload);
    for (const hook of hooks) {
      hook.afterDelivered?.(ex);
    }
  }

  private record(req: IncomingMessage, url: URL, body: Buffer): Exchange {
    const requestHeaders = headerRecord(req.headers);
    const isJson = (requestHeaders["content-type"] ?? "").includes("json");
    let requestJson: unknown = null;
    if (isJson) {
      requestJson = parseJson(body.toString("utf8"));
    } else if (body.length > 0) {
      requestJson = `raw:${body.subarray(0, 1500).toString("latin1")}`;
    }
    const ex: Exchange = {
      id: this.nextId++,
      at: Date.now(),
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.search,
      requestHeaders,
      requestJson,
      status: null,
      responseHeaders: {},
      responseJson: null,
      replayed: false,
      outcome: "ok",
    };
    this.log.push(ex);
    return ex;
  }

  /** Runs the `before` hooks; true when one dropped the request. */
  private async runBefore(hooks: Hook[], ex: Exchange): Promise<boolean> {
    for (const hook of hooks) {
      if (hook.once) {
        this.hooks = this.hooks.filter((h) => h !== hook);
      }
      if (hook.before && (await hook.before(ex)) === "drop") {
        return true;
      }
    }
    return false;
  }

  private async forward(
    ex: Exchange,
    url: URL,
    body: Buffer
  ): Promise<Response | null> {
    const headers = new Headers();
    for (const [key, value] of Object.entries(ex.requestHeaders)) {
      if (!HOP_BY_HOP.has(key)) {
        headers.set(key, value);
      }
    }
    headers.set("x-forwarded-host", `localhost:${this.port}`);
    const bodyless = ex.method === "GET" || ex.method === "HEAD";
    try {
      return await fetch(
        new URL(`${url.pathname}${url.search}`, this.upstream),
        {
          method: ex.method,
          headers,
          body: bodyless ? undefined : new Uint8Array(body),
          redirect: "manual",
        }
      );
    } catch {
      return null;
    }
  }
}
