// The applicant's side of the data a browser apply needs: AI consent, the
// profile facts the field plan cites (03 §9), and a base CV in the CV builder's
// store (created like an AI app does it: MCP `cv_create`, then the builder's
// `PUT /api/cv/:id` with the content).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./env";
import type { WebUser } from "./users";
import { newKey } from "./users";

export const APPLICANT = {
  first: "Ayu",
  last: "Lestari",
  email: "ayu.lestari@e2e.example.com",
  phone: "+62 812 3456 7890",
  country: "Indonesia",
  linkedin: "https://www.linkedin.com/in/ayu-lestari-e2e",
} as const;

/** AI consent (11 §11) + the facts the fixture forms ask for. */
export async function prepareApplicant(user: WebUser): Promise<void> {
  const current = await user.api.ok<{ settings: { revision: number } }>(
    "GET",
    "/api/v1/settings"
  );
  await user.api.ok(
    "PATCH",
    "/api/v1/settings",
    { base_revision: current.settings.revision, ai_consent: true },
    { idempotencyKey: newKey("settings") }
  );
  await user.api.ok(
    "PUT",
    "/api/v1/profile/facts",
    {
      facts: [
        { key: "contact.first_name", value: APPLICANT.first },
        { key: "contact.last_name", value: APPLICANT.last },
        {
          key: "contact.full_name",
          value: `${APPLICANT.first} ${APPLICANT.last}`,
        },
        { key: "contact.email", value: APPLICANT.email },
        { key: "contact.phone", value: APPLICANT.phone },
        { key: "contact.country", value: APPLICANT.country },
        { key: "links.linkedin", value: APPLICANT.linkedin },
      ],
    },
    { idempotencyKey: newKey("facts") }
  );
}

/** A personal token (`/auth/tokens`, the /connect page's action). */
export async function personalToken(
  user: WebUser,
  scope: "write" | "read"
): Promise<string> {
  const res = await fetch(`${user.server.origin}/auth/tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${user.session}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: `e2e ${scope}`, scope }),
  });
  if (res.status !== 201) {
    throw new Error(`/auth/tokens → ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { token: string }).token;
}

function rpcResult(text: string): Record<string, unknown> {
  // Streamable HTTP answers JSON or one SSE `data:` line per message.
  const payload = text.trim().startsWith("{")
    ? text
    : (text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .at(-1) ?? "{}");
  return JSON.parse(payload) as Record<string, unknown>;
}

/** Calls one MCP tool over Streamable HTTP (`/mcp`) with a bearer. */
export async function mcpCall(
  origin: string,
  bearer: string,
  tool: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const init = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "pilih-e2e", version: "1.0.0" },
      },
    }),
  });
  if (!init.ok) {
    throw new Error(`mcp initialize → ${init.status} ${await init.text()}`);
  }
  await init.text();
  const session = init.headers.get("mcp-session-id");
  if (session) {
    headers["mcp-session-id"] = session;
  }
  const protocol = init.headers.get("mcp-protocol-version");
  if (protocol) {
    headers["mcp-protocol-version"] = protocol;
  }
  await fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  }).then((r) => r.text());
  const call = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const body = rpcResult(await call.text());
  if (!call.ok || body.error) {
    throw new Error(
      `mcp ${tool} → ${call.status} ${JSON.stringify(body).slice(0, 500)}`
    );
  }
  return body.result as Record<string, unknown>;
}

/** apps/cv's frozen sample CV (packages/cv-engine/test/fixtures/sample-cv.json). */
export function sampleCv(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(REPO, "packages/cv-engine/test/fixtures/sample-cv.json"),
      "utf8"
    )
  ) as Record<string, unknown>;
}

/** Creates the user's base CV `id` with `data` (public, like a builder save). */
export async function createBaseCv(
  user: WebUser,
  id: string,
  data: Record<string, unknown> = sampleCv()
): Promise<string> {
  const token = await personalToken(user, "write");
  await mcpCall(user.server.origin, token, "cv_create", {
    cv_id: id,
    full_name: String(
      (data.personalInfo as { fullName?: string })?.fullName ?? ""
    ),
    job_title: String(
      (data.personalInfo as { jobTitle?: string })?.jobTitle ?? ""
    ),
  });
  const res = await fetch(
    `${user.server.origin}/api/cv/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) {
    throw new Error(`PUT /api/cv/${id} → ${res.status} ${await res.text()}`);
  }
  return id;
}
