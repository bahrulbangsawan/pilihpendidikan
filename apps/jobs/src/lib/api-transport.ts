// Installs the real BFF transport: the `bffRequest` server function. Imported
// once by the root route; tests install a fake with `setBffTransport`.
import { bffRequest } from "@/functions/api.functions";
import { setBffTransport } from "./api-client";

export function installBffTransport(): void {
  setBffTransport((request) => bffRequest({ data: request }));
}
