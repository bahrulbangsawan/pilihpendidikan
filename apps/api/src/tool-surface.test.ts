import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createRecordingServer,
  createTestEnv,
  createToolSession,
} from "../test/fakes";
import type { Caller } from "./auth";
import { READ_ONLY_TOOLS, registerAllTools } from "./mcp-tools";
import { TOOL_ALIASES } from "./tools/tool-aliases";

const WRITER: Caller = {
  email: "writer@example.com",
  isAdmin: false,
  scope: "write",
};
const READER: Caller = {
  email: "reader@example.com",
  isAdmin: false,
  scope: "read",
};
const FAMILY_RE = /^(cv|invoice|portfolio|jobs)_/;

// The full tool surface the old backend served for these four families.
const EXPECTED_COUNTS = { cv: 30, invoice: 22, portfolio: 19, jobs: 11 };

function countByFamily(names: string[]) {
  const counts = { cv: 0, invoice: 0, portfolio: 0, jobs: 0 };
  for (const name of names) {
    const family = name.match(FAMILY_RE)?.[1] as keyof typeof counts;
    counts[family] += 1;
  }
  return counts;
}

describe("tool surface for a write-scoped caller", () => {
  const { env } = createTestEnv();
  const session = createToolSession(env, WRITER);
  const names = [...session.tools.keys()];

  it("registers every cv_, invoice_, portfolio_ and jobs_ tool and nothing else", () => {
    expect(names.every((name) => FAMILY_RE.test(name))).toBe(true);
    expect(countByFamily(names)).toEqual(EXPECTED_COUNTS);
    expect(names).toHaveLength(82);
  });

  it("marks read-only tools with readOnlyHint and the rest as writes", () => {
    for (const tool of session.tools.values()) {
      expect(tool.config.annotations?.readOnlyHint).toBe(
        READ_ONLY_TOOLS.has(tool.name)
      );
    }
    for (const name of READ_ONLY_TOOLS) {
      expect(session.tools.has(name)).toBe(true);
    }
  });

  it("installs the 48 legacy aliases, all pointing at registered tools", () => {
    expect(session.aliasesInstalled).toBe(true);
    const aliases = Object.entries(TOOL_ALIASES);
    expect(aliases).toHaveLength(48);
    for (const [legacy, canonical] of aliases) {
      expect(session.tools.has(canonical)).toBe(true);
      // Aliases are never advertised as tools of their own.
      expect(session.tools.has(legacy)).toBe(false);
    }
  });

  it("rewrites a legacy name to its canonical tool at call time", async () => {
    const handler = session.requestHandlers.get("tools/call");
    await handler?.({ params: { name: "get_cv", arguments: {} } }, {});
    await handler?.({ params: { name: "cv_get", arguments: {} } }, {});
    expect(session.calls.map((c) => c.name)).toEqual(["cv_get", "cv_get"]);
  });
});

describe("tool surface for a read-scoped caller", () => {
  it("registers only the read-only tools", () => {
    const { env } = createTestEnv();
    const session = createToolSession(env, READER);
    expect([...session.tools.keys()].sort()).toEqual(
      [...READ_ONLY_TOOLS].sort()
    );
  });

  it("registers only read-only tools when no caller is known", () => {
    const { env } = createTestEnv();
    const recording = createRecordingServer();
    registerAllTools(recording.server, env, null, {
      fireAndForget: () => undefined,
    });
    expect([...recording.tools.keys()].sort()).toEqual(
      [...READ_ONLY_TOOLS].sort()
    );
  });
});

describe("end to end through the real MCP SDK", () => {
  it("lists canonical tools only and answers legacy names", async () => {
    const { env } = createTestEnv();
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const pending: Promise<unknown>[] = [];
    expect(
      registerAllTools(server, env, WRITER, {
        fireAndForget: (p) => pending.push(p),
      })
    ).toBe(true);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(82);
    expect(listed.tools.some((tool) => tool.name === "get_cv")).toBe(false);

    const created = await client.callTool({
      name: "create_cv",
      arguments: { cv_id: "mine", full_name: "Writer" },
    });
    expect(JSON.stringify(created.content)).toContain("created successfully");
    const fetched = await client.callTool({
      name: "cv_get",
      arguments: { cv_id: "mine" },
    });
    expect(JSON.stringify(fetched.content)).toContain("Writer");
    await Promise.all(pending);
    await client.close();
  });
});
