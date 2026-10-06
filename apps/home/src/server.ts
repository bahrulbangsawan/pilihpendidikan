import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { applyEdgePolicy } from "@/lib/edge-policy";

export default createServerEntry({
  fetch: (request, opts) =>
    applyEdgePolicy(request, () => handler.fetch(request, opts)),
});
