// Kernel dependencies shared by the router, the queue consumer and the cron
// dispatcher. Production uses the defaults; tests inject a fake clock and a
// scripted AI provider through `createApp(mcp, deps)`.

import type { Env } from "../../env";
import type { AiProvider } from "../ai/provider";
import type { Clock } from "./clock";

export interface KernelDeps {
  /** AI provider factory (default: `getAiProvider(env)`). */
  ai?: (env: Env) => AiProvider;
  /** Time source (default: the system clock). */
  clock?: Clock;
}
