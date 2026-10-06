// Deprecated tool-name aliases. Every CV/invoice tool was renamed to a
// `cv_*` / `invoice_*` prefix (see the per-family registrars under tools/). To
// avoid breaking MCP clients that still call the old names, this module resolves
// a legacy name to its canonical handler at call time — WITHOUT advertising the
// old name in `tools/list`. So `tools/list` returns exactly the 52 canonical
// tools (every name matching `^(cv_|invoice_)`), while `tools/call` still
// accepts the legacy names.
//
// Implementation: McpServer dispatches `tools/call` by looking up
// `request.params.name` in its registered-tools map. We capture that handler on
// the low-level Server's request-handler map and wrap it to rewrite a legacy
// name to its canonical name before delegating. Because the canonical handler is
// already wrapped by installToolLogger + installOwnershipGuard, alias calls
// inherit the same logging (recorded under the canonical name) and per-caller
// ownership checks. Aliases map 1:1 onto canonical names and a legacy name never
// equals a canonical name, so a canonical call always passes through unchanged.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// JSON-RPC method the MCP transport uses for tool invocation — a stable wire
// constant from the MCP spec, the key McpServer registers its call handler under.
const CALL_TOOL_METHOD = "tools/call";

// legacy name -> canonical name. Keep in lockstep with the registrars in
// tools/cv-*.ts and tools/invoice-*.ts. The four already-prefixed invoice tools
// (invoice_update_item / _sub_item / _adjustment / _custom_field) were not
// renamed, so they have no alias.
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  // cv-management
  get_cv: "cv_get",
  list_cvs: "cv_list",
  create_cv: "cv_create",
  delete_cv: "cv_delete",
  update_personal_info: "cv_update_personal_info",
  update_summary: "cv_update_summary",
  reorder_sections: "cv_reorder_sections",
  rename_section: "cv_rename_section",
  get_cv_url: "cv_get_url",
  // cv-add
  add_experience: "cv_add_experience",
  add_education: "cv_add_education",
  add_skill_category: "cv_add_skill_category",
  add_award: "cv_add_award",
  add_certificate: "cv_add_certificate",
  add_language: "cv_add_language",
  add_project: "cv_add_project",
  add_volunteer: "cv_add_volunteer",
  // cv-update
  update_experience: "cv_update_experience",
  update_education: "cv_update_education",
  update_skill_category: "cv_update_skill_category",
  update_award: "cv_update_award",
  update_certificate: "cv_update_certificate",
  update_language: "cv_update_language",
  update_project: "cv_update_project",
  update_volunteer: "cv_update_volunteer",
  // cv-remove
  remove_entry: "cv_remove_entry",
  remove_entry_by_id: "cv_remove_entry_by_id",
  update_entry: "cv_update_entry",
  // cv-lookup — shared CV/invoice surface, namespaced under cv_ (see below)
  list_section: "cv_list_section",
  get_entry_by_id: "cv_get_entry_by_id",
  // cv-lookup — invoice-scoped, deprecated
  typed_update_by_id: "invoice_typed_update_by_id",
  // invoice-management
  list_invoices: "invoice_list",
  get_invoice: "invoice_get",
  create_invoice: "invoice_create",
  delete_invoice: "invoice_delete",
  get_invoice_totals: "invoice_get_totals",
  get_invoice_url: "invoice_get_url",
  // invoice-parties
  update_invoice_info: "invoice_update_info",
  update_sender: "invoice_update_sender",
  update_recipient: "invoice_update_recipient",
  // invoice-items
  add_item: "invoice_add_item",
  remove_item: "invoice_remove_item",
  add_sub_item: "invoice_add_sub_item",
  remove_sub_item: "invoice_remove_sub_item",
  add_adjustment: "invoice_add_adjustment",
  remove_adjustment: "invoice_remove_adjustment",
  add_custom_field: "invoice_add_custom_field",
  remove_custom_field: "invoice_remove_custom_field",
};

type RequestHandler = (request: unknown, extra: unknown) => unknown;

interface ProtocolInternals {
  _requestHandlers?: Map<string, RequestHandler>;
}

interface CallToolRequestShape {
  params?: { name?: string };
}

// Wrap the McpServer's `tools/call` handler so legacy tool names resolve to
// their canonical handler. Returns true when the wrapper was installed; false
// if the SDK internals weren't shaped as expected (canonical tools still work —
// only the legacy aliases would be unavailable). Call AFTER every tool is
// registered: McpServer installs the call handler lazily on the first
// `server.registerTool()`, so the handler we capture only exists once tools are present.
export function installToolAliases(
  server: McpServer,
  aliases: Readonly<Record<string, string>> = TOOL_ALIASES
): boolean {
  const low = (server as unknown as { server?: ProtocolInternals }).server;
  const handlers = low?._requestHandlers;
  const original = handlers?.get(CALL_TOOL_METHOD);
  if (!(handlers && original)) {
    return false;
  }
  const aliased: RequestHandler = (request, extra) => {
    const params = (request as CallToolRequestShape).params;
    const name = params?.name;
    const canonical = name ? aliases[name] : undefined;
    if (canonical && params) {
      const rewritten = {
        ...(request as object),
        params: { ...params, name: canonical },
      };
      return original(rewritten, extra);
    }
    return original(request, extra);
  };
  handlers.set(CALL_TOOL_METHOD, aliased);
  return true;
}
