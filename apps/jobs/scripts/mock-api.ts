// A local stand-in for the api Worker, serving contract-valid fixtures
// (src/test/fixtures*.ts) so the dashboard runs and can be screenshotted
// before the `/api/v1` routes land. Dev only: `bun run dev:mock-api`, then
// set JOBS_API_FALLBACK_URL=http://localhost:8790 in .dev.vars and open
// http://localhost:4007/?code=mock-sign-in-code to sign in.
//
// It speaks the same protocol as the api: `/auth/request|exchange|logout`
// and `/api/v1/*` with `Authorization: Bearer` (or `X-Render-Ticket` on the
// two render-ticket calls, PLAN C8), ETag / If-None-Match on the board,
// revision checks on writes (409 revision_conflict with details.current).
// Each screen's routes live in scripts/mock/<area>.ts over the shared state
// of scripts/mock/state.ts.

import type { IncomingMessage } from "node:http";
import { createServer } from "node:http";
import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type { ApplicationRecord } from "@pilihpendidikan/jobs-contracts/records";
import { DAY, makeEvent, NOW, USER_ID } from "../src/test/fixtures";
import { routes as analyticsRoutes } from "./mock/analytics";
import { routes as automationRoutes } from "./mock/automation";
import { routes as cvRoutes, ticketRoute } from "./mock/cv";
import { routes as devicesRoutes } from "./mock/devices";
import { routes as inboxRoutes } from "./mock/inbox";
import { routes as sourcesRoutes } from "./mock/sources";
import {
  applicationOf,
  bumpBoard,
  cards,
  detailOf,
  extraEvents,
  fresh,
  purgeApplication,
  state,
} from "./mock/state";
import type { MockRequest, MockRoute, Reply } from "./mock/types";
import { NOT_FOUND, revisionConflict } from "./mock/types";

const PORT = Number(process.env.MOCK_API_PORT ?? 8790);
const TOKEN = "mock-bearer-token-0123456789abcdef";

function eventsOf(card: BoardCard) {
  return [
    makeEvent(card.id, {
      type: "created",
      payload: { origin: "discovered" },
      recorded_at: card.updated_at - 3 * DAY,
      occurred_at: card.updated_at - 3 * DAY,
    }),
    makeEvent(card.id, {
      type: "stage_changed",
      payload: { from: "saved", to: card.stage },
      from_value: "saved",
      to_value: card.stage,
      recorded_at: card.updated_at,
      occurred_at: card.updated_at,
    }),
    makeEvent(card.id, {
      type: "note_added",
      payload: {
        text: "**Recruiter** called — next round on *Monday*.\n\n- send portfolio\n- confirm the time",
      },
      recorded_at: card.updated_at + 3_600_000,
      occurred_at: card.updated_at + 3_600_000,
    }),
  ];
}

function moveCard(
  appId: string,
  stage: BoardCard["stage"],
  body: { base_revision: number; before_id?: string; after_id?: string }
): Reply {
  const card = cards().find((entry) => entry.id === appId);
  if (!card) {
    return NOT_FOUND;
  }
  const application = applicationOf(card);
  if (body.base_revision !== application.revision) {
    return revisionConflict(application);
  }
  const now = Date.now();
  const next: ApplicationRecord = {
    ...application,
    stage,
    stage_changed_at:
      stage === application.stage ? application.stage_changed_at : now,
    revision: application.revision + 1,
    updated_at: now,
    last_change_source: "web",
  };
  state.applications.set(appId, next);
  const placed = { ...card, stage, revision: next.revision, updated_at: now };
  state.board = {
    ...state.board,
    columns: state.board.columns.map((column) => {
      const rest = column.cards
        .filter((entry) => entry.id !== appId)
        .sort((a, b) => (a.board_rank < b.board_rank ? -1 : 1));
      if (column.stage !== stage) {
        return { ...column, cards: rest, total: rest.length };
      }
      // Like the api: between before_id and after_id, then even ranks.
      const after = rest.findIndex((entry) => entry.id === body.after_id);
      const before = rest.findIndex((entry) => entry.id === body.before_id);
      let at = rest.length;
      if (after !== -1) {
        at = after;
      } else if (before !== -1) {
        at = before + 1;
      }
      rest.splice(at, 0, placed);
      const ranked = rest.map((entry, index) => ({
        ...entry,
        board_rank: `m${String(index).padStart(4, "0")}`,
      }));
      return { ...column, cards: ranked, total: ranked.length };
    }),
  };
  bumpBoard();
  return { status: 200, body: { application: next } };
}

const APP_RE = /^\/api\/v1\/applications\/([^/]+)$/;
const APP_SUB_RE =
  /^\/api\/v1\/applications\/([^/]+)\/(move|events|interviews|offers)$/;

async function readRaw(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(
  raw: Buffer,
  contentType: string | undefined
): Record<string, unknown> {
  if (raw.length === 0 || !contentType?.includes("json")) {
    return {};
  }
  return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
}

function boardRoute({ method, path, ifNoneMatch }: MockRequest): Reply | null {
  if (method !== "GET" || path !== "/api/v1/board") {
    return null;
  }
  const etag = `"board-${state.boardVersion}"`;
  if (ifNoneMatch === etag) {
    return { status: 304, headers: { ETag: etag } };
  }
  return {
    status: 200,
    body: { ...state.board, generated_at: Date.now() },
    headers: { ETag: etag },
  };
}

function applicationSubRoute({
  method,
  path,
  body,
}: MockRequest): Reply | null {
  const sub = APP_SUB_RE.exec(path);
  if (!sub) {
    return null;
  }
  const [, appId = "", kind] = sub;
  const card = cards().find((entry) => entry.id === appId);
  if (!card) {
    return NOT_FOUND;
  }
  if (kind === "move" && method === "POST") {
    return moveCard(
      appId,
      body.stage as BoardCard["stage"],
      body as { base_revision: number; before_id?: string; after_id?: string }
    );
  }
  if (kind === "events" && method === "GET") {
    const items = [
      ...eventsOf(card),
      ...extraEvents.flatMap((extra) => extra(card)),
    ];
    return { status: 200, body: { items, next_cursor: null } };
  }
  return null;
}

function patchApplication(
  card: BoardCard,
  body: Record<string, unknown>
): Reply {
  const current = applicationOf(card);
  if (body.base_revision !== current.revision) {
    return revisionConflict(current);
  }
  const { base_revision: _ignored, ...changes } = body;
  const next = {
    ...current,
    ...changes,
    revision: current.revision + 1,
    updated_at: Date.now(),
  } as ApplicationRecord;
  state.applications.set(current.id, next);
  return { status: 200, body: { application: next } };
}

function applicationRoute({
  method,
  path,
  body,
  url,
}: MockRequest): Reply | null {
  const app = APP_RE.exec(path);
  if (!app) {
    return null;
  }
  const card = cards().find((entry) => entry.id === app[1]);
  if (!card) {
    return NOT_FOUND;
  }
  if (method === "GET") {
    return { status: 200, body: detailOf(card) };
  }
  if (method === "PATCH") {
    return patchApplication(card, body);
  }
  if (method === "DELETE") {
    return deleteApplication(card, url);
  }
  return null;
}

/** Only the purge the web sends (the archive form is a PATCH there). */
function deleteApplication(card: BoardCard, url: URL): Reply | null {
  if (url.searchParams.get("purge") !== "1") {
    return null;
  }
  const base = Number(
    url.searchParams.get("base_revision") ?? applicationOf(card).revision
  );
  if (!purgeApplication(card.id, base)) {
    return revisionConflict(applicationOf(card));
  }
  return {
    status: 200,
    body: { id: card.id, archived: false, purged: true, application: null },
  };
}

function settingsRoute({ method, path, body }: MockRequest): Reply | null {
  if (path !== "/api/v1/settings") {
    return null;
  }
  if (method === "PATCH") {
    const { base_revision: _ignored, ...changes } = body;
    state.settings = {
      ...state.settings,
      ...changes,
      revision: state.settings.revision + 1,
      updated_at: Date.now(),
    } as typeof state.settings;
  }
  return { status: 200, body: { settings: state.settings } };
}

const FACTS = fresh([
  {
    id: "fct_01J9ZZZZZZZZZZZZZZZZZZZZZ1",
    user_id: USER_ID,
    key: "contact.full_name",
    value: "Rina Wulandari",
    source: "cv_import",
    cv_id: "rina-wulandari",
    cv_entry_id: null,
    revision: 1,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: "fct_01J9ZZZZZZZZZZZZZZZZZZZZZ2",
    user_id: USER_ID,
    key: "contact.email",
    value: "rina.wulandari@example.com",
    source: "user_entered",
    cv_id: null,
    cv_entry_id: null,
    revision: 1,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: "fct_01J9ZZZZZZZZZZZZZZZZZZZZZ3",
    user_id: USER_ID,
    key: "contact.phone",
    value: "+62 812 3456 7890",
    source: "user_entered",
    cv_id: null,
    cv_entry_id: null,
    revision: 1,
    created_at: NOW,
    updated_at: NOW,
  },
]);

const CVS = [
  {
    id: "rina-wulandari",
    full_name: "Rina Wulandari",
    job_title: "Frontend Engineer",
    visibility: "private",
    is_tailored: false,
  },
];

const READ_ROUTES: Record<string, (request: MockRequest) => unknown> = {
  "/api/v1/profile/facts": () => ({ facts: FACTS, profile_version: 3 }),
  "/api/v1/profile/answers": () => ({ items: [], next_cursor: null }),
  "/api/v1/cvs": () => ({ items: CVS, next_cursor: null }),
};

const AREA_ROUTES: MockRoute[] = [
  ...inboxRoutes,
  ...automationRoutes,
  ...devicesRoutes,
  ...sourcesRoutes,
  ...analyticsRoutes,
  ...cvRoutes,
];

const CORE_ROUTES: MockRoute[] = [
  boardRoute,
  applicationSubRoute,
  applicationRoute,
  settingsRoute,
];

function api(request: MockRequest): Reply {
  for (const route of [...AREA_ROUTES, ...CORE_ROUTES]) {
    const reply = route(request);
    if (reply) {
      return reply;
    }
  }
  const read = READ_ROUTES[request.path];
  if (read && request.method === "GET") {
    return { status: 200, body: read(request) };
  }
  return {
    status: 404,
    body: {
      error: "not_found",
      message: `No mock for ${request.method} ${request.path}`,
      request_id: "mock",
    },
  };
}

function auth(path: string): Reply | null {
  if (path === "/auth/request") {
    process.stdout.write(
      "[mock-api] sign-in link: open http://localhost:4007/?code=mock-sign-in-code\n"
    );
    return { status: 200, body: { ok: true } };
  }
  if (path === "/auth/exchange") {
    return {
      status: 200,
      body: {
        email: "rina@example.com",
        token: TOKEN,
        expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
      },
    };
  }
  if (path === "/auth/logout") {
    return { status: 200, body: { ok: true } };
  }
  return null;
}

const UNAUTHORIZED: Reply = {
  status: 401,
  body: {
    error: "invalid_token",
    message: "Unknown token",
    reason: "unknown_token",
    request_id: "mock",
  },
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  const method = request.method ?? "GET";
  const raw = method === "GET" ? Buffer.alloc(0) : await readRaw(request);
  const header = (name: string) => {
    const value = request.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };
  const mockRequest: MockRequest = {
    method,
    path: url.pathname,
    url,
    raw,
    body: parseJsonBody(raw, header("content-type")),
    header,
    ifNoneMatch: header("if-none-match"),
  };
  let reply = auth(url.pathname);
  if (!reply && header("x-render-ticket")) {
    reply = ticketRoute(mockRequest) ?? UNAUTHORIZED;
  }
  if (!reply) {
    reply =
      header("authorization") === `Bearer ${TOKEN}`
        ? api(mockRequest)
        : UNAUTHORIZED;
  }
  if (reply.raw) {
    response.writeHead(reply.status, reply.headers);
    response.end(Buffer.from(reply.raw));
    return;
  }
  response.writeHead(reply.status, {
    "Content-Type": "application/json",
    ...reply.headers,
  });
  response.end(
    reply.body === undefined ? undefined : JSON.stringify(reply.body)
  );
}).listen(PORT, () => {
  process.stdout.write(`[mock-api] listening on http://localhost:${PORT}\n`);
});
