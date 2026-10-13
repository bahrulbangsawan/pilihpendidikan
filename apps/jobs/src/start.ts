// Global request middleware. The edge policy in src/server.ts already refuses
// cross-origin server-function POSTs; TanStack's own CSRF middleware repeats
// the check inside the handler as a second line (11 §4.1).
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({
      filter: (context) => context.handlerType === "serverFn",
    }),
  ],
}));
