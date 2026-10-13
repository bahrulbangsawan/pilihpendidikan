// `RouteContext` — what every /api/v1 handler receives (PLAN C4).
//
//   c.request c.env c.ctx c.url     the raw request and bindings
//   c.params                         decoded path params (typed from the pattern)
//   c.body                           the validated JSON body (route `body` schema)
//   c.query / c.queryData            URLSearchParams / the validated query
//   c.caller c.scope                 ResolvedCaller and its UserScope (throw on
//                                    public routes; use c.callerOrNull there)
//   c.device                         the calling CLI device row, if any
//   c.db                             opaque JOBS_DB handle for repo functions
//   c.now c.requestId                one clock read per request; the request id
//   c.client c.clientVersion         parsed `X-Pilih-Client`
//   c.idempotency(Key)               the validated `Idempotency-Key` and hash
//   c.changeSource c.actorKind       `last_change_source` / event `actor_kind`
//   c.flags c.grantedVia             feature flags; how the scope check passed
//   c.ai()                           the AiProvider of this environment
//
// Responses:
//   c.respond(body, status?)         JSON success (no-store, X-Request-Id)
//   c.respondWithEtag(body)          200 + ETag, or 304 on If-None-Match
//   c.commit(statements, response)   ONE transactional batch = the mutation +
//                                    the idempotency row (05 §1.4); a racing
//                                    duplicate replays the winner's response
//   c.json(schema)                   validate the body against another schema
//   c.baseRevision(value)            base_revision / If-Match (05 §1.6)

import type {
  ActorKind,
  ChangeSource,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { z } from "zod";
import type { ResolvedCaller } from "../../auth";
import type { Env } from "../../env";
import type { AiProvider } from "../ai/provider";
import type { JobsDb } from "../repo/core/db";
import { runBatch, UniqueViolationError } from "../repo/core/db";
import {
  findIdempotency,
  idempotencyStatements,
} from "../repo/core/idempotency";
import type { CallerDevice } from "./device";
import { etagOf, ifNoneMatches, notModified } from "./etag";
import type { FeatureFlags } from "./flags";
import { apiError, apiJson, replayResponse } from "./http";
import { baseRevision } from "./revision";
import type { UserScope } from "./scope";
import { validateWith } from "./validate";
import type { ClientInfo } from "./version";

export interface IdempotencyInfo {
  key: string;
  requestHash: string;
}

export interface CommitResponse {
  /** JSON body; omit for 204. */
  body?: unknown;
  headers?: Record<string, string>;
  status?: number;
}

export type GrantedVia = "public" | "any" | "scope" | "alt_scope";

export interface RouteContext<
  P = Readonly<Record<string, string>>,
  B = unknown,
  Q = unknown,
> {
  readonly actorKind: ActorKind;
  readonly body: B;
  readonly caller: ResolvedCaller;
  readonly callerOrNull: ResolvedCaller | null;
  readonly changeSource: ChangeSource;
  readonly client: ClientInfo | null;
  readonly clientVersion: string | null;
  readonly ctx: ExecutionContext;
  readonly db: JobsDb;
  readonly device: CallerDevice | null;
  readonly env: Env;
  readonly flags: FeatureFlags;
  readonly grantedVia: GrantedVia;
  readonly idempotency: IdempotencyInfo | null;
  readonly idempotencyKey: string | null;
  readonly now: number;
  readonly params: P;
  readonly query: URLSearchParams;
  readonly queryData: Q;
  readonly request: Request;
  readonly requestId: string;
  readonly scope: UserScope;
  readonly url: URL;
  ai(): AiProvider;
  baseRevision(bodyValue: number | null | undefined): number;
  commit(
    statements: readonly D1PreparedStatement[],
    response: CommitResponse
  ): Promise<Response>;
  /** The statements recording `status`/`body` for this key ([] without one). */
  idempotencyStatements(status: number, body: unknown): D1PreparedStatement[];
  json<T>(schema: z.ZodType<T>): Promise<T>;
  /** Call after running `idempotencyStatements(...)` in your own batch. */
  markIdempotencyRecorded(): void;
  respond(
    body: unknown,
    status?: number,
    headers?: Record<string, string>
  ): Response;
  respondWithEtag(body: unknown, status?: number): Promise<Response>;
}

export interface ContextInit {
  ai: () => AiProvider;
  body: unknown;
  caller: ResolvedCaller | null;
  client: ClientInfo | null;
  ctx: ExecutionContext;
  db: JobsDb;
  device: CallerDevice | null;
  env: Env;
  flags: FeatureFlags;
  grantedVia: GrantedVia;
  idempotency: IdempotencyInfo | null;
  now: number;
  params: Readonly<Record<string, string>>;
  queryData: unknown;
  rawBody: unknown;
  request: Request;
  requestId: string;
  scope: UserScope | null;
  url: URL;
}

const CHANGE_SOURCE: Readonly<Record<string, ChangeSource>> = {
  browser_session: "web",
  oauth_cli: "cli",
  oauth_mcp: "mcp",
  personal_write: "web",
  personal_read: "web",
};

/** The context implementation the router builds per request. */
export class KernelContext implements RouteContext {
  readonly body: unknown;
  readonly callerOrNull: ResolvedCaller | null;
  readonly client: ClientInfo | null;
  readonly ctx: ExecutionContext;
  readonly db: JobsDb;
  readonly device: CallerDevice | null;
  readonly env: Env;
  readonly flags: FeatureFlags;
  readonly grantedVia: GrantedVia;
  readonly idempotency: IdempotencyInfo | null;
  readonly now: number;
  readonly params: Readonly<Record<string, string>>;
  readonly queryData: unknown;
  readonly request: Request;
  readonly requestId: string;
  readonly url: URL;
  /** Set once the idempotency row was written with the mutation. */
  idempotencyRecorded = false;
  /** Set when `commit` replayed a racing duplicate's stored response. */
  replayed = false;
  #committed = false;
  readonly #ai: () => AiProvider;
  readonly #rawBody: unknown;
  readonly #scope: UserScope | null;
  #provider: AiProvider | null = null;

  constructor(init: ContextInit) {
    this.request = init.request;
    this.env = init.env;
    this.ctx = init.ctx;
    this.url = init.url;
    this.params = init.params;
    this.body = init.body;
    this.queryData = init.queryData;
    this.callerOrNull = init.caller;
    this.#scope = init.scope;
    this.device = init.device;
    this.db = init.db;
    this.now = init.now;
    this.requestId = init.requestId;
    this.client = init.client;
    this.idempotency = init.idempotency;
    this.flags = init.flags;
    this.grantedVia = init.grantedVia;
    this.#ai = init.ai;
    this.#rawBody = init.rawBody;
  }

  get caller(): ResolvedCaller {
    if (!this.callerOrNull) {
      throw new Error("public route: no caller (use c.callerOrNull)");
    }
    return this.callerOrNull;
  }

  get scope(): UserScope {
    if (!this.#scope) {
      throw new Error("public route: no user scope");
    }
    return this.#scope;
  }

  get query(): URLSearchParams {
    return this.url.searchParams;
  }

  get idempotencyKey(): string | null {
    return this.idempotency?.key ?? null;
  }

  get clientVersion(): string | null {
    return this.client?.kind === "cli" ? this.client.version : null;
  }

  get changeSource(): ChangeSource {
    const kind = this.callerOrNull?.credentialKind;
    return kind ? (CHANGE_SOURCE[kind] ?? "web") : "web";
  }

  get actorKind(): ActorKind {
    return "user";
  }

  ai(): AiProvider {
    this.#provider ??= this.#ai();
    return this.#provider;
  }

  json<T>(schema: z.ZodType<T>): Promise<T> {
    return Promise.resolve(validateWith(schema, this.#rawBody, "body"));
  }

  baseRevision(bodyValue: number | null | undefined): number {
    return baseRevision(this.request, bodyValue);
  }

  respond(
    body: unknown,
    status = 200,
    headers: Record<string, string> = {}
  ): Response {
    return apiJson(body, { status, headers, requestId: this.requestId });
  }

  async respondWithEtag(body: unknown, status = 200): Promise<Response> {
    const etag = await etagOf(body);
    if (ifNoneMatches(this.request, etag)) {
      return notModified(etag, this.requestId);
    }
    return this.respond(body, status, { ETag: etag });
  }

  idempotencyStatements(status: number, body: unknown): D1PreparedStatement[] {
    if (!(this.idempotency && this.#scope)) {
      return [];
    }
    return idempotencyStatements(this.db, this.#scope, {
      key: this.idempotency.key,
      requestHash: this.idempotency.requestHash,
      status,
      body,
      now: this.now,
    });
  }

  markIdempotencyRecorded(): void {
    this.idempotencyRecorded = true;
  }

  async commit(
    statements: readonly D1PreparedStatement[],
    response: CommitResponse
  ): Promise<Response> {
    if (this.#committed) {
      throw new Error(
        "c.commit runs once per request: put every write in one batch (05 §1.4)"
      );
    }
    this.#committed = true;
    const status = response.status ?? 200;
    const idempotent = this.idempotencyStatements(status, response.body);
    try {
      await runBatch(this.db, [...statements, ...idempotent]);
    } catch (err) {
      const raced =
        err instanceof UniqueViolationError &&
        err.table === "idempotency_keys" &&
        idempotent.length > 0;
      if (!raced) {
        throw err;
      }
      return await this.replayRacedDuplicate();
    }
    this.idempotencyRecorded = idempotent.length > 0;
    return apiJson(response.body, {
      status,
      headers: response.headers,
      requestId: this.requestId,
    });
  }

  // A concurrent request with the same key committed first; this batch was
  // rolled back as a whole. Answer like a replay (05 §1.4).
  private async replayRacedDuplicate(): Promise<Response> {
    const info = this.idempotency;
    const scope = this.#scope;
    if (!(info && scope)) {
      throw new Error("replay without idempotency");
    }
    const stored = await findIdempotency(this.db, scope, info.key, this.now);
    if (!stored) {
      throw apiError(
        "idempotency_mismatch",
        "A concurrent request with this Idempotency-Key did not finish. Retry."
      );
    }
    if (stored.request_hash !== info.requestHash) {
      throw apiError(
        "idempotency_mismatch",
        "This Idempotency-Key was used for a different request."
      );
    }
    this.replayed = true;
    this.idempotencyRecorded = true;
    return replayResponse(
      stored.status_code,
      stored.response_body,
      this.requestId
    );
  }
}
