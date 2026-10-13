// Users sign in through the real e-mail link flow (`/auth/request` → the
// link the local EMAIL binding printed → `POST /auth/verify`). The browser
// session bearer that flow sets as the `session` cookie is what the dashboard
// BFF holds, so `WebUser` calls `/api/v1` exactly as `apps/jobs` does.
import type { ApiServer } from "./api";
import { fakeClientIp, uniqueEmail } from "./env";

const SESSION_COOKIE = /(?:^|\s)(?:__Host-)?session=([^;]+)/;

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

export interface CallOptions {
  idempotencyKey?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

let keyCounter = 0;
export function newKey(label = "e2e"): string {
  keyCounter += 1;
  return `${label}-${Date.now().toString(36)}-${keyCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A bearer-authenticated client of `/api/v1`. */
export class Client {
  readonly base: string;
  readonly bearer: string | null;
  readonly extraHeaders: Record<string, string>;

  constructor(
    base: string,
    bearer: string | null,
    extraHeaders: Record<string, string> = {}
  ) {
    this.base = base;
    this.bearer = bearer;
    this.extraHeaders = extraHeaders;
  }

  async call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    opts: CallOptions = {}
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      accept: "application/json",
      ...this.extraHeaders,
      ...opts.headers,
    };
    if (this.bearer) {
      headers.authorization = `Bearer ${this.bearer}`;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (opts.idempotencyKey) {
      headers["idempotency-key"] = opts.idempotencyKey;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = Record<string, unknown>>(path: string, opts?: CallOptions) {
    return this.call<T>("GET", path, undefined, opts);
  }

  post<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    opts?: CallOptions
  ) {
    return this.call<T>("POST", path, body ?? {}, opts);
  }

  patch<T = Record<string, unknown>>(
    path: string,
    body: unknown,
    opts?: CallOptions
  ) {
    return this.call<T>("PATCH", path, body, opts);
  }

  put<T = Record<string, unknown>>(
    path: string,
    body: unknown,
    opts?: CallOptions
  ) {
    return this.call<T>("PUT", path, body, opts);
  }

  delete<T = Record<string, unknown>>(path: string, opts?: CallOptions) {
    return this.call<T>("DELETE", path, undefined, opts);
  }

  /** Like `call` but throws unless the status is one of `ok`. */
  async ok<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    opts: CallOptions & { ok?: number[] } = {}
  ): Promise<T> {
    const res = await this.call<T>(method, path, body, opts);
    const expected = opts.ok ?? [200, 201, 202, 204];
    if (!expected.includes(res.status)) {
      throw new Error(
        `${method} ${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 800)}`
      );
    }
    return res.body;
  }
}

export interface WebUser {
  email: string;
  /** The browser session bearer (the `session` cookie value). */
  session: string;
  userId: string;
  api: Client;
  server: ApiServer;
}

export interface SignInOptions {
  email?: string;
  /** An app origin to return to with `?code=` (the dashboard's flow). */
  returnTo?: string;
}

/** Requests a sign-in link and returns the token from the printed e-mail. */
export async function requestLink(
  server: ApiServer,
  email: string,
  returnTo?: string
): Promise<string> {
  const res = await fetch(`${server.origin}/auth/request`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": fakeClientIp(),
    },
    body: JSON.stringify(returnTo ? { email, returnTo } : { email }),
  });
  if (res.status !== 200) {
    throw new Error(`/auth/request → ${res.status} ${await res.text()}`);
  }
  const mail = await server.waitForMail(email);
  return mail.link;
}

/** Signs a user in through the e-mail link and returns the web-session client. */
export async function signIn(
  server: ApiServer,
  options: SignInOptions = {}
): Promise<WebUser> {
  const email = options.email ?? uniqueEmail("user");
  const link = await requestLink(server, email, options.returnTo);
  const token = new URL(link).searchParams.get("t");
  if (!token) {
    throw new Error(`no token in the sign-in link ${link}`);
  }
  const verify = await fetch(`${server.origin}/auth/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: server.origin,
    },
    body: new URLSearchParams({ t: token }).toString(),
    redirect: "manual",
  });
  if (verify.status !== 303) {
    throw new Error(`/auth/verify → ${verify.status} ${await verify.text()}`);
  }
  const cookie = verify.headers.get("set-cookie") ?? "";
  const session = SESSION_COOKIE.exec(cookie)?.[1];
  if (!session) {
    throw new Error(`no session cookie in ${cookie}`);
  }
  const api = new Client(server.origin, session);
  const me = await api.ok<{ user_id: string }>("GET", "/api/v1/me");
  return { email, session, userId: me.user_id, api, server };
}
