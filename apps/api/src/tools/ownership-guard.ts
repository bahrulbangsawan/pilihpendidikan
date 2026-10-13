// Per-caller ownership enforcement for the cv / invoice / portfolio / jobs
// MCP tools. The MCP route guarantees every call belongs to an authenticated
// caller; this guard adds object-level authorization so a caller only touches
// their own documents. cv / invoice / portfolio: the stamp written at create
// time (`owner:cv:{id}`, `owner:inv:{id}`, `owner:portfolio:{id}` — see
// ../ownership.ts); admins bypass and an unstamped document is admin-only.
// jobs: the legacy facade (src/jobs/legacy) — the `owner:job:{id}` stamp on
// the KV backend, the caller's JOBS_DB application on the D1 backend — with no
// admin bypass (D-26).
//
// Implemented as a server.registerTool() wrapper with the same
// category-tracking pattern as installToolLogger: call setCategory() before
// each register block so the guard knows which document family a tool edits.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Caller } from "../auth";
import type { Env } from "../env";
import { text } from "../helpers";
import { canAccessJob, mcpContext } from "../jobs/legacy/mcp";
import type { OwnedKind } from "../ownership";
import { ownsDocument } from "../ownership";
import type { LogCategory } from "../request-log";

// Create/list tools scope themselves (create stamps ownership and refuses an
// existing id; list filters by owner), so the guard lets them through. The
// board and approval tools without a `job_id` read only the caller's rows.
const SELF_SCOPED_TOOLS: Record<string, true> = {
  cv_create: true,
  invoice_create: true,
  jobs_create: true,
  portfolio_create: true,
  cv_list: true,
  invoice_list: true,
  jobs_list: true,
  portfolio_list: true,
  jobs_board: true,
  jobs_approvals_list: true,
  jobs_approval_decide: true,
};

// These cv-lookup tools target EITHER a CV or an invoice depending on
// `section`, so the document family can't come from the category alone.
const SHARED_LOOKUP_TOOLS: Record<string, true> = {
  cv_list_section: true,
  cv_get_entry_by_id: true,
  invoice_typed_update_by_id: true,
};
const INVOICE_SECTIONS: Record<string, true> = {
  items: true,
  adjustments: true,
  customFields: true,
};

const ID_ARG: Readonly<Record<OwnedKind, string>> = {
  cv: "cv_id",
  invoice: "invoice_id",
  portfolio: "portfolio_id",
  jobs: "job_id",
};

const NOT_FOUND_LABEL: Readonly<Record<OwnedKind, string>> = {
  cv: "CV",
  invoice: "Invoice",
  portfolio: "Portfolio",
  jobs: "Job",
};

export interface OwnershipGuardHandle {
  setCategory: (category: LogCategory) => void;
}

function kindFor(
  name: string,
  category: LogCategory,
  args: Record<string, unknown>
): OwnedKind {
  if (Object.hasOwn(SHARED_LOOKUP_TOOLS, name)) {
    const section = typeof args.section === "string" ? args.section : "";
    return Object.hasOwn(INVOICE_SECTIONS, section) ? "invoice" : "cv";
  }
  return category;
}

// Tools default their id argument to "default" when it is omitted.
function readId(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : "default";
}

// Always answers "not found" (never "forbidden") so the guard does not reveal
// that someone else's document exists.
async function denyIfNotOwned(
  name: string,
  category: LogCategory,
  args: Record<string, unknown>,
  caller: Caller,
  env: Env
): Promise<ReturnType<typeof text> | null> {
  const kind = kindFor(name, category, args);
  const id = readId(args, ID_ARG[kind]);
  const owned =
    kind === "jobs"
      ? await canAccessJob(mcpContext(env, caller), name, id)
      : await ownsDocument(caller, env, kind, id);
  if (owned) {
    return null;
  }
  return text(`${NOT_FOUND_LABEL[kind]} "${id}" not found.`);
}

function isToolArguments(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Wraps server.registerTool() so every tool checks ownership before its
// handler runs. With no caller (auth context missing) every call is refused:
// failing closed is the only safe default for a multi-user store.
export function installOwnershipGuard(
  server: McpServer,
  { caller, env }: { caller: Caller | null; env: Env }
): OwnershipGuardHandle {
  let category: LogCategory = "cv";
  const original = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) => {
    const registrationCategory = category;
    const wrapped = new Proxy(handler, {
      async apply(target, thisArg, args: unknown[]) {
        if (!caller) {
          return text("Not signed in.");
        }
        const toolArgs = isToolArguments(args[0]) ? args[0] : {};
        if (!Object.hasOwn(SELF_SCOPED_TOOLS, name)) {
          const denial = await denyIfNotOwned(
            name,
            registrationCategory,
            toolArgs,
            caller,
            env
          );
          if (denial) {
            return denial;
          }
        }
        return await Reflect.apply(target, thisArg, args);
      },
    });
    return original(name, config, wrapped);
  };
  return {
    setCategory(next) {
      category = next;
    },
  };
}
